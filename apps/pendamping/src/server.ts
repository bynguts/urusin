import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AksiSesiInternalSchema,
  AmatiSesiInternalSchema,
  BerkasSesiInternalSchema,
  IsiSesiInternalSchema,
  JejakSesiInternalSchema,
  MulaiSesiInternalSchema,
  PENDAMPING_WS_CLOSE,
  PENDAMPING_WS_MAX_PAYLOAD,
  PemilikSesiInternalSchema,
  PendampingClientMessageSchema,
  PendampingViewportSchema,
  PlaceholderVaultSchema,
  SelesaiSesiInternalSchema,
  TungguSesiInternalSchema,
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
import { bacaIsiBertanda, createPenjagaUlang, headerDari } from './tanda.js';

/**
 * HTTP + WebSocket layanan pendamping.
 * - `/internal/*`: hanya untuk web broker (tanda tangan HMAC rahasia bersama, jendela 60 detik); pemilik sesi = urusanId + sha256(urusin_sid)
 *   di BODY (bukan URL, agar tidak masuk log akses).
 * - `/ws/<sesiId>`: Origin harus persis salah satu origin web app; pesan pertama `halo` dengan tiket sekali
 *   pakai (≤30 detik). Tidak ada pencatatan isi pesan, frame, atau ketikan.
 */

const MAX_JSON = 64 * 1024;
/** Satu berkas 9 MB dalam base64 (~12 MB) + amplop JSON. */
const MAX_JSON_BERKAS = 12_700_000;
/** Cookie sesi web app (`__Host-`: Secure, Path=/, tanpa Domain; sama dengan apps/web `SID_COOKIE`). */
const SID_COOKIE = '__Host-urusin_sid';
/** Cookie halaman /debug pendamping sendiri (http lokal, tanpa Secure); HANYA diterima untuk sesi debug. */
const SID_COOKIE_LAMA = 'urusin_sid';

/**
 * sha256(cookie sesi) dari header Cookie upgrade WebSocket (temuan arsitek M-5): koneksi layar hanya untuk
 * perangkat yang memegang cookie sesi pemilik, selain tiket sekali pakai. Hanya `__Host-urusin_sid`; nama lama
 * `urusin_sid` hanya bila `debug` (sesi halaman /debug dari origin pendamping sendiri) dan yang baru tidak ada.
 * null bila tidak ada/rusak.
 */
export function sidHashFromCookie(header: string | undefined, debug = false): string | null {
  const nilai = new Map<string, string>();
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k && !nilai.has(k)) nilai.set(k, v.join('='));
  }
  const val = nilai.get(SID_COOKIE) ?? (debug ? nilai.get(SID_COOKIE_LAMA) : undefined);
  return val !== undefined && /^[0-9a-f]{32}$/.test(val) ? sidHashOf(val) : null;
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
/** Isian SINTETIS dari penguji untuk sesi debug alur adapter (bukan vault warga; token debug wajib). */
const DebugIsiSchema = z.object({
  sesiId: z.uuid(),
  isian: z.record(PlaceholderVaultSchema, z.string().max(500)),
});

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

/** Isi mentah dibatasi MAX_JSON; null bila lebih. */
async function readRaw(req: http.IncomingMessage, maks = MAX_JSON): Promise<Buffer | null> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > maks) return null;
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

function parseJson<T>(raw: Buffer | null, schema: ZodType<T>): T | null {
  if (!raw) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(raw.toString('utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function readJson<T>(req: http.IncomingMessage, schema: ZodType<T>): Promise<T | null> {
  return parseJson(await readRaw(req), schema);
}

function clientDist(): string | undefined {
  try {
    return dirname(fileURLToPath(import.meta.resolve('@urusin/pendamping-client')));
  } catch {
    return undefined;
  }
}

export function createServer(config: Config, manager: SessionManager): http.Server {
  // Batas pesan 64 KB berlaku sejak byte pertama (perangkat hanya mengirim input dan kendali).
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: PENDAMPING_WS_MAX_PAYLOAD,
    perMessageDeflate: false,
  });
  let belumHalo = 0;

  const periksaInternal = createPenjagaUlang(config.internalToken);
  /** Semafor global: paling banyak satu pembacaan isi besar (> 64 KB) sekaligus. */
  let bacaBesarAktif = false;
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
          res.setHeader('set-cookie', `${SID_COOKIE_LAMA}=${sid}; Path=/; HttpOnly; SameSite=Strict`);
          return json(res, 201, sesi);
        }
        if (path === '/debug/tiket') {
          const body = await readJson(req, DebugTiketSchema);
          const owner = body ? manager.debugOwner(body.sesiId) : undefined;
          if (!owner) return galat(res, 404, { kode: 'SESI_TIDAK_ADA', pesanWarga: 'Sesi debug tidak ada.' });
          const t = manager.mintTicket(owner);
          return json(res, 201, { tiket: t.tiket, kedaluwarsa: new Date(t.exp).toISOString() });
        }
        if (path === '/debug/isi') {
          const body = await readJson(req, DebugIsiSchema);
          const owner = body ? manager.debugOwner(body.sesiId) : undefined;
          if (!body || !owner)
            return galat(res, 404, { kode: 'SESI_TIDAK_ADA', pesanWarga: 'Sesi debug tidak ada.' });
          return json(res, 200, { kurang: await manager.isiData(owner, body.isian) });
        }
        return galat(res, 404, { kode: 'SESI_TIDAK_ADA', pesanWarga: 'Tidak ditemukan.' });
      }

      if (!path.startsWith('/internal/'))
        return galat(res, 404, { kode: 'SESI_TIDAK_ADA', pesanWarga: 'Tidak ditemukan.' });
      // Kanal web -> worker: tanda tangan HMAC atas waktu + nonce + metode + jalur + isi (bukan token polos);
      // nonce yang sudah dipakai dalam jendela waktu ditolak (anti putar ulang).
      // HMAC atas header (waktu, nonce, metode, jalur, Content-Length, sha256 isi yang dideklarasikan) diperiksa
      // SEBELUM satu byte isi dibaca; gagal = 401 dan koneksi ditutup tanpa membaca isi. Lalu batas panjang,
      // lalu (isi > 64 KB) satu pembacaan besar sekaligus di seluruh proses; sisanya 503 + Retry-After. Isi
      // dibaca dengan batas dan di-hash sambil jalan; tidak cocok dengan deklarasi = 401.
      // Satu berkas Dokumen (<= 9 MB biner, base64) hanya di jalur berkas; selain itu 64 KB.
      const tolak = (status: number, g: PendampingGalat, extra: Record<string, string> = {}) => {
        res.setHeader('connection', 'close');
        for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
        return galat(res, status, g);
      };
      const h = headerDari(req);
      if (!periksaInternal(h, req.method ?? 'GET', path))
        return tolak(401, { kode: 'TIKET_TIDAK_SAH', pesanWarga: 'Tidak berwenang.' });
      const panjang = Number(h.panjang);
      if (panjang > (path === '/internal/sesi/berkas' ? MAX_JSON_BERKAS : MAX_JSON))
        return tolak(413, { kode: 'PESAN_TIDAK_SAH', pesanWarga: 'Permintaan terlalu besar.' });
      const besar = panjang > MAX_JSON;
      if (besar && bacaBesarAktif)
        return tolak(
          503,
          { kode: 'LAYANAN_TIDAK_TERSEDIA', pesanWarga: 'Sedang menerima berkas lain. Coba lagi sebentar.' },
          { 'retry-after': '2' },
        );
      if (besar) bacaBesarAktif = true;
      let raw: Buffer | null | false;
      try {
        raw = await bacaIsiBertanda(req, h, panjang);
      } finally {
        if (besar) bacaBesarAktif = false;
      }
      if (raw === null)
        return tolak(413, { kode: 'PESAN_TIDAK_SAH', pesanWarga: 'Permintaan terlalu besar.' });
      if (raw === false) return tolak(401, { kode: 'TIKET_TIDAK_SAH', pesanWarga: 'Tidak berwenang.' });

      if (req.method === 'GET' && path === '/internal/antrean') return json(res, 200, manager.antrean());
      if (req.method !== 'POST')
        return galat(res, 405, { kode: 'PESAN_TIDAK_SAH', pesanWarga: 'Metode tidak didukung.' });

      if (path === '/internal/sesi') {
        const body = parseJson(raw, MulaiSesiInternalSchema);
        if (!body)
          return galat(res, 422, { kode: 'PESAN_TIDAK_SAH', pesanWarga: 'Permintaan tidak sesuai.' });
        return json(res, 201, await manager.create(body));
      }
      // Jalur isi server (A-M1): nilai/berkas dari resolver web, hanya lewat kanal bertanda tangan ini.
      if (path === '/internal/sesi/isi') {
        const body = parseJson(raw, IsiSesiInternalSchema);
        if (!body)
          return galat(res, 422, { kode: 'PESAN_TIDAK_SAH', pesanWarga: 'Permintaan tidak sesuai.' });
        return json(res, 200, await manager.isiData(body, body.isian, body.rencanaHash, body.berkas));
      }
      // Navigator generik (ADR 0030): otak di web, tangan di sini. Pemilik = urusanId + sidHash di body.
      if (path === '/internal/sesi/amati') {
        const body = parseJson(raw, AmatiSesiInternalSchema);
        if (!body)
          return galat(res, 422, { kode: 'PESAN_TIDAK_SAH', pesanWarga: 'Permintaan tidak sesuai.' });
        return json(res, 200, await manager.amati(body, body.pantau === true));
      }
      if (path === '/internal/sesi/aksi') {
        const body = parseJson(raw, AksiSesiInternalSchema);
        if (!body)
          return galat(res, 422, { kode: 'PESAN_TIDAK_SAH', pesanWarga: 'Permintaan tidak sesuai.' });
        return json(res, 200, await manager.aksi(body, body));
      }
      if (path === '/internal/sesi/tunggu') {
        const body = parseJson(raw, TungguSesiInternalSchema);
        if (!body)
          return galat(res, 422, { kode: 'PESAN_TIDAK_SAH', pesanWarga: 'Permintaan tidak sesuai.' });
        return json(res, 200, await manager.tunggu(body, body.maksMs));
      }
      if (path === '/internal/sesi/selesai') {
        const body = parseJson(raw, SelesaiSesiInternalSchema);
        if (!body)
          return galat(res, 422, { kode: 'PESAN_TIDAK_SAH', pesanWarga: 'Permintaan tidak sesuai.' });
        return json(res, 200, await manager.selesai(body, body.bukti, body.executionId));
      }
      if (path === '/internal/sesi/jejak') {
        const body = parseJson(raw, JejakSesiInternalSchema);
        if (!body)
          return galat(res, 422, { kode: 'PESAN_TIDAK_SAH', pesanWarga: 'Permintaan tidak sesuai.' });
        return json(res, 200, manager.kurasJejak(body));
      }
      if (path === '/internal/sesi/berkas') {
        const body = parseJson(raw, BerkasSesiInternalSchema);
        if (!body)
          return galat(res, 422, { kode: 'PESAN_TIDAK_SAH', pesanWarga: 'Permintaan tidak sesuai.' });
        return json(res, 200, await manager.isiBerkas(body, body));
      }
      const owner = parseJson(raw, PemilikSesiInternalSchema);
      if (!owner) return galat(res, 422, { kode: 'PESAN_TIDAK_SAH', pesanWarga: 'Permintaan tidak sesuai.' });
      switch (path) {
        case '/internal/sesi/status':
          return json(res, 200, manager.status(owner));
        case '/internal/sesi/butuh':
          return json(res, 200, manager.butuhData(owner));
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
    // Cookie lama `urusin_sid` hanya untuk sesi debug yang dibuka dari halaman /debug pendamping sendiri.
    const sidHash = sidHashFromCookie(
      req.headers.cookie,
      debugOrigin && m?.[1] !== undefined && manager.debugOwner(m[1]) !== undefined,
    );
    // Sesi harus ada dan milik cookie ini SEBELUM upgrade: soket asing tidak pernah mendapat buffer WS.
    if (
      !m?.[1] ||
      !origin ||
      !(config.allowedOrigins.includes(origin) || debugOrigin) ||
      !sidHash ||
      !manager.pemilikCocok(m[1], sidHash)
    ) {
      socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    if (belumHalo >= config.maksBelumHalo) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    const sesiId = m[1];
    // Hitungan pra-halo dilepas sekali saja: saat halo sah, saat WS tutup, ATAU saat soket mentah tutup.
    // ws.handleUpgrade membatalkan upgrade cacat (versi/kunci salah, soket sudah tutup) dengan 400 tanpa
    // memanggil callback; tanpa pengait 'close' di soket mentah, hitungan itu bocor dan semua warga kena 503.
    belumHalo++;
    let dihitung = true;
    const lepasHitung = () => {
      if (dihitung) belumHalo--;
      dihitung = false;
    };
    socket.once('close', lepasHitung);
    wss.handleUpgrade(req, socket, head, (ws) => onSocket(ws, sesiId, sidHash, lepasHitung));
  });

  function onSocket(ws: WebSocket, sesiId: string, sidHash: string, lepasHitung: () => void) {
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
        lepasHitung();
        void manager.attach(sesiId, viewer);
        return;
      }
      void manager.handleClient(sesiId, msg);
    });
    ws.on('close', () => {
      lepasHitung();
      clearTimeout(halo);
      gate.close();
      if (authed) void manager.detach(sesiId, viewer);
    });
    ws.on('error', () => ws.terminate());
  }

  return server;
}
