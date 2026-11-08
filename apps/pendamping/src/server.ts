import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MulaiSesiInternalSchema,
  PENDAMPING_WS_CLOSE,
  PemilikSesiInternalSchema,
  PendampingClientMessageSchema,
  type PendampingGalat,
  type PendampingServerMessage,
  type TiketPendampingResponse,
} from '@urusin/contracts';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ZodType } from 'zod';
import type { Config } from './config.js';
import { devPageHtml } from './dev-page.js';
import { PendampingError, type SessionManager } from './sessions.js';

/**
 * HTTP + WebSocket layanan pendamping.
 * - `/internal/*`: hanya untuk web broker (Bearer token bersama); pemilik sesi = urusanId + sha256(urusin_sid)
 *   di BODY (bukan URL, agar tidak masuk log akses).
 * - `/ws/<sesiId>`: Origin harus persis salah satu origin web app; pesan pertama `halo` dengan tiket sekali
 *   pakai (≤30 detik). Tidak ada pencatatan isi pesan, frame, atau ketikan.
 */

const MAX_JSON = 64 * 1024;

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
    if (!m?.[1] || !origin || !config.allowedOrigins.includes(origin)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    const sesiId = m[1];
    wss.handleUpgrade(req, socket, head, (ws) => onSocket(ws, sesiId));
  });

  function onSocket(ws: WebSocket, sesiId: string) {
    let authed = false;
    let windowStart = Date.now();
    let count = 0;
    const send = (msg: PendampingServerMessage) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    };
    const viewer = { send, close: (code: number, reason: string) => ws.close(code, reason) };
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
        if (msg.type !== 'halo' || !manager.consumeTicket(msg.tiket, sesiId))
          return ws.close(PENDAMPING_WS_CLOSE.TIDAK_SAH, 'tiket tidak sah');
        authed = true;
        void manager.attach(sesiId, viewer);
        return;
      }
      void manager.handleClient(sesiId, msg);
    });
    ws.on('close', () => {
      clearTimeout(halo);
      if (authed) void manager.detach(sesiId, viewer);
    });
    ws.on('error', () => ws.terminate());
  }

  return server;
}
