/* eslint-disable @typescript-eslint/no-explicit-any -- tes membaca JSON respons tanpa tipe */
import { DemoProvider } from '@urusin/harness';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Kebijakan egress diuji di packages/egress; di sini egressFetch diteruskan ke fetch global yang di-stub.
vi.mock('@urusin/egress', async (asli) => ({
  ...(await asli<typeof import('@urusin/egress')>()),
  egressFetch: (input: string | URL, init?: RequestInit) => fetch(input, init),
}));
import { GET as antrean } from '../../routes/api/pendamping/antrean/+server';
import {
  DELETE as akhiri,
  GET as status,
  POST as mulai,
} from '../../routes/api/urusan/[id]/pendamping/+server';
import { POST as serahkan } from '../../routes/api/urusan/[id]/pendamping/serahkan/+server';
import { POST as tiket } from '../../routes/api/urusan/[id]/pendamping/tiket/+server';
import { checkOrigin } from './origin';
import {
  hashSid,
  panggil,
  pasangPemeriksaPemilikAkun,
  pendampingConfig,
  PESAN_WILAYAH,
  pilihWorker,
  resetBrokerPendamping,
  sidDariRequest,
  skema,
  tandaInternal,
  type PendampingConfig,
} from './pendamping';
import { createRuntime, setRuntimeForTests, type Runtime } from './runtime';

const ORIGIN = 'http://localhost:3000';
const SID = 'ab'.repeat(16);
const SESI = '00000000-0000-4000-8000-000000000001';
const NIK = ['3312', '0101', '0190', '0001'].join('');

let rt: Runtime;
type Panggilan = {
  url: string;
  host: string;
  body: any;
  raw: string;
  method: string;
  waktu: string | null;
  nonce: string | null;
  tanda: string | null;
};
let calls: Panggilan[];
let reply: (path: string, body: any, host: string) => { status: number; body: unknown };
/** Jawaban GET /health per host worker; 'mati' = koneksi ditolak. */
let kesehatan: (host: string) => { status: number; body: unknown } | 'mati';
const SEHAT = { ok: true, aktif: 0, maks: 2, menunggu: 0 };

const sesi = (extra: object = {}) => ({
  sesiId: '00000000-0000-4000-8000-000000000001',
  urusanId: 'u',
  executionId: 'x_1',
  status: 'antre',
  mode: null,
  antrean: { posisi: 1, panjang: 1 },
  dibuatPada: '2026-11-09T00:00:00.000Z',
  kedaluwarsaPada: '2026-11-09T00:15:00.000Z',
  ...extra,
});

beforeEach(() => {
  rt = createRuntime({ provider: new DemoProvider(), config: { dbPath: ':memory:' } });
  setRuntimeForTests(rt);
  resetBrokerPendamping();
  // Satu worker (skema lama) berjaringan Indonesia: Wonogiri (Telunjuk Sakti) khusus IP Indonesia.
  vi.stubEnv('PENDAMPING_INTERNAL_URL', 'http://pendamping:4000/');
  vi.stubEnv('PENDAMPING_INTERNAL_REGION', 'id');
  vi.stubEnv('PENDAMPING_INTERNAL_TOKEN', 'token-uji');
  calls = [];
  reply = () => ({ status: 201, body: sesi() });
  kesehatan = () => ({ status: 200, body: SEHAT });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    if (u.pathname === '/health') {
      const h = kesehatan(u.host);
      if (h === 'mati') throw new Error('ECONNREFUSED');
      return new Response(JSON.stringify(h.body), { status: h.status });
    }
    const raw = init.body ? String(init.body) : '';
    const headers = new Headers(init.headers);
    calls.push({
      url,
      host: u.host,
      raw,
      body: raw ? JSON.parse(raw) : undefined,
      method: init.method ?? 'GET',
      waktu: headers.get('x-urusin-waktu'),
      nonce: headers.get('x-urusin-nonce'),
      tanda: headers.get('x-urusin-tanda'),
    });
    const r = reply(u.pathname, raw ? JSON.parse(raw) : undefined, u.host);
    return new Response(JSON.stringify(r.body), { status: r.status });
  });
});
afterEach(() => {
  pasangPemeriksaPemilikAkun(undefined);
  setRuntimeForTests(undefined);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function urusanDenganEksekusi() {
  const u = rt.store.createUrusan({ kodeKabKota: '3312' });
  rt.publish(u.id, {
    type: 'execution_request',
    executionId: 'x_1',
    adapterId: 'telunjuk-sakti-wonogiri',
    flowId: 'ajukan',
    ringkasan: 'Ajukan layanan 1',
    params: { layanan_id: 1 },
    tool: 'dukcapil__ajukan_layanan',
    paramsHash: 'h',
  });
  return u;
}

const req = (method: string, body?: unknown, cookie: string | null = `urusin_sid=${SID}`) =>
  new Request(`${ORIGIN}/x`, {
    method,
    headers: {
      'content-type': 'application/json',
      origin: ORIGIN,
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const ev = (request: Request, id: string) =>
  ({ request, params: { id }, url: new URL(request.url) }) as never;

describe('broker Browser Pendamping', () => {
  it('mulai: adapter/params dari execution_request yang ditawarkan + origin registry; sid di-hash', async () => {
    const u = urusanDenganEksekusi();
    const res = await mulai(ev(req('POST', { executionId: 'x_1' }), u.id));
    expect(res.status).toBe(201);
    expect(calls[0]).toMatchObject({
      url: 'http://pendamping:4000/internal/sesi',
      method: 'POST',
      body: {
        urusanId: u.id,
        sidHash: hashSid(SID),
        executionId: 'x_1',
        adapterId: 'telunjuk-sakti-wonogiri',
        origin: 'https://telunjuksakti.wonogirikab.go.id',
        params: { layanan_id: 1 },
      },
    });
    expect(JSON.stringify(calls)).not.toContain(SID);
    // Kanal ditandatangani HMAC atas (waktu, metode, jalur, isi mentah); tanpa bearer polos.
    const c = calls[0]!;
    expect(c.waktu).toMatch(/^\d{13}$/);
    expect(c.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(c.tanda).toBe(tandaInternal('token-uji', c.waktu!, c.nonce!, 'POST', '/internal/sesi', c.raw));
  });

  it('tanda tangan HMAC: vektor uji sama dengan apps/pendamping (tanda.test.ts)', () => {
    const N = '0123456789abcdef0123456789abcdef';
    const VEKTOR = 'cc8335efcf547bb99e33a916b615c9152474c8613649f175e650158ffa14af4e';
    expect(
      tandaInternal('r'.repeat(40), '1700000000000', N, 'POST', '/internal/sesi/status', '{"a":1}'),
    ).toBe(VEKTOR);
    expect(
      tandaInternal('r'.repeat(40), '1700000000000', N, 'post', '/internal/sesi/status', '{"a":1}'),
    ).toBe(VEKTOR);
  });

  it('tanpa cookie sesi yang sudah ada -> 401; eksekusi asing -> 404; kota tanpa portal -> 422', async () => {
    const u = urusanDenganEksekusi();
    expect((await mulai(ev(req('POST', { executionId: 'x_1' }, null), u.id))).status).toBe(401);
    expect((await mulai(ev(req('POST', { executionId: 'x_1' }, 'urusin_sid=pendek'), u.id))).status).toBe(
      401,
    );
    expect((await mulai(ev(req('POST', { executionId: 'x_lain' }), u.id))).status).toBe(404);
    expect((await mulai(ev(req('POST', { executionId: 'x_1' }), 'tidak-ada'))).status).toBe(404);
    const tanpaKota = rt.store.createUrusan({});
    rt.publish(tanpaKota.id, {
      type: 'execution_request',
      executionId: 'x_2',
      adapterId: 'a',
      flowId: 'f',
      ringkasan: 'r',
      params: {},
      tool: 't',
      paramsHash: 'h',
    });
    expect((await mulai(ev(req('POST', { executionId: 'x_2' }), tanpaKota.id))).status).toBe(422);
    expect((await mulai(ev(req('POST', { executionId: `nik ${NIK}` }), u.id))).status).toBe(422);
    expect(calls).toHaveLength(0);
  });

  it('pemeriksa pemilik akun: urusan akun lain / pemeriksa galat -> 404 di semua endpoint, tanpa panggil worker', async () => {
    const u = urusanDenganEksekusi();
    const dilihat: string[] = [];
    pasangPemeriksaPemilikAkun((request, urusan) => {
      dilihat.push(`${urusan.id}:${request.method}`);
      return false;
    });
    expect((await mulai(ev(req('POST', { executionId: 'x_1' }), u.id))).status).toBe(404);
    expect((await status(ev(req('GET'), u.id))).status).toBe(404);
    expect((await tiket(ev(req('POST'), u.id))).status).toBe(404);
    expect((await serahkan(ev(req('POST'), u.id))).status).toBe(404);
    expect((await akhiri(ev(req('DELETE'), u.id))).status).toBe(404);
    expect(dilihat).toEqual([
      `${u.id}:POST`,
      `${u.id}:GET`,
      `${u.id}:POST`,
      `${u.id}:POST`,
      `${u.id}:DELETE`,
    ]);
    pasangPemeriksaPemilikAkun(() => {
      throw new Error('basis data akun mati');
    });
    expect((await tiket(ev(req('POST'), u.id))).status).toBe(404);
    expect(calls).toHaveLength(0);
    pasangPemeriksaPemilikAkun(async (_r, urusan) => urusan.id === u.id);
    expect((await mulai(ev(req('POST', { executionId: 'x_1' }), u.id))).status).toBe(201);
  });

  it('status: hasil akhir dicatat sekali ke urusan (berhasil -> progres + TERKIRIM bila boleh)', async () => {
    const u = urusanDenganEksekusi();
    reply = () => ({
      status: 200,
      body: sesi({ status: 'selesai', mode: 'done', hasil: 'berhasil', antrean: null }),
    });
    const r1 = await status(ev(req('GET'), u.id));
    expect(r1.status).toBe(200);
    expect(((await r1.json()) as any).hasil).toBe('berhasil');
    await status(ev(req('GET'), u.id));
    const labels = rt.store
      .eventsAfter(u.id)
      .filter((e) => e.type === 'progress')
      .map((e) => (e.payload as { label: string }).label);
    expect(labels.filter((l) => l.includes('Browser Pendamping melaporkan'))).toHaveLength(1);
  });

  it('tiket, serahkan, akhiri, antrean diteruskan; galat pendamping diteruskan sebagai {kode, pesanWarga}', async () => {
    const u = urusanDenganEksekusi();
    reply = (path) =>
      path.endsWith('/tiket')
        ? {
            status: 201,
            body: { wsUrl: 'wss://x/ws/s', tiket: 't'.repeat(43), kedaluwarsa: '2026-11-09T00:00:30.000Z' },
          }
        : { status: 200, body: sesi({ mode: 'takeover' }) };
    kesehatan = () => ({ status: 200, body: { ...SEHAT, aktif: 1 } });
    expect((await tiket(ev(req('POST'), u.id))).status).toBe(201);
    expect(((await (await serahkan(ev(req('POST'), u.id))).json()) as any).mode).toBe('takeover');
    expect((await akhiri(ev(req('DELETE'), u.id))).status).toBe(200);
    expect(await (await antrean({} as never)).json()).toEqual({ aktif: 1, maks: 2, menunggu: 0 });
    reply = () => ({
      status: 403,
      body: { kode: 'SESI_BUKAN_MILIK', pesanWarga: 'sesi milik perangkat lain' },
    });
    const g = await tiket(ev(req('POST'), u.id));
    expect(g.status).toBe(403);
    expect(await g.json()).toEqual({ kode: 'SESI_BUKAN_MILIK', pesanWarga: 'sesi milik perangkat lain' });
  });

  it('wsUrl dipatok ke PENDAMPING_PUBLIC_WS_URL; id sesi bukan UUID dari worker -> 503', async () => {
    vi.stubEnv('PENDAMPING_PUBLIC_WS_URL', 'wss://urusin.test/pendamping/ws/');
    const u = urusanDenganEksekusi();
    const jawab = (wsUrl: string) => (path: string) =>
      path.endsWith('/tiket')
        ? { status: 201, body: { wsUrl, tiket: 't'.repeat(43), kedaluwarsa: '2026-11-09T00:00:30.000Z' } }
        : { status: 200, body: sesi({ mode: 'ai', status: 'berjalan' }) };
    reply = jawab(`ws://127.0.0.1:4330/ws/${SESI}`);
    const r = await tiket(ev(req('POST'), u.id));
    expect(((await r.json()) as any).wsUrl).toBe(`wss://urusin.test/pendamping/ws/${SESI}`);
    reply = jawab('wss://evil.example/ws/..%2F..%2Fadmin');
    expect((await tiket(ev(req('POST'), u.id))).status).toBe(503);
  });

  it('pendamping mati / jawaban rusak / tanpa konfigurasi -> 503 LAYANAN_TIDAK_TERSEDIA', async () => {
    const u = urusanDenganEksekusi();
    reply = () => ({ status: 500, body: { stack: 'rahasia' } });
    const r = await status(ev(req('GET'), u.id));
    expect(r.status).toBe(503);
    expect(JSON.stringify(await r.json())).not.toContain('rahasia');
    reply = () => ({ status: 200, body: { bukan: 'sesi' } });
    expect((await status(ev(req('GET'), u.id))).status).toBe(503);
    expect((await panggil(null, '/internal/antrean', skema.antrean)) as { ok: boolean }).toMatchObject({
      ok: false,
    });
    const mati = await panggil(
      { url: 'http://x', token: 't' },
      '/internal/antrean',
      skema.antrean,
      undefined,
      () => Promise.reject(new Error('ECONNREFUSED')),
    );
    expect(mati.ok).toBe(false);
    expect(pendampingConfig({})).toBeNull();
  });

  it('status siaga: hasil execution dicatat sekali + bukti (nomor/status) sebagai progres yang diredaksi', async () => {
    const u = urusanDenganEksekusi();
    reply = () => ({
      status: 200,
      body: sesi({
        status: 'siaga',
        mode: 'takeover',
        hasil: 'berhasil',
        antrean: null,
        bukti: { nomor: 'REG-0001', status: `Diproses untuk NIK ${NIK}` },
      }),
    });
    await status(ev(req('GET'), u.id));
    await status(ev(req('GET'), u.id));
    const labels = rt.store
      .eventsAfter(u.id)
      .filter((e) => e.type === 'progress')
      .map((e) => (e.payload as { label: string }).label);
    expect(labels.filter((l) => l.includes('Browser Pendamping melaporkan langkah berhasil'))).toHaveLength(
      1,
    );
    const bukti = labels.filter((l) => l.startsWith('Bukti dari situs resmi'));
    expect(bukti).toHaveLength(1);
    expect(bukti[0]).toContain('nomor REG-0001');
    expect(JSON.stringify(labels)).not.toContain(NIK);
  });

  it('baca-saja (Samsat): origin dari permintaan, bukan portal kota; hasil dicatat tanpa transisi state', async () => {
    const u = rt.store.createUrusan({ kodeKabKota: '3312' });
    let v = u.version;
    for (const st of [
      'MEMAHAMI',
      'RENCANA_DIUSULKAN',
      'RENCANA_DISETUJUI',
      'MENYIAPKAN_BERKAS',
      'BERKAS_SIAP',
    ] as const)
      v = rt.store.transition(u.id, v, st).version;
    const pkb = {
      type: 'execution_request' as const,
      executionId: 'x_pkb',
      adapterId: 'samsat-dki',
      flowId: 'cek_pkb',
      ringkasan: 'Cek info PKB',
      params: {},
      tool: 'samsat__cek_pkb',
      paramsHash: 'h',
      origin: 'https://samsat-pkb2.jakarta.go.id',
      bacaSaja: true,
    };
    rt.publish(u.id, pkb);
    expect((await mulai(ev(req('POST', { executionId: 'x_pkb' }), u.id))).status).toBe(201);
    expect(calls[0]!.body).toMatchObject({
      adapterId: 'samsat-dki',
      flowId: 'cek_pkb',
      origin: 'https://samsat-pkb2.jakarta.go.id',
      params: {},
    });
    reply = () => ({
      status: 200,
      body: sesi({ executionId: 'x_pkb', status: 'siaga', mode: 'ai', hasil: 'berhasil', antrean: null }),
    });
    await status(ev(req('GET'), u.id));
    await status(ev(req('GET'), u.id));
    const ev2 = rt.store.eventsAfter(u.id);
    const labels = ev2
      .filter((e) => e.type === 'progress')
      .map((e) => (e.payload as { label: string }).label);
    expect(
      labels.filter((l) => l.includes('selesai membuka hasilnya. Tidak ada yang dikirim.')),
    ).toHaveLength(1);
    expect(rt.store.getUrusanOrThrow(u.id).state).toBe('BERKAS_SIAP');

    // Origin di permintaan yang bukan domain resmi ditolak sebelum memanggil worker.
    rt.publish(u.id, { ...pkb, executionId: 'x_palsu', origin: 'https://contoh.example.com' });
    const n = calls.length;
    const r = await mulai(ev(req('POST', { executionId: 'x_palsu' }), u.id));
    expect(r.status).toBe(422);
    expect(calls).toHaveLength(n);
  });

  describe('multi-worker (PENDAMPING_WORKERS)', () => {
    const WS = 'wss://urusin.test/pendamping';
    const TOKEN_LAPTOP = 'l'.repeat(40);
    const VPS = {
      id: 'vps',
      url: 'http://127.0.0.1:4330',
      region: 'umum',
      maxSessions: 2,
      wsUrl: `${WS}/ws`,
    };
    const LAPTOP = {
      id: 'laptop-a',
      url: 'http://100.101.1.2:4330',
      region: 'id',
      maxSessions: 1,
      wsUrl: `${WS}/w/laptop-a/ws`,
      token: TOKEN_LAPTOP,
    };
    beforeEach(() => vi.stubEnv('PENDAMPING_WORKERS', JSON.stringify([VPS, LAPTOP])));

    it('konfigurasi: JSON valid; JSON rusak, id ganda, url berjalur, tanpa token -> null; fallback satu URL', () => {
      expect(pendampingConfig(process.env)?.workers.map((w) => w.id)).toEqual(['vps', 'laptop-a']);
      const env = (w: string) => ({ PENDAMPING_INTERNAL_TOKEN: 't', PENDAMPING_WORKERS: w });
      expect(pendampingConfig(env('[{'))).toBeNull();
      expect(pendampingConfig(env(JSON.stringify([VPS, VPS])))).toBeNull();
      expect(pendampingConfig(env(JSON.stringify([{ ...VPS, url: 'http://127.0.0.1:4330/x' }])))).toBeNull();
      // Worker di luar 127.0.0.1 tanpa rahasia sendiri ditolak; wsUrl wajib ws(s) polos.
      expect(pendampingConfig(env(JSON.stringify([{ ...LAPTOP, token: undefined }])))).toBeNull();
      expect(pendampingConfig(env(JSON.stringify([{ ...LAPTOP, token: 'pendek' }])))).toBeNull();
      expect(pendampingConfig(env(JSON.stringify([{ ...VPS, wsUrl: 'https://x/ws' }])))).toBeNull();
      expect(pendampingConfig(env(JSON.stringify([{ ...VPS, wsUrl: undefined }])))).toBeNull();
      expect(pendampingConfig(env(JSON.stringify([{ ...VPS, maxSessions: 0 }])))).toBeNull();
      expect(pendampingConfig({ PENDAMPING_WORKERS: JSON.stringify([VPS]) })).toBeNull();
      expect(
        pendampingConfig({ PENDAMPING_INTERNAL_TOKEN: 't', PENDAMPING_INTERNAL_URL: 'http://p:1/' }),
      ).toEqual({
        token: 't',
        workers: [{ id: 'utama', url: 'http://p:1', region: 'umum', maxSessions: 64 }],
      });
    });

    it('situs khusus IP Indonesia -> worker region id; panggilan berikutnya (tiket) ke worker yang sama', async () => {
      const u = urusanDenganEksekusi();
      expect((await mulai(ev(req('POST', { executionId: 'x_1' }), u.id))).status).toBe(201);
      expect(calls[0]).toMatchObject({
        host: '100.101.1.2:4330',
        url: 'http://100.101.1.2:4330/internal/sesi',
      });
      reply = () => ({
        status: 201,
        body: {
          wsUrl: `wss://evil.example/ws/${SESI}`, // dipatok ulang oleh web
          tiket: 't'.repeat(43),
          kedaluwarsa: '2026-11-09T00:00:30.000Z',
        },
      });
      const t = await tiket(ev(req('POST'), u.id));
      expect(t.status).toBe(201);
      expect(calls.at(-1)?.host).toBe('100.101.1.2:4330');
      // Laptop memakai rahasianya sendiri, bukan PENDAMPING_INTERNAL_TOKEN.
      const c = calls.at(-1)!;
      expect(c.tanda).toBe(
        tandaInternal(TOKEN_LAPTOP, c.waktu!, c.nonce!, 'POST', '/internal/sesi/tiket', c.raw),
      );
      expect(((await t.json()) as any).wsUrl).toBe(`${WS}/w/laptop-a/ws/${SESI}`);
    });

    it('tanpa worker id yang sehat -> 503 jujur + urusan beralih ke dipandu (bukan "tampilan berubah")', async () => {
      const u = urusanDenganEksekusi();
      kesehatan = (host) => (host.startsWith('100.101') ? 'mati' : { status: 200, body: SEHAT });
      const r = await mulai(ev(req('POST', { executionId: 'x_1' }), u.id));
      expect(r.status).toBe(503);
      expect(await r.json()).toEqual({
        kode: 'PENDAMPING_WILAYAH_TIDAK_TERSEDIA',
        pesanWarga: PESAN_WILAYAH,
      });
      expect(calls).toHaveLength(0);
      const evs = rt.store.eventsAfter(u.id);
      const labels = evs
        .filter((e) => e.type === 'progress')
        .map((e) => (e.payload as { label: string }).label);
      expect(labels).toContain(PESAN_WILAYAH);
      expect(labels.join()).not.toContain('Tampilan situs berubah');
      expect(evs.some((e) => e.type === 'degraded')).toBe(true);
      expect(
        evs.some((e) => e.type === 'state' && (e.payload as { state: string }).state === 'DIPANDU'),
      ).toBe(true);
    });

    it('situs umum: worker non-id lebih dulu, lalu beban terendah; worker id hanya cadangan', async () => {
      const cfg = pendampingConfig(process.env) as PendampingConfig;
      const OSS = 'https://oss.go.id';
      kesehatan = (host) => ({
        status: 200,
        body: host.startsWith('127.0.0.1') ? { ...SEHAT, aktif: 2, menunggu: 3 } : SEHAT,
      });
      expect((await pilihWorker(cfg, OSS, 'u1'))?.id).toBe('vps');
      resetBrokerPendamping();
      kesehatan = (host) =>
        host.startsWith('127.0.0.1') ? { status: 503, body: {} } : { status: 200, body: SEHAT };
      expect((await pilihWorker(cfg, OSS, 'u1'))?.id).toBe('laptop-a');
      // Dua worker umum: beban (aktif+menunggu)/min(maxSessions, maks) terendah menang.
      const dua: PendampingConfig = {
        token: 't',
        workers: [VPS, { ...VPS, id: 'vps-b', url: 'http://127.0.0.2:4330' }],
      };
      resetBrokerPendamping();
      kesehatan = (host) => ({
        status: 200,
        body: host.startsWith('127.0.0.2') ? SEHAT : { ...SEHAT, aktif: 1 },
      });
      expect((await pilihWorker(dua, OSS, 'u2'))?.id).toBe('vps-b');
      resetBrokerPendamping();
      kesehatan = () => 'mati';
      expect(await pilihWorker(dua, OSS, 'u2')).toBeNull();
      expect(await pilihWorker(dua, 'bukan url', 'u2')).toBeNull();
    });

    it('setelah web restart: pemegang sesi ditemukan lewat status; 404 di semua worker diteruskan', async () => {
      const u = urusanDenganEksekusi();
      reply = (_p, _b, host) =>
        host.startsWith('100.101')
          ? { status: 200, body: sesi({ mode: 'ai', status: 'berjalan' }) }
          : { status: 404, body: { kode: 'SESI_TIDAK_ADA', pesanWarga: 'tidak ada sesi pendamping' } };
      expect((await status(ev(req('GET'), u.id))).status).toBe(200);
      calls = [];
      expect((await serahkan(ev(req('POST'), u.id))).status).toBe(200);
      expect(calls.map((c) => c.host)).toEqual(['100.101.1.2:4330']);
      reply = () => ({
        status: 404,
        body: { kode: 'SESI_TIDAK_ADA', pesanWarga: 'tidak ada sesi pendamping' },
      });
      const r = await akhiri(ev(req('DELETE'), u.id));
      expect(r.status).toBe(404);
      expect(((await r.json()) as any).kode).toBe('SESI_TIDAK_ADA');
    });

    it('antrean: gabungan worker sehat; maks dibatasi maxSessions; semua mati -> 503', async () => {
      kesehatan = (host) => ({
        status: 200,
        body: host.startsWith('127.0.0.1')
          ? { ok: true, aktif: 2, maks: 4, menunggu: 1 }
          : { ok: true, aktif: 1, maks: 2, menunggu: 0 },
      });
      expect(await (await antrean({} as never)).json()).toEqual({ aktif: 3, maks: 3, menunggu: 1 });
      resetBrokerPendamping();
      kesehatan = () => 'mati';
      expect((await antrean({} as never)).status).toBe(503);
    });
  });

  it('cookie: hanya urusin_sid hex 32 yang sudah ada di request', () => {
    expect(sidDariRequest(new Request(ORIGIN, { headers: { cookie: `a=1; urusin_sid=${SID}` } }))).toBe(SID);
    expect(sidDariRequest(new Request(ORIGIN, { headers: { cookie: 'urusin_sid=ZZ' } }))).toBeNull();
    expect(sidDariRequest(new Request(ORIGIN))).toBeNull();
  });

  it('endpoint pengubah state pendamping tunduk pada cek Origin persis', () => {
    for (const path of [
      '/api/urusan/u/pendamping',
      '/api/urusan/u/pendamping/tiket',
      '/api/urusan/u/pendamping/serahkan',
    ])
      expect(checkOrigin('POST', path, 'https://evil.example', ORIGIN)).toMatchObject({ allowed: false });
    expect(checkOrigin('DELETE', '/api/urusan/u/pendamping', null, ORIGIN)).toMatchObject({ allowed: false });
  });
});
