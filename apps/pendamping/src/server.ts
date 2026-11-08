import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MulaiSesiInternalSchema,
  PENDAMPING_WS_CLOSE,
  PemilikSesiInternalSchema,
  PendampingClientMessageSchema,
  PendampingViewportSchema,
  type PendampingGalat,
  type PendampingServerMessage,
  type TiketPendampingResponse,
} from '@urusin/contracts';
import { ADAPTERS } from '@urusin/adapters';
import { WebSocketServer, type WebSocket } from 'ws';
import { z, type ZodType } from 'zod';
import type { Config } from './config.js';
import { debugPageHtml } from './debug-page.js';
import { devPageHtml } from './dev-page.js';
import { PendampingError, sidHashOf, type SessionManager } from './sessions.js';
import { createFrameGate } from './stream.js';

/**
 * HTTP + WebSocket layanan pendamping.
 * - `/internal/*`: hanya untuk web broker (Bearer token bersama); pemilik sesi = urusanId + sha256(urusin_sid)
 *   di BODY (bukan URL, agar tidak masuk log akses).
 * - `/ws/<sesiId>`: Origin harus persis salah satu origin web app; pesan pertama `halo` dengan tiket sekali
 *   pakai (≤30 detik). Tidak ada pencatatan isi pesan, frame, atau ketikan.
 */

const MAX_JSON = 64 * 1024;
const SID_COOKIE = 'urusin_sid';

/**
 * sha256(urusin_sid) dari header Cookie upgrade WebSocket (temuan arsitek M-5): koneksi layar hanya untuk
 * perangkat yang memegang cookie sesi pemilik, selain tiket sekali pakai. null bila tidak ada/rusak.
 */
export function sidHashFromCookie(header: string | undefined): string | null {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === SID_COOKIE) {
      const val = v.join('=');
      return /^[0-9a-f]{32}$/.test(val) ? sidHashOf(val) : null;
    }
  }
  return null;
}

const DebugSesiSchema = z.union([
  z.object({ url: z.url(), viewport: PendampingViewportSchema.optional() }),
  z.object({
    adapterId: z.string().min(1).max(64),
    flowId: z.string().min(1).max(64),
    params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
    viewport: PendampingViewportSchema.optional(),
  }),
]);
const DebugTiketSchema = z.object({ sesiId: z.uuid() });

const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};
const galat = (res: http.ServerResponse, status: number, g: PendampingGalat) => json(res, status, g);

function tokenOk(header: string | undefined, token: string): boolean {
  const got = /^Bearer (.+)$/.exec(header ?? '')?.[1] ?? '';
  const a = createHash('sha256').update(got).digest();
  const b = createHash('sha256').update(token).digest();
  return timingSafeEqual(a, b) && got.length > 0;
}

async function readJson<T>(req: http.IncomingMessage, schema: ZodType<T>): Promise<T | null> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_JSON) return null;
    chunks.push(c as Buffer);
  }
  try {
    const parsed = schema.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function clientDist(): string | undefined {
  try {
    return dirname(fileURLToPath(import.meta.resolve('@urusin/pendamping-client')));
  } catch {
    return undefined;
  }
}

export function createServer(config: Config, manager: SessionManager): http.Server {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 13 * 1024 * 1024, perMessageDeflate: false });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://pendamping');
    const path = url.pathname;
    try {
      if (req.method === 'GET' && path === '/health')
        return json(res, 200, { ok: true, ...manager.antrean() });

      if (config.devPage && req.method === 'GET' && path === '/dev') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(devPageHtml());
      }
      if (config.devPage && req.method === 'GET' && /^\/dev\/(index|viewer)\.js$/.test(path)) {
        const dir = clientDist();
        if (!dir) return galat(res, 404, { kode: 'SESI_TIDAK_ADA', pesanWarga: 'klien belum dibangun' });
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(readFileSync(join(dir, path.slice('/dev/'.length))));
      }

      if (config.debugToken && path.startsWith('/debug')) {
        if (req.method === 'GET' && path === '/debug') {
          res.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
            'x-robots-tag': 'noindex',
          });
          return res.end(
            debugPageHtml(
              Object.entries(ADAPTERS).flatMap(([id, a]) => Object.keys(a.flows).map((f) => `${id}/${f}`)),
            ),
          );
        }
        if (req.method === 'GET' && /^\/debug\/(index|viewer)\.js$/.test(path)) {
          const dir = clientDist();
          if (!dir) return galat(res, 404, { kode: 'SESI_TIDAK_ADA', pesanWarga: 'klien belum dibangun' });
          res.writeHead(200, {
            'content-type': 'text/javascript; charset=utf-8',
            'cache-control': 'no-store',
          });
          return res.end(readFileSync(join(dir, path.slice('/debug/'.length))));
        }
        if (req.method !== 'POST' || !tokenOk(req.headers.authorization, config.debugToken))
          return galat(res, 401, { kode: 'TIKET_TIDAK_SAH', pesanWarga: 'Tidak berwenang.' });
        if (path === '/debug/sesi') {
          const body = await readJson(req, DebugSesiSchema);
          if (!body)
            return galat(res, 422, { kode: 'PESAN_TIDAK_SAH', pesanWarga: 'Permintaan tidak sesuai.' });
          // Cookie sesi khusus debug di origin pendamping sendiri: syarat upgrade WS sama seperti warga.
          const sid = randomBytes(16).toString('hex');
          const sesi =
            'url' in body
              ? await manager.createManual({ ...body, sidHash: sidHashOf(sid) })
              : await manager.createDebugAlur({ ...body, sidHash: sidHashOf(sid) });
          res.setHeader('set-cookie', `${SID_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Strict`);
          return json(res, 201, sesi);
        }
        if (path === '/debug/tiket') {
          const body = await readJson(req, DebugTiketSchema);
          const owner = body ? manager.debugOwner(body.sesiId) : undefined;
          if (!owner) return galat(res, 404, { kode: 'SESI_TIDAK_ADA', pesanWarga: 'Sesi debug tidak ada.' });
          const t = manager.mintTicket(owner);
          return json(res, 201, { tiket: t.tiket, kedaluwarsa: new Date(t.exp).toISOString() });
        }
        return galat(res, 404, { kode: 'SESI_TIDAK_ADA', pesanWarga: 'Tidak ditemukan.' });
      }

      if (!path.startsWith('/internal/'))
        return galat(res, 404, { kode: 'SESI_TIDAK_ADA', pesanWarga: 'Tidak ditemukan.' });
      if (!tokenOk(req.headers.authorization, config.internalToken))
        return galat(res, 401, { kode: 'TIKET_TIDAK_SAH', pesanWarga: 'Tidak berwenang.' });

      if (req.method === 'GET' && path === '/internal/antrean') return json(res, 200, manager.antrean());
      if (req.method !== 'POST')
        return galat(res, 405, { kode: 'PESAN_TIDAK_SAH', pesanWarga: 'Metode tidak didukung.' });

      if (path === '/internal/sesi') {
        const body = await readJson(req, MulaiSesiInternalSchema);
        if (!body)
          return galat(res, 422, { kode: 'PESAN_TIDAK_SAH', pesanWarga: 'Permintaan tidak sesuai.' });
        return json(res, 201, await manager.create(body));
      }
      const owner = await readJson(req, PemilikSesiInternalSchema);
      if (!owner) return galat(res, 422, { kode: 'PESAN_TIDAK_SAH', pesanWarga: 'Permintaan tidak sesuai.' });
      switch (path) {
        case '/internal/sesi/status':
          return json(res, 200, manager.status(owner));
        case '/internal/sesi/tiket': {
          const t = manager.mintTicket(owner);
          return json(res, 201, {
            wsUrl: `${config.publicWsUrl}/${t.sesiId}`,
            tiket: t.tiket,
            kedaluwarsa: new Date(t.exp).toISOString(),
          } satisfies TiketPendampingResponse);
        }
        case '/internal/sesi/serahkan':
          return json(res, 200, manager.serahkan(owner));
        case '/internal/sesi/akhiri':
          return json(res, 200, await manager.akhiri(owner));
        default:
          return galat(res, 404, { kode: 'SESI_TIDAK_ADA', pesanWarga: 'Tidak ditemukan.' });
      }
    } catch (e) {
      if (e instanceof PendampingError) return galat(res, e.status, { kode: e.kode, pesanWarga: e.message });
      return galat(res, 500, { kode: 'INTERNAL', pesanWarga: 'Ada gangguan di layanan pendamping.' });
    }
  });

  server.on('upgrade', (req, socket, head) => {
    const m = /^\/ws\/([0-9a-f-]{36})$/.exec(new URL(req.url ?? '/', 'http://p').pathname);
    const origin = req.headers.origin;
    // Halaman /debug dilayani pendamping sendiri: origin-nya = Host permintaan ini.
    const debugOrigin =
      config.debugToken !== undefined &&
      origin !== undefined &&
      (origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`);
    const sidHash = sidHashFromCookie(req.headers.cookie);
    if (!m?.[1] || !origin || !(config.allowedOrigins.includes(origin) || debugOrigin) || !sidHash) {
      socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    const sesiId = m[1];
    wss.handleUpgrade(req, socket, head, (ws) => onSocket(ws, sesiId, sidHash));
  });

  function onSocket(ws: WebSocket, sesiId: string, sidHash: string) {
    let authed = false;
    let windowStart = Date.now();
    let count = 0;
    const send = (msg: PendampingServerMessage) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    };
    const gate = createFrameGate({
      write: (buf) => ws.readyState === ws.OPEN && ws.send(buf, { binary: true }),
      buffered: () => ws.bufferedAmount,
      maxInflight: config.frameInflight,
      maxBuffered: config.wsBufferBytes,
      fps: config.fps,
    });
    const viewer = {
      send,
      frame: gate.offer,
      ack: gate.ack,
      close: (code: number, reason: string) => ws.close(code, reason),
    };
    const halo = setTimeout(
      () => ws.close(PENDAMPING_WS_CLOSE.TIDAK_SAH, 'halo terlambat'),
      config.haloTimeoutMs,
    );

    ws.on('message', (data, isBinary) => {
      const now = Date.now();
      if (now - windowStart > 1000) {
        windowStart = now;
        count = 0;
      }
      if (++count > config.msgPerDetik) return;
      let parsed;
      try {
        parsed = isBinary ? null : PendampingClientMessageSchema.safeParse(JSON.parse(data.toString()));
      } catch {
        parsed = null;
      }
      if (!parsed?.success) {
        if (!authed) return ws.close(PENDAMPING_WS_CLOSE.TIDAK_SAH, 'pesan pertama harus halo');
        return send({ type: 'galat', kode: 'PESAN_TIDAK_SAH', pesanWarga: 'Pesan tidak dikenali.' });
      }
      const msg = parsed.data;
      if (!authed) {
        clearTimeout(halo);
        if (msg.type !== 'halo' || !manager.consumeTicket(msg.tiket, sesiId, sidHash))
          return ws.close(PENDAMPING_WS_CLOSE.TIDAK_SAH, 'tiket tidak sah');
        authed = true;
        void manager.attach(sesiId, viewer);
        return;
      }
      void manager.handleClient(sesiId, msg);
    });
    ws.on('close', () => {
      clearTimeout(halo);
      gate.close();
      if (authed) void manager.detach(sesiId, viewer);
    });
    ws.on('error', () => ws.terminate());
  }

  return server;
}
