/* eslint-disable @typescript-eslint/no-explicit-any -- tes membaca JSON respons tanpa tipe */
import { createHash } from 'node:crypto';
import { MemoryMailer } from '@urusin/akun/testing';
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
import { POST as izinkanIsi } from '../../routes/api/urusan/[id]/izinkan-isi/+server';
import { POST as tiket } from '../../routes/api/urusan/[id]/pendamping/tiket/+server';
import { POST as terkirim } from '../../routes/api/urusan/[id]/pendamping/terkirim/+server';
import { AKUN_COOKIE } from './akun';
import { checkOrigin } from './origin';
import { daftarWrite } from '../pendamping/isi-data';
import { pemeriksaPemilikVault } from './pendamping/pemilik';
import {
  asalWsLain,
  asalWsUntukCsp,
  hashSid,
  panggil,
  pasangPemeriksaPemilikAkun,
  pendampingConfig,
  PESAN_WILAYAH,
  PESAN_WILAYAH_GAGAL,
  pilihWorker,
  resetBrokerPendamping,
  sidDariRequest,
  skema,
  tambahConnectSrc,
  tandaInternal,
  type PendampingConfig,
} from './pendamping';
import { createRuntime, setRuntimeForTests, type Runtime } from './runtime';
import { SID_COOKIE } from './sesi';
import { hentikanNavigator, navigatorBerjalan } from './pendamping/navigator';

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
  isi: string | null;
};
let calls: Panggilan[];
let reply: (path: string, body: any, host: string) => { status: number; body: unknown };
/** Jawaban GET /health per host worker; 'mati' = koneksi ditolak. */
let kesehatan: (host: string) => { status: number; body: unknown } | 'mati';
const SEHAT = { ok: true, aktif: 0, maks: 2, menunggu: 0, generik: true };

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
      isi: headers.get('x-urusin-isi-sha256'),
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

/** Bawaan Wonogiri (Telunjuk Sakti, `id-utama`); Semarang (Si D'nOK, `id-only`) untuk blokir keras. */
function urusanDenganEksekusi(kota: 'wonogiri' | 'semarang' = 'wonogiri') {
  const u = rt.store.createUrusan({ kodeKabKota: kota === 'semarang' ? '3374' : '3312' });
  rt.publish(u.id, {
    type: 'execution_request',
    executionId: 'x_1',
    adapterId: kota === 'semarang' ? 'sidnok-semarang' : 'telunjuk-sakti-wonogiri',
    flowId: kota === 'semarang' ? 'cek_status' : 'ajukan',
    ringkasan: 'Ajukan layanan 1',
    params: { layanan_id: 1 },
    tool: 'dukcapil__ajukan_layanan',
    paramsHash: 'h',
  });
  return u;
}

const req = (method: string, body?: unknown, cookie: string | null = `${SID_COOKIE}=${SID}`) =>
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
    // Hash isi dideklarasikan di header (ikut ditandatangani bersama panjang): worker memeriksa sebelum membaca.
    expect(c.isi).toBe(createHash('sha256').update(c.raw).digest('hex'));
  });

  it('tanda tangan HMAC: vektor uji sama dengan apps/pendamping (tanda.test.ts)', () => {
    const N = '0123456789abcdef0123456789abcdef';
    const VEKTOR = 'b6089c5b1fef03ec01230fdeacd9cd7ed0d145cfd2f78016e435500f904dcde5';
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
    expect((await mulai(ev(req('POST', { executionId: 'x_1' }, `${SID_COOKIE}=pendek`), u.id))).status).toBe(
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

  it('pengajuan terkirim: TERKIRIM (langkah 5) + nomor permohonan tersimpan di urusan, sekali saja', async () => {
    const u = urusanDenganEksekusi();
    let v = u.version;
    for (const st of [
      'MEMAHAMI',
      'RENCANA_DIUSULKAN',
      'RENCANA_DISETUJUI',
      'MENYIAPKAN_BERKAS',
      'BERKAS_SIAP',
      'MENGISI',
      'MENUNGGU_KONFIRMASI',
      'MENGUNGGAH',
      'MENUNGGU_SUBMIT_WARGA',
    ] as const)
      v = rt.store.transition(u.id, v, st).version;
    reply = () => ({
      status: 200,
      body: sesi({
        status: 'selesai',
        mode: 'done',
        hasil: 'berhasil',
        antrean: null,
        bukti: { nomor: 'FX-REG-0002', status: 'Baru diajukan (data uji)' },
      }),
    });
    await status(ev(req('GET'), u.id));
    await status(ev(req('GET'), u.id));
    expect(rt.store.getUrusanOrThrow(u.id)).toMatchObject({
      state: 'TERKIRIM',
      nomorPermohonan: 'FX-REG-0002',
    });
    const states = rt.store
      .eventsAfter(u.id)
      .filter((e) => e.type === 'state')
      .map((e) => (e.payload as { state: string }).state);
    expect(states.filter((x) => x === 'TERKIRIM')).toHaveLength(1);
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

  describe('"Saya sudah mengirim" (POST /pendamping/terkirim)', () => {
    const TAKEOVER = { status: 200, body: sesi({ status: 'berjalan', mode: 'takeover', antrean: null }) };
    it('worker menerima (tulis warga + halaman sukses): sesi siaga berhasil dicatat sekali + nomor', async () => {
      const u = urusanDenganEksekusi();
      const siaga = sesi({
        status: 'siaga',
        mode: 'takeover',
        hasil: 'berhasil',
        antrean: null,
        bukti: { nomor: 'REG-0009' },
      });
      reply = (path) => (path.endsWith('/selesai') ? { status: 200, body: siaga } : TAKEOVER);
      const r = await terkirim(ev(req('POST'), u.id));
      expect(r.status).toBe(200);
      expect(((await r.json()) as any).hasil).toBe('berhasil');
      // Pemilik saja, tanpa executionId: worker memeriksa halaman saat ini, bukan klaim perangkat.
      expect(
        calls.filter((c) => c.url.endsWith('/selesai')).map((c) => [new URL(c.url).pathname, c.body]),
      ).toEqual([['/internal/sesi/selesai', { urusanId: u.id, sidHash: hashSid(SID) }]]);
      await terkirim(ev(req('POST'), u.id));
      const labels = rt.store
        .eventsAfter(u.id)
        .filter((e) => e.type === 'progress')
        .map((e) => (e.payload as { label: string }).label);
      expect(labels.filter((l) => l.includes('Browser Pendamping melaporkan langkah berhasil'))).toHaveLength(
        1,
      );
    });

    it('worker 409 (belum ada tulis warga / halaman belum sukses): pesan jujur, tidak ada yang dicatat', async () => {
      const u = urusanDenganEksekusi();
      const tolak = { kode: 'PESAN_TIDAK_SAH', pesanWarga: 'halaman belum menunjukkan permohonan terkirim' };
      reply = (path) => (path.endsWith('/selesai') ? { status: 409, body: tolak } : TAKEOVER);
      const r = await terkirim(ev(req('POST'), u.id));
      expect(r.status).toBe(409);
      expect(await r.json()).toEqual({
        kode: 'BELUM_TERKIRIM',
        pesanWarga: 'Belum terlihat terkirim. Periksa halaman situsnya, lalu coba lagi.',
      });
      expect(rt.store.eventsAfter(u.id).filter((e) => e.type === 'progress')).toHaveLength(0);
    });

    it('bukan pemilik -> 404, tanpa cookie sesi -> 401, Origin asing ditolak; worker tidak dipanggil', async () => {
      const u = urusanDenganEksekusi();
      pasangPemeriksaPemilikAkun(() => false);
      expect((await terkirim(ev(req('POST'), u.id))).status).toBe(404);
      pasangPemeriksaPemilikAkun(undefined);
      expect((await terkirim(ev(req('POST', undefined, null), u.id))).status).toBe(401);
      expect((await terkirim(ev(req('POST'), 'u_tidak_ada'))).status).toBe(404);
      expect(calls).toHaveLength(0);
      expect(
        checkOrigin('POST', `/api/urusan/${u.id}/pendamping/terkirim`, 'https://evil.example', ORIGIN),
      ).toMatchObject({ allowed: false });
    });
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
      body: sesi({
        executionId: 'x_pkb',
        status: 'siaga',
        mode: 'ai',
        hasil: 'berhasil',
        antrean: null,
        bukti: { nomor: 'PKB-1' },
      }),
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
    // Baca-saja tidak mengirim apa pun: tidak ada nomor permohonan.
    expect(rt.store.getUrusanOrThrow(u.id).nomorPermohonan).toBeNull();

    // Origin di permintaan yang bukan domain resmi ditolak sebelum memanggil worker.
    rt.publish(u.id, { ...pkb, executionId: 'x_palsu', origin: 'https://contoh.example.com' });
    const n = calls.length;
    const r = await mulai(ev(req('POST', { executionId: 'x_palsu' }), u.id));
    expect(r.status).toBe(422);
    expect(calls).toHaveLength(n);
  });

  describe('Izinkan isi -> controller isi di server (A-M1) + pemilik akun (m6)', () => {
    const HP = ['0800', '0000', '001'].join('');
    const SITUS = 'https://telunjuksakti.wonogirikab.go.id';
    const FIXTURES = 'https://fixtures.urusinai.web.id';
    const PH = ['{{PEMOHON.NIK}}', '{{PEMOHON.HP}}', '{{URUSAN.KITIR}}'];
    const BUTUH = { placeholder: PH, berkas: ['ktp'], origin: SITUS };
    const KTX = { ip: '127.0.0.1', userAgent: null };
    const SID_LAIN = 'cd'.repeat(16);

    /** Runtime dengan modul akun nyata: Data Diri + Dokumen tamu (cookie SID), urusan milik tamu itu. */
    function siapkan(pemilikSid = SID) {
      rt = createRuntime({
        provider: new DemoProvider(),
        config: { dbPath: ':memory:' },
        akun: { mailer: new MemoryMailer(), google: null, vault: { diskPersen: () => 10 } },
      });
      setRuntimeForTests(rt);
      const tamu = rt.akun.pastikanTamu(SID, KTX);
      rt.akun.vault.setDataDiri(tamu, { namaLengkap: 'Warga Uji', nik: NIK, hp: HP });
      rt.akun.vault.putDocument(tamu, {
        jenis: 'ktp',
        judul: 'KTP saya',
        mime: 'image/png',
        bytes: Buffer.from([1, 2, 3]),
      });
      const u = urusanDenganEksekusi();
      if (pemilikSid !== SID) rt.akun.pastikanTamu(pemilikSid, KTX);
      rt.akun.catatPemilikUrusan(u.id, { sid: pemilikSid });
      // Lokasi sesi belum tercatat: pemegang dicari lewat /status (tanpa isi), lalu jalur isi ke pemegang itu.
      reply = (path) =>
        path === '/internal/sesi/status'
          ? { status: 200, body: sesi() }
          : path === '/internal/sesi/butuh'
            ? { status: 200, body: BUTUH }
            : path === '/internal/sesi/berkas'
              ? { status: 200, body: { placeholder: ['{{PEMOHON.NIK}}', '{{URUSAN.KITIR}}'], berkas: [] } }
              : { status: 200, body: { placeholder: ['{{URUSAN.KITIR}}'], berkas: [] } };
      return u;
    }
    const kirim = (id: string, body: unknown, sid = SID) =>
      izinkanIsi({
        request: new Request(`${ORIGIN}/api/urusan/${id}/izinkan-isi`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: ORIGIN, cookie: `${SID_COOKIE}=${sid}` },
          body: JSON.stringify(body),
        }),
        params: { id },
        locals: { sid },
      } as never);
    const jalur = () => calls.map((c) => new URL(c.url).pathname);

    it('daftar write + origin butuh_data -> nilai diselesaikan server, dikirim ke sesi; jawaban tanpa nilai', async () => {
      const u = siapkan();
      const writeList = daftarWrite(BUTUH.placeholder, BUTUH.berkas);
      expect(writeList).toEqual(['{{PEMOHON.NIK}}', '{{PEMOHON.HP}}', 'berkas:KTP']);
      const res = await kirim(u.id, { writeList, targetOrigin: BUTUH.origin });
      expect(res.status).toBe(200);
      const teks = await res.text();
      expect(JSON.parse(teks)).toEqual({ diizinkan: true, kurang: ['Nomor kitir'] });
      expect(teks).not.toContain(NIK);
      // Berkas dulu, isian TERAKHIR (worker memulai AI pada panggilan isi).
      expect(jalur()).toEqual([
        '/internal/sesi/status',
        '/internal/sesi/butuh',
        '/internal/sesi/berkas',
        '/internal/sesi/isi',
      ]);
      const owner = { urusanId: u.id, sidHash: hashSid(SID) };
      expect(calls[0]!.body).toEqual(owner);
      expect(calls[1]!.body).toEqual(owner);
      // Hanya placeholder yang dibutuhkan sesi; nama berkas adapter (huruf kecil) dipertahankan.
      expect(calls[2]!.body).toEqual({
        ...owner,
        nama: 'ktp',
        namaBerkas: 'KTP saya',
        mime: 'image/png',
        dataBase64: 'AQID',
      });
      expect(calls[3]!.body).toEqual({ ...owner, isian: { '{{PEMOHON.NIK}}': NIK, '{{PEMOHON.HP}}': HP } });
      // Kanal internal bertanda tangan HMAC.
      expect(calls[3]!.tanda).toBe(
        tandaInternal(
          'token-uji',
          calls[3]!.waktu!,
          calls[3]!.nonce!,
          'POST',
          '/internal/sesi/isi',
          calls[3]!.raw,
        ),
      );
      expect(JSON.stringify(rt.store.eventsAfter(u.id))).not.toContain(NIK);
      // Persetujuan sekali pakai: sesi yang meminta lagi butuh "Izinkan isi" baru.
      calls = [];
      const lagi = await kirim(u.id, { writeList, targetOrigin: BUTUH.origin });
      expect(lagi.status).toBe(200);
    });

    it('Navigator generik: rencanaHash dari butuh ikut ke /internal/sesi/isi (worker menolak isi tanpa itu)', async () => {
      const u = siapkan();
      const H = 'e'.repeat(64);
      const butuhGenerik = {
        placeholder: ['{{PEMOHON.NIK}}'],
        berkas: [],
        origin: SITUS,
        kolom: [{ placeholder: '{{PEMOHON.NIK}}', labelPortal: 'NIK Pemohon' }],
        rencanaHash: H,
      };
      const asal = reply;
      reply = (path, body, host) =>
        path === '/internal/sesi/butuh' ? { status: 200, body: butuhGenerik } : asal(path, body, host);
      const res = await kirim(u.id, { writeList: ['{{PEMOHON.NIK}}'], targetOrigin: SITUS, rencanaHash: H });
      expect(res.status).toBe(200);
      const isi = calls.find((c) => new URL(c.url).pathname === '/internal/sesi/isi');
      expect(isi?.body).toEqual({
        urusanId: u.id,
        sidHash: hashSid(SID),
        isian: { '{{PEMOHON.NIK}}': NIK },
        rencanaHash: H,
        // Berkas yang disetujui di putaran INI (kosong: lembar tanpa berkas).
        berkas: [],
      });
      // Persetujuan untuk rencana lain tidak bisa dipakai untuk halaman ini.
      calls = [];
      const lain = await kirim(u.id, {
        writeList: ['{{PEMOHON.NIK}}'],
        targetOrigin: SITUS,
        rencanaHash: 'f'.repeat(64),
      });
      expect(lain.status).toBe(403);
      expect(jalur()).not.toContain('/internal/sesi/isi');
    });

    it('origin sesi hidup beda dengan targetOrigin persetujuan -> 403 tanpa nilai ke worker', async () => {
      const u = siapkan();
      // Situs latihan ada di allowlist, tetapi sesi sedang membuka portal Wonogiri.
      const res = await kirim(u.id, {
        writeList: ['{{PEMOHON.NIK}}'],
        targetOrigin: FIXTURES,
      });
      expect(res.status).toBe(403);
      expect(((await res.json()) as any).kode).toBe('IZIN_TIDAK_VALID');
      expect(jalur()).toEqual(['/internal/sesi/status', '/internal/sesi/butuh']);
    });

    it('targetOrigin di luar registry kirim-asli/situs latihan -> 403 sebelum worker dipanggil', async () => {
      const u = siapkan();
      for (const asing of ['https://evil.example.com', 'https://sidnok.semarangkota.go.id']) {
        const res = await kirim(u.id, { writeList: ['{{PEMOHON.NIK}}'], targetOrigin: asing });
        expect([asing, res.status]).toEqual([asing, 403]);
      }
      expect(calls).toHaveLength(0);
    });

    it('sesi tidak menunggu data (409 dari worker) diteruskan apa adanya, tanpa nilai', async () => {
      const u = siapkan();
      reply = (path) =>
        path === '/internal/sesi/status'
          ? { status: 200, body: sesi() }
          : { status: 409, body: { kode: 'PESAN_TIDAK_SAH', pesanWarga: 'x' } };
      const res = await kirim(u.id, { writeList: ['{{PEMOHON.NIK}}'], targetOrigin: SITUS });
      expect(res.status).toBe(409);
      expect(jalur()).not.toContain('/internal/sesi/isi');
    });

    it('salinan demo juri: HP Data Diri lewat jalur placeholder = persis HP uji replika (08000000001)', async () => {
      const u = siapkan();
      const { akun: juri } = rt.akun.buatDemo(KTX);
      rt.akun.catatPemilikUrusan(u.id, { akun: juri });
      const writeList = daftarWrite(BUTUH.placeholder, BUTUH.berkas);
      const res = await izinkanIsi({
        request: new Request(`${ORIGIN}/api/urusan/${u.id}/izinkan-isi`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: ORIGIN, cookie: `${SID_COOKIE}=${SID}` },
          body: JSON.stringify({ writeList, targetOrigin: BUTUH.origin }),
        }),
        params: { id: u.id },
        locals: { sid: SID, akun: juri },
      } as never);
      expect(res.status).toBe(200);
      const isi = calls.find((c) => new URL(c.url).pathname === '/internal/sesi/isi');
      // String yang diketik AI ke kolom HP replika Telunjuk Sakti = apps/fixtures TEST_HP, tanpa normalisasi.
      expect((isi!.body as { isian: Record<string, string> }).isian['{{PEMOHON.HP}}']).toBe('08000000001');
    });

    it('m6: urusan milik orang lain -> 404 di izinkan-isi dan semua endpoint pendamping, tanpa panggil worker', async () => {
      const u = siapkan(SID_LAIN);
      pasangPemeriksaPemilikAkun(pemeriksaPemilikVault);
      const isi = await kirim(u.id, { writeList: ['{{PEMOHON.NIK}}'], targetOrigin: SITUS });
      expect(isi.status).toBe(404);
      expect((await mulai(ev(req('POST', { executionId: 'x_1' }), u.id))).status).toBe(404);
      expect((await status(ev(req('GET'), u.id))).status).toBe(404);
      expect((await tiket(ev(req('POST'), u.id))).status).toBe(404);
      expect((await serahkan(ev(req('POST'), u.id))).status).toBe(404);
      expect((await akhiri(ev(req('DELETE'), u.id))).status).toBe(404);
      expect(calls).toHaveLength(0);
      // Urusan tanpa catatan pemilik juga bukan milik siapa pun.
      const yatim = urusanDenganEksekusi();
      expect((await tiket(ev(req('POST'), yatim.id))).status).toBe(404);
      // Pemilik sah (cookie yang sama) lolos.
      const milik = siapkan();
      pasangPemeriksaPemilikAkun(pemeriksaPemilikVault);
      reply = () => ({ status: 201, body: sesi() });
      expect((await mulai(ev(req('POST', { executionId: 'x_1' }), milik.id))).status).toBe(201);
      // Cek pemilik = cek rute urusan lain (urusanMilik), bukan vault: urusan dari form tanpa turn (belum ada
      // baris tamu/vault) tetap bisa membuka Pendamping oleh pemiliknya; vault diperiksa terpisah saat mengisi.
      const sidForm = 'cd'.repeat(16);
      const form = urusanDenganEksekusi();
      rt.akun.catatPemilikUrusan(form.id, { sid: sidForm });
      expect(rt.akun.tamuDariSid(sidForm)).toBeUndefined();
      expect((await status(ev(req('GET', undefined, `${SID_COOKIE}=${sidForm}`), form.id))).status).not.toBe(
        404,
      );
      expect((await status(ev(req('GET', undefined, `${SID_COOKIE}=${SID}`), form.id))).status).toBe(404);
    });
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

    /**
     * Akun warga yang baru daftar (langsung masuk, tanpa email verifikasi; ADR 0032) dan memiliki urusannya:
     * sesi di portal asli, bukan Mode Uji.
     */
    async function urusanAkunNyata(kota: 'wonogiri' | 'semarang' = 'wonogiri') {
      rt = createRuntime({
        provider: new DemoProvider(),
        config: { dbPath: ':memory:' },
        akun: { mailer: new MemoryMailer(), google: null, vault: { diskPersen: () => 10 } },
      });
      setRuntimeForTests(rt);
      const ktx = { ip: '127.0.0.1', userAgent: null };
      const { token, akun } = await rt.akun.daftar(
        { email: 'warga@example.com', sandi: 'kuda-lari-cepat-9' },
        ktx,
      );
      const u = urusanDenganEksekusi(kota);
      rt.akun.catatPemilikUrusan(u.id, { akun });
      return { u, cookie: `${SID_COOKIE}=${SID}; ${AKUN_COOKIE}=${token}` };
    }

    it('CSP connect-src: hanya origin WS worker di luar origin web (final lokal), produksi tidak berubah', () => {
      const cfg = pendampingConfig(process.env);
      // Produksi: semua wsUrl lewat domain web sendiri -> tercakup 'self', CSP tidak disentuh.
      expect(asalWsLain(cfg, 'https://urusin.test')).toEqual([]);
      const csp = "default-src 'self'; connect-src 'self'; frame-ancestors 'none'";
      expect(tambahConnectSrc(csp, [])).toBe(csp);
      // Final lokal: web http://localhost:3000, WS ke ws://localhost:4330 (port beda = bukan 'self').
      const lokal = pendampingConfig({
        PENDAMPING_INTERNAL_TOKEN: 't',
        PENDAMPING_WORKERS: JSON.stringify([
          { ...LAPTOP, wsUrl: 'ws://localhost:4330/ws' },
          { ...VPS, id: 'b', wsUrl: 'ws://localhost:4330/ws' },
          { ...VPS, id: 'c', wsUrl: 'ws://localhost:3000/pendamping/ws' },
        ]),
      });
      const asal = asalWsLain(lokal, 'http://localhost:3000');
      expect(asal).toEqual(['ws://localhost:4330']);
      expect(tambahConnectSrc(csp, asal)).toBe(
        "default-src 'self'; connect-src 'self' ws://localhost:4330; frame-ancestors 'none'",
      );
      expect(asalWsLain(null, 'http://localhost:3000')).toEqual([]);
    });

    it('CSP hook: PENDAMPING_PUBLIC_WS_URL rusak -> konfigurasi null; galat -> CSP lama; dihitung sekali', () => {
      const satu = (ws: string) => ({
        PENDAMPING_INTERNAL_TOKEN: 't',
        PENDAMPING_INTERNAL_URL: 'http://127.0.0.1:4330',
        PENDAMPING_PUBLIC_WS_URL: ws,
      });
      // Dulu diteruskan mentah dan `new URL()` di hooks melempar pada SETIAP permintaan halaman.
      for (const rusak of ['bukan url', 'https://urusin.test/pendamping/ws', 'ws://x/ws?a=1', 'ws://x/ws#h'])
        expect(pendampingConfig(satu(rusak)), rusak).toBeNull();
      expect(pendampingConfig(satu('ws://localhost:4330/ws/'))?.workers[0]?.wsUrl).toBe(
        'ws://localhost:4330/ws',
      );
      // PENDAMPING_WORKERS dengan URL yang tidak bisa diurai: null, bukan melempar (refine zod tetap jalan).
      const env = (w: object) => ({
        PENDAMPING_INTERNAL_TOKEN: 't',
        PENDAMPING_WORKERS: JSON.stringify([w]),
      });
      expect(pendampingConfig(env({ ...VPS, wsUrl: 'bukan url' }))).toBeNull();
      expect(pendampingConfig(env({ ...VPS, url: 'bukan url' }))).toBeNull();
      expect(pendampingConfig(env({ ...LAPTOP, url: 'bukan url', token: undefined }))).toBeNull();
      // Origin web rusak (melempar) -> daftar kosong: CSP aplikasi dikirim apa adanya.
      expect(
        asalWsUntukCsp(() => {
          throw new Error('URUSIN_PUBLIC_ORIGIN rusak');
        }, satu('ws://localhost:4330/ws')),
      ).toEqual([]);
      // Memo per proses: hasil pertama dipakai terus, konfigurasi tidak dibaca ulang per permintaan.
      resetBrokerPendamping();
      let dibaca = 0;
      const origin = () => (dibaca++, 'http://localhost:3000');
      expect(asalWsUntukCsp(origin, satu('ws://localhost:4330/ws'))).toEqual(['ws://localhost:4330']);
      expect(asalWsUntukCsp(origin, satu('ws://localhost:9999/ws'))).toEqual(['ws://localhost:4330']);
      expect(dibaca).toBe(1);
    });

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

    it('akun warga, situs id-utama, worker id sehat -> worker id didahulukan; tiket ke worker yang sama', async () => {
      const { u, cookie } = await urusanAkunNyata();
      expect((await mulai(ev(req('POST', { executionId: 'x_1' }, cookie), u.id))).status).toBe(201);
      expect(calls[0]).toMatchObject({
        host: '100.101.1.2:4330',
        url: 'http://100.101.1.2:4330/internal/sesi',
        body: { modeUji: false, origin: 'https://telunjuksakti.wonogirikab.go.id' },
      });
      reply = () => ({
        status: 201,
        body: {
          wsUrl: `wss://evil.example/ws/${SESI}`, // dipatok ulang oleh web
          tiket: 't'.repeat(43),
          kedaluwarsa: '2026-11-09T00:00:30.000Z',
        },
      });
      const t = await tiket(ev(req('POST', undefined, cookie), u.id));
      expect(t.status).toBe(201);
      expect(calls.at(-1)?.host).toBe('100.101.1.2:4330');
      // Laptop memakai rahasianya sendiri, bukan PENDAMPING_INTERNAL_TOKEN.
      const c = calls.at(-1)!;
      expect(c.tanda).toBe(
        tandaInternal(TOKEN_LAPTOP, c.waktu!, c.nonce!, 'POST', '/internal/sesi/tiket', c.raw),
      );
      expect(((await t.json()) as any).wsUrl).toBe(`${WS}/w/laptop-a/ws/${SESI}`);
    });

    it('Mode Uji (tamu/juri) tanpa worker id yang sehat -> sesi dibuat di worker umum (replika fixtures)', async () => {
      const u = urusanDenganEksekusi();
      kesehatan = (host) => (host.startsWith('100.101') ? 'mati' : { status: 200, body: SEHAT });
      const r = await mulai(ev(req('POST', { executionId: 'x_1' }), u.id));
      expect(r.status).toBe(201);
      // Origin resmi tetap dikirim; worker memetakannya ke replika fixtures (modeUji) atau menolak.
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        host: '127.0.0.1:4330',
        body: { modeUji: true, origin: 'https://telunjuksakti.wonogirikab.go.id' },
      });
      const evs = rt.store.eventsAfter(u.id);
      expect(JSON.stringify(evs)).not.toContain(PESAN_WILAYAH);
      expect(evs.some((e) => e.type === 'degraded')).toBe(false);
      // Mode Uji tak mewajibkan worker id, tapi juga tak menolaknya bila hanya itu yang hidup.
      resetBrokerPendamping();
      calls = [];
      kesehatan = (host) => (host.startsWith('127.0.0.1') ? 'mati' : { status: 200, body: SEHAT });
      expect((await mulai(ev(req('POST', { executionId: 'x_1' }), u.id))).status).toBe(201);
      expect(calls[0]?.host).toBe('100.101.1.2:4330');
    });

    it('akun warga, situs id-utama, laptop mati -> server melayani (tanpa pesan wilayah, tanpa dipandu)', async () => {
      const { u, cookie } = await urusanAkunNyata();
      kesehatan = (host) => (host.startsWith('100.101') ? 'mati' : { status: 200, body: SEHAT });
      const r = await mulai(ev(req('POST', { executionId: 'x_1' }, cookie), u.id));
      expect(r.status).toBe(201);
      expect(calls[0]).toMatchObject({
        host: '127.0.0.1:4330',
        body: { modeUji: false, origin: 'https://telunjuksakti.wonogirikab.go.id' },
      });
      const evs = rt.store.eventsAfter(u.id);
      expect(JSON.stringify(evs)).not.toContain(PESAN_WILAYAH);
      expect(evs.some((e) => e.type === 'degraded')).toBe(false);
    });

    it('id-utama, laptop penuh (aktif 1 / maks 1) -> server; urusan itu tetap lekat di server walau laptop lowong', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        const { u, cookie } = await urusanAkunNyata();
        kesehatan = (host) => ({
          status: 200,
          body: host.startsWith('100.101') ? { ...SEHAT, aktif: 1, maks: 1 } : SEHAT,
        });
        expect((await mulai(ev(req('POST', { executionId: 'x_1' }, cookie), u.id))).status).toBe(201);
        expect(calls.map((c) => c.host)).toEqual(['127.0.0.1:4330']);
        // Laptop lowong lagi (cache kesehatan kedaluwarsa), urusan yang sama memulai langkah berikutnya: tetap di
        // server yang memegang sesinya (sesi siaga), tidak pindah ke laptop.
        vi.setSystemTime(Date.now() + 10_000);
        kesehatan = () => ({ status: 200, body: SEHAT });
        calls = [];
        expect((await mulai(ev(req('POST', { executionId: 'x_1' }, cookie), u.id))).status).toBe(201);
        expect(calls.map((c) => c.host)).toEqual(['127.0.0.1:4330']);
        // Urusan lain tetap mendahulukan laptop yang lowong.
        const cfg = pendampingConfig(process.env) as PendampingConfig;
        expect(
          (await pilihWorker(cfg, 'https://telunjuksakti.wonogirikab.go.id', 'lain', undefined, false))?.id,
        ).toBe('laptop-a');
      } finally {
        vi.useRealTimers();
      }
    });

    it('id-utama, laptop sehat tapi start ditolak (401/403/5xx/jaringan) -> server; 401/403 tidak sampai ke warga', async () => {
      for (const gagal of [
        { status: 401, body: { kode: 'TIKET_TIDAK_SAH', pesanWarga: 'Tidak berwenang.' } },
        { status: 403, body: { kode: 'DILARANG', pesanWarga: 'x' } },
        { status: 502, body: {} },
        'putus' as const,
      ]) {
        resetBrokerPendamping();
        const { u, cookie } = await urusanAkunNyata();
        calls = [];
        reply = (_p, _b, host) => {
          if (!host.startsWith('100.101')) return { status: 201, body: sesi() };
          if (gagal === 'putus') throw new Error('ECONNRESET');
          return gagal;
        };
        const r = await mulai(ev(req('POST', { executionId: 'x_1' }, cookie), u.id));
        expect(r.status, JSON.stringify(gagal)).toBe(201);
        // Hanya start (penutupan best-effort sesi yatim untuk kasus putus diuji tersendiri).
        expect(calls.filter((c) => c.url.endsWith('/internal/sesi')).map((c) => c.host)).toEqual([
          '100.101.1.2:4330',
          '127.0.0.1:4330',
        ]);
        // Langkah berikutnya urusan itu lekat di server yang benar-benar memegang sesinya.
        await new Promise((ok) => setTimeout(ok, 20));
        calls = [];
        reply = () => ({ status: 200, body: sesi({ mode: 'ai', status: 'berjalan' }) });
        expect((await status(ev(req('GET', undefined, cookie), u.id))).status).toBe(200);
        expect(calls[0]?.host).toBe('127.0.0.1:4330');
      }
    });

    it('start putus (jaringan/timeout) di laptop lalu dialihkan ke server: sesi laptop ditutup best-effort', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const { u, cookie } = await urusanAkunNyata();
        reply = (p, _b, host) => {
          if (host.startsWith('100.101') && p === '/internal/sesi') throw new Error('ETIMEDOUT');
          return { status: 200, body: sesi({ status: 'dibatalkan' }) };
        };
        expect((await mulai(ev(req('POST', { executionId: 'x_1' }, cookie), u.id))).status).toBe(200);
        await vi.waitFor(() =>
          expect(calls.map((c) => `${c.host}${new URL(c.url).pathname}`)).toContain(
            '100.101.1.2:4330/internal/sesi/akhiri',
          ),
        );
        const akhiri = calls.find((c) => c.url.endsWith('/internal/sesi/akhiri'))!;
        expect(akhiri.body).toEqual({ urusanId: u.id, sidHash: hashSid(SID) });
        // Bertanda tangan dengan token laptop sendiri.
        expect(akhiri.tanda).toBe(
          tandaInternal(
            TOKEN_LAPTOP,
            akhiri.waktu!,
            akhiri.nonce!,
            'POST',
            '/internal/sesi/akhiri',
            akhiri.raw,
          ),
        );
        expect(
          calls.filter((c) => c.host === '100.101.1.2:4330').map((c) => new URL(c.url).pathname),
        ).toEqual(['/internal/sesi', '/internal/sesi/akhiri']);

        // Penutupan yang gagal ditelan: start tetap berhasil, satu baris log tanpa PII (id worker + status).
        resetBrokerPendamping();
        const b = await urusanAkunNyata();
        calls = [];
        reply = (p, _b, host) => {
          if (host.startsWith('100.101')) {
            if (p === '/internal/sesi') throw new Error('ECONNRESET');
            return { status: 500, body: {} };
          }
          return { status: 201, body: sesi() };
        };
        expect((await mulai(ev(req('POST', { executionId: 'x_1' }, b.cookie), b.u.id))).status).toBe(201);
        await vi.waitFor(() =>
          expect(log).toHaveBeenCalledWith(
            'pendamping: penutupan sesi yatim gagal worker=laptop-a status=503',
          ),
        );
        expect(JSON.stringify(log.mock.calls)).not.toContain(b.u.id);
      } finally {
        log.mockRestore();
      }
    });

    it('start ditolak (401/5xx, ada jawaban) -> tidak ada penutupan ke worker itu', async () => {
      const { u, cookie } = await urusanAkunNyata();
      reply = (_p, _b, host) =>
        host.startsWith('100.101') ? { status: 401, body: {} } : { status: 201, body: sesi() };
      expect((await mulai(ev(req('POST', { executionId: 'x_1' }, cookie), u.id))).status).toBe(201);
      await new Promise((r) => setTimeout(r, 20));
      expect(calls.map((c) => new URL(c.url).pathname)).not.toContain('/internal/sesi/akhiri');
    });

    it('id-utama: galat sah untuk warga (403 SESI_BUKAN_MILIK) diteruskan, tanpa mencoba worker lain', async () => {
      const { u, cookie } = await urusanAkunNyata();
      reply = () => ({
        status: 403,
        body: { kode: 'SESI_BUKAN_MILIK', pesanWarga: 'sesi milik perangkat lain' },
      });
      const r = await mulai(ev(req('POST', { executionId: 'x_1' }, cookie), u.id));
      expect(r.status).toBe(403);
      expect(((await r.json()) as { kode: string }).kode).toBe('SESI_BUKAN_MILIK');
      expect(calls.map((c) => c.host)).toEqual(['100.101.1.2:4330']);
    });

    it('id-only: start di laptop gagal (401/5xx/422 image lama) -> 503 jujur + dipandu, TIDAK jatuh ke server', async () => {
      for (const gagal of [
        { status: 401, body: { kode: 'TIKET_TIDAK_SAH', pesanWarga: 'Tidak berwenang.' } },
        { status: 500, body: {} },
        { status: 422, body: { kode: 'ADAPTER_TIDAK_ADA', pesanWarga: 'adapter/flow tidak dikenal' } },
      ]) {
        resetBrokerPendamping();
        const { u, cookie } = await urusanAkunNyata('semarang');
        calls = [];
        reply = (_p, _b, host) => (host.startsWith('100.101') ? gagal : { status: 201, body: sesi() });
        const r = await mulai(ev(req('POST', { executionId: 'x_1' }, cookie), u.id));
        expect(r.status).toBe(503);
        expect(await r.json()).toEqual({
          kode: 'PENDAMPING_WILAYAH_TIDAK_TERSEDIA',
          pesanWarga: PESAN_WILAYAH_GAGAL,
        });
        expect(calls.map((c) => c.host)).toEqual(['100.101.1.2:4330']);
        const evs = rt.store.eventsAfter(u.id);
        expect(
          evs.some((e) => e.type === 'state' && (e.payload as { state: string }).state === 'DIPANDU'),
        ).toBe(true);
        expect(
          evs.some((e) => e.type === 'state' && (e.payload as { state: string }).state === 'GAGAL_AMAN'),
        ).toBe(false);
      }
    });

    it('id-only: galat sah untuk warga (409 SESI_SUDAH_ADA) tetap diteruskan, bukan dipandu', async () => {
      const { u, cookie } = await urusanAkunNyata('semarang');
      reply = () => ({ status: 409, body: { kode: 'SESI_SUDAH_ADA', pesanWarga: 'sudah ada sesi' } });
      const r = await mulai(ev(req('POST', { executionId: 'x_1' }, cookie), u.id));
      expect(r.status).toBe(409);
      expect(((await r.json()) as { kode: string }).kode).toBe('SESI_SUDAH_ADA');
      expect(JSON.stringify(rt.store.eventsAfter(u.id))).not.toContain(PESAN_WILAYAH_GAGAL);
    });

    it('kemampuan `generik` hanya disyaratkan pada worker id (laptop); worker server dirilis bersama web', async () => {
      const cfg = pendampingConfig(process.env) as PendampingConfig;
      const LAMA = { ok: true, aktif: 0, maks: 2, menunggu: 0 };
      kesehatan = () => ({ status: 200, body: LAMA });
      const OSS = 'https://oss.go.id';
      const SBD = 'https://silao.situbondokab.go.id';
      expect((await pilihWorker(cfg, OSS, 'g1', undefined, false, true))?.id).toBe('vps');
      // id-utama generik: laptop lama dilewati, server melayani; sesi adapter tetap boleh di laptop lama.
      expect((await pilihWorker(cfg, SBD, 'g2', undefined, false, true))?.id).toBe('vps');
      expect((await pilihWorker(cfg, SBD, 'g3', undefined, false, false))?.id).toBe('laptop-a');
      expect(await pilihWorker(cfg, 'https://sidnok.semarangkota.go.id', 'g4', undefined, false)).toBeNull();
    });

    it('id-only: laptop sehat tetapi image lama (tanpa `generik`) -> dipandu tanpa memanggil worker', async () => {
      const { u, cookie } = await urusanAkunNyata('semarang');
      kesehatan = (host) =>
        host.startsWith('100.101')
          ? { status: 200, body: { ok: true, aktif: 0, maks: 1, menunggu: 0 } }
          : { status: 200, body: SEHAT };
      const r = await mulai(ev(req('POST', { executionId: 'x_1' }, cookie), u.id));
      expect(r.status).toBe(503);
      expect(await r.json()).toEqual({
        kode: 'PENDAMPING_WILAYAH_TIDAK_TERSEDIA',
        pesanWarga: PESAN_WILAYAH,
      });
      expect(calls).toHaveLength(0);
    });

    it('situs id-utama tanpa worker sehat sama sekali -> 503 umum, bukan pesan wilayah/dipandu', async () => {
      const { u, cookie } = await urusanAkunNyata();
      kesehatan = () => 'mati';
      const r = await mulai(ev(req('POST', { executionId: 'x_1' }, cookie), u.id));
      expect(r.status).toBe(503);
      expect(((await r.json()) as { kode: string }).kode).toBe('LAYANAN_TIDAK_TERSEDIA');
      const evs = rt.store.eventsAfter(u.id);
      expect(JSON.stringify(evs)).not.toContain(PESAN_WILAYAH);
      expect(evs.some((e) => e.type === 'degraded')).toBe(false);
    });

    it('pilihWorker: id-utama mendahulukan id, id-only hanya id, situs umum mendahulukan non-id', async () => {
      const cfg = pendampingConfig(process.env) as PendampingConfig;
      const TS = 'https://telunjuksakti.wonogirikab.go.id';
      const SMG = 'https://sidnok.semarangkota.go.id';
      expect((await pilihWorker(cfg, TS, 'a1', undefined, false))?.id).toBe('laptop-a');
      expect((await pilihWorker(cfg, SMG, 'a2', undefined, false))?.id).toBe('laptop-a');
      expect((await pilihWorker(cfg, 'https://oss.go.id', 'a3', undefined, false))?.id).toBe('vps');
      // Mode Uji: tanpa syarat wilayah, laptop dihemat.
      expect((await pilihWorker(cfg, TS, 'a4', undefined, true))?.id).toBe('vps');
      resetBrokerPendamping();
      kesehatan = (host) => (host.startsWith('100.101') ? 'mati' : { status: 200, body: SEHAT });
      expect((await pilihWorker(cfg, TS, 'b1', undefined, false))?.id).toBe('vps');
      expect(await pilihWorker(cfg, SMG, 'b2', undefined, false)).toBeNull();
    });

    it('akun warga, situs id-only (blokir keras) tanpa worker id sehat -> 503 jujur + dipandu', async () => {
      const { u, cookie } = await urusanAkunNyata('semarang');
      kesehatan = (host) => (host.startsWith('100.101') ? 'mati' : { status: 200, body: SEHAT });
      const r = await mulai(ev(req('POST', { executionId: 'x_1' }, cookie), u.id));
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

    it('setelah web restart, DUA worker memegang sesi urusan ini: pakai yang hidup dan terbaru, tutup sisanya', async () => {
      const u = urusanDenganEksekusi();
      const lama = sesi({
        sesiId: 'lama',
        status: 'berjalan',
        mode: 'ai',
        dibuatPada: '2026-11-09T00:00:00.000Z',
      });
      const baru = sesi({
        sesiId: 'baru',
        status: 'berjalan',
        mode: 'ai',
        dibuatPada: '2026-11-09T00:05:00.000Z',
      });
      // Laptop (urutan pertama di konfigurasi) memegang sesi LAMA, server sesi BARU.
      reply = (p, _b, host) =>
        p === '/internal/sesi/akhiri'
          ? { status: 200, body: { ...lama, status: 'dibatalkan' } }
          : { status: 200, body: host.startsWith('100.101') ? lama : baru };
      const r = await status(ev(req('GET'), u.id));
      expect(r.status).toBe(200);
      expect(((await r.json()) as any).sesiId).toBe('baru');
      await vi.waitFor(() =>
        expect(calls.map((c) => `${c.host}${new URL(c.url).pathname}`)).toContain(
          '100.101.1.2:4330/internal/sesi/akhiri',
        ),
      );
      expect(calls.filter((c) => c.url.endsWith('/akhiri')).map((c) => c.host)).toEqual(['100.101.1.2:4330']);
      // Langkah berikutnya ke worker terpilih saja.
      calls = [];
      expect((await serahkan(ev(req('POST'), u.id))).status).toBe(200);
      expect(calls.map((c) => c.host)).toEqual(['127.0.0.1:4330']);

      // Sesi yang sudah berakhir kalah dari sesi hidup walau lebih baru, dan tidak perlu ditutup.
      resetBrokerPendamping();
      calls = [];
      reply = (_p, _b, host) => ({
        status: 200,
        body: host.startsWith('100.101') ? { ...baru, status: 'selesai', mode: 'done' } : lama,
      });
      const r2 = await status(ev(req('GET'), u.id));
      expect(((await r2.json()) as any).sesiId).toBe('lama');
      await new Promise((ok) => setTimeout(ok, 20));
      expect(calls.map((c) => new URL(c.url).pathname)).not.toContain('/internal/sesi/akhiri');
    });

    it('L5: sesi generik asli mengikuti catatan registry saja; portal tanpa catatan tidak diutamakan ke laptop', async () => {
      const cfg = pendampingConfig(process.env) as PendampingConfig;
      const SBY = 'https://wargaklampid-dispendukcapil.surabaya.go.id';
      kesehatan = () => ({ status: 200, body: SEHAT });
      // Surabaya tanpa catatan aksesWilayah: worker server dulu, walau laptop berjaringan Indonesia sehat.
      expect((await pilihWorker(cfg, SBY, 'u1', undefined, false))?.id).toBe('vps');
      // Makassar `id-utama` terukur (interstitial Turnstile dari IP pusat data): laptop diutamakan.
      expect(
        (await pilihWorker(cfg, 'https://dukcapil.makassarkota.go.id', 'u2', undefined, false))?.id,
      ).toBe('laptop-a');
      // Mode Uji (replika): urutan biasa, worker server dulu.
      expect((await pilihWorker(cfg, 'https://dukcapil.makassarkota.go.id', 'u3', undefined, true))?.id).toBe(
        'vps',
      );
      resetBrokerPendamping();
      kesehatan = (host) => (host.startsWith('100.101') ? 'mati' : { status: 200, body: SEHAT });
      // Tidak bergantung laptop: portal biasa tetap jalan di worker server.
      expect((await pilihWorker(cfg, SBY, 'u1', undefined, false))?.id).toBe('vps');
      // Host `id-only` di registry (bukti nyata menolak IP pusat data): tanpa worker id = null (dipandu).
      const SMG = 'https://sidnok.semarangkota.go.id';
      expect(await pilihWorker(cfg, SMG, 'u4', undefined, false)).toBeNull();
    });

    it('N3: POST mulai generik tidak memasang loop untuk sesi siaga/berakhir, atau ulang untuk eksekusi yang pernah jalan', async () => {
      const u = urusanDenganEksekusi();
      rt.publish(u.id, {
        type: 'execution_request',
        executionId: 'x_n3',
        adapterId: 'generik',
        flowId: 'kelahiran',
        ringkasan: 'Ajukan akta kelahiran',
        params: { jenis: 'kelahiran', kode: '3312' },
        tool: 'dukcapil__ajukan_layanan',
        paramsHash: 'h',
      });
      const post = () => mulai(ev(req('POST', { executionId: 'x_n3' }), u.id));
      // Sesi siaga (langkah sebelumnya sudah selesai): tidak ada yang digerakkan.
      reply = () => ({
        status: 201,
        body: sesi({ executionId: 'x_n3', status: 'siaga', mode: 'done', antrean: null }),
      });
      expect((await post()).status).toBe(201);
      expect(navigatorBerjalan(u.id)).toBeUndefined();
      // Sesi baru (peramban masih dimulai, worker menjawab 409 belum siap): loop dipasang dan menunggu.
      reply = (path) =>
        path === '/internal/sesi'
          ? { status: 201, body: sesi({ executionId: 'x_n3' }) }
          : { status: 409, body: { kode: 'LAYANAN_TIDAK_TERSEDIA', pesanWarga: 'x' } };
      expect((await post()).status).toBe(201);
      expect(navigatorBerjalan(u.id)).toBe('x_n3');
      hentikanNavigator(u.id);
      await vi.waitFor(() => expect(navigatorBerjalan(u.id)).toBeUndefined(), { timeout: 5_000 });
      // POST ulang (reload) untuk eksekusi yang sama: tidak ada loop baru beranggaran penuh.
      expect((await post()).status).toBe(201);
      expect(navigatorBerjalan(u.id)).toBeUndefined();
    });

    it('mulai sesi generik: Mode Uji membuka akar replika, akun warga membawa jalur portal asli', async () => {
      const generik = (u: { id: string }) =>
        rt.publish(u.id, {
          type: 'execution_request',
          executionId: 'x_gen',
          adapterId: 'generik',
          flowId: 'kelahiran',
          ringkasan: 'Ajukan akta kelahiran',
          params: { jenis: 'kelahiran', kode: '3312', jalur: '/Siap_Om' },
          tool: 'dukcapil__ajukan_layanan',
          paramsHash: 'h',
        });
      const tamu = urusanDenganEksekusi();
      generik(tamu);
      expect((await mulai(ev(req('POST', { executionId: 'x_gen' }), tamu.id))).status).toBe(201);
      expect(calls[0]?.body).toMatchObject({
        modeUji: true,
        params: { jenis: 'kelahiran', kode: '3312', jalur: '/' },
      });
      hentikanNavigator(tamu.id);
      calls = [];
      const { u, cookie } = await urusanAkunNyata();
      generik(u);
      expect((await mulai(ev(req('POST', { executionId: 'x_gen' }, cookie), u.id))).status).toBe(201);
      expect(calls[0]?.body).toMatchObject({ modeUji: false, params: { jalur: '/Siap_Om' } });
      hentikanNavigator(u.id);
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

  it('cookie: hanya __Host-urusin_sid hex 32 yang sudah ada di request', () => {
    expect(sidDariRequest(new Request(ORIGIN, { headers: { cookie: `a=1; ${SID_COOKIE}=${SID}` } }))).toBe(
      SID,
    );
    expect(sidDariRequest(new Request(ORIGIN, { headers: { cookie: `${SID_COOKIE}=ZZ` } }))).toBeNull();
    expect(sidDariRequest(new Request(ORIGIN, { headers: { cookie: `urusin_sid=${SID}` } }))).toBeNull();
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

describe('tamu di portal tanpa situs latihan', () => {
  const eksekusiGenerik = (kode: string) => {
    const u = rt.store.createUrusan({ kodeKabKota: kode });
    rt.publish(u.id, {
      type: 'execution_request',
      executionId: 'x_g',
      adapterId: 'generik',
      flowId: 'kelahiran',
      ringkasan: 'Ajukan akta kelahiran',
      params: { jenis: 'kelahiran', kode },
      tool: 'dukcapil__ajukan_layanan',
      paramsHash: 'h',
    });
    return u;
  };

  it('Sleman (tanpa replika): 403 PERLU_MASUK dengan ajakan masuk/daftar, worker tidak dipanggil', async () => {
    const u = eksekusiGenerik('3404');
    const res = await mulai(ev(req('POST', { executionId: 'x_g' }), u.id));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { kode: string; pesanWarga: string };
    expect(body.kode).toBe('PERLU_MASUK');
    expect(body.pesanWarga).toMatch(/masuk atau daftar/);
    expect(calls.filter((c) => c.url.endsWith('/internal/sesi'))).toHaveLength(0);
  });

  it('Wonogiri (punya replika): tamu tetap ditawari Mode Uji, worker dipanggil dengan modeUji', async () => {
    const u = eksekusiGenerik('3312');
    await mulai(ev(req('POST', { executionId: 'x_g' }), u.id));
    expect(calls.find((c) => c.url.endsWith('/internal/sesi'))?.body).toMatchObject({ modeUji: true });
  });
});

describe('rem Browser Pendamping portal asli (review M1)', () => {
  const evIp = (request: Request, id: string, ip: string) =>
    ({ request, params: { id }, url: new URL(request.url), getClientAddress: () => ip }) as never;

  function runtimeAkun(config: Partial<Runtime['config']> = {}) {
    rt = createRuntime({
      provider: new DemoProvider(),
      config: { dbPath: ':memory:', ...config },
      akun: { mailer: new MemoryMailer(), google: null, vault: { diskPersen: () => 10 } },
    });
    setRuntimeForTests(rt);
  }
  async function wargaBaru(email: string) {
    const { token, akun } = await rt.akun.daftar(
      { email, sandi: 'kuda-lari-cepat-9' },
      { ip: '127.0.0.1', userAgent: null },
    );
    return { akun, cookie: `${SID_COOKIE}=${SID}; ${AKUN_COOKIE}=${token}` };
  }
  function urusanMilik(akun: Parameters<Runtime['akun']['catatPemilikUrusan']>[1]['akun']) {
    const u = urusanDenganEksekusi();
    rt.akun.catatPemilikUrusan(u.id, { akun });
    return u;
  }
  const mulaiSesi = () => calls.filter((c) => c.url.endsWith('/internal/sesi'));

  it('satu sesi asli aktif per akun: urusan kedua ditolak 409 selama sesi pertama masih hidup', async () => {
    runtimeAkun();
    const w = await wargaBaru('warga@example.com');
    const u1 = urusanMilik(w.akun);
    const u2 = urusanMilik(w.akun);
    expect((await mulai(evIp(req('POST', { executionId: 'x_1' }, w.cookie), u1.id, '10.1.1.1'))).status).toBe(
      201,
    );
    reply = (path) => ({ status: path.endsWith('/status') ? 200 : 201, body: sesi({ status: 'berjalan' }) });
    const res = await mulai(evIp(req('POST', { executionId: 'x_1' }, w.cookie), u2.id, '10.1.1.1'));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { kode: string; pesanWarga: string };
    expect(body.kode).toBe('SESI_ASLI_AKTIF');
    expect(body.pesanWarga).toMatch(/masih terbuka untuk urusan lain/);
    expect(mulaiSesi()).toHaveLength(1);
    // Sesi pertama sudah selesai: urusan kedua boleh dimulai.
    reply = (path) => ({ status: path.endsWith('/status') ? 200 : 201, body: sesi({ status: 'selesai' }) });
    expect((await mulai(evIp(req('POST', { executionId: 'x_1' }, w.cookie), u2.id, '10.1.1.1'))).status).toBe(
      201,
    );
    expect(mulaiSesi()).toHaveLength(2);
  });

  it('maksimal 6 sesi mulai per jam per akun: ke-7 ditolak 429 + Retry-After, pesan ramah; muat ulang tidak dihitung', async () => {
    runtimeAkun();
    const w = await wargaBaru('warga@example.com');
    reply = (path) => ({ status: path.endsWith('/status') ? 200 : 201, body: sesi({ status: 'selesai' }) });
    for (let i = 0; i < 6; i++) {
      const u = urusanMilik(w.akun);
      expect(
        (await mulai(evIp(req('POST', { executionId: 'x_1' }, w.cookie), u.id, `10.2.0.${i}`))).status,
      ).toBe(201);
      // POST ulang eksekusi yang sama (muat ulang halaman) tidak memakan kuota
      expect(
        (await mulai(evIp(req('POST', { executionId: 'x_1' }, w.cookie), u.id, `10.2.0.${i}`))).status,
      ).toBe(201);
    }
    const u7 = urusanMilik(w.akun);
    const res = await mulai(evIp(req('POST', { executionId: 'x_1' }, w.cookie), u7.id, '10.2.9.9'));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    const body = (await res.json()) as { kode: string; pesanWarga: string };
    expect(body.kode).toBe('RATE_LIMITED');
    expect(body.pesanWarga).toMatch(/coba lagi dalam ±?\d+ (menit|detik)/);
    expect(mulaiSesi()).toHaveLength(12);
  });

  it('maksimal sesi mulai per jam per IP lintas akun: lewat plafon -> 429; IP lain tetap boleh', async () => {
    runtimeAkun({ pendampingPerJamIp: 2 });
    reply = (path) => ({ status: path.endsWith('/status') ? 200 : 201, body: sesi({ status: 'selesai' }) });
    const warga = [
      await wargaBaru('a@example.com'),
      await wargaBaru('b@example.com'),
      await wargaBaru('c@example.com'),
    ];
    const hasil = [];
    for (const w of warga)
      hasil.push(
        (await mulai(evIp(req('POST', { executionId: 'x_1' }, w.cookie), urusanMilik(w.akun).id, '10.3.3.3')))
          .status,
      );
    expect(hasil).toEqual([201, 201, 429]);
    const c = warga[2]!;
    expect(
      (await mulai(evIp(req('POST', { executionId: 'x_1' }, c.cookie), urusanMilik(c.akun).id, '10.3.3.4')))
        .status,
    ).toBe(201);
  });

  it('Mode Uji (tamu/juri) tidak kena rem: banyak sesi dari satu IP tetap sampai ke worker', async () => {
    runtimeAkun({ pendampingPerJamIp: 1, pendampingPerJamAkun: 1 });
    for (let i = 0; i < 8; i++) {
      const u = urusanDenganEksekusi();
      expect((await mulai(evIp(req('POST', { executionId: 'x_1' }), u.id, '10.4.4.4'))).status).toBe(201);
    }
    expect(mulaiSesi()).toHaveLength(8);
    expect(mulaiSesi().every((c) => c.body.modeUji === true)).toBe(true);
  });
});
