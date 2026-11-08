/* eslint-disable @typescript-eslint/no-explicit-any -- tes membaca JSON respons tanpa tipe */
import { DemoProvider } from '@urusin/harness';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as antrean } from '../../routes/api/pendamping/antrean/+server';
import {
  DELETE as akhiri,
  GET as status,
  POST as mulai,
} from '../../routes/api/urusan/[id]/pendamping/+server';
import { POST as serahkan } from '../../routes/api/urusan/[id]/pendamping/serahkan/+server';
import { POST as tiket } from '../../routes/api/urusan/[id]/pendamping/tiket/+server';
import { checkOrigin } from './origin';
import { hashSid, panggil, pendampingConfig, sidDariRequest, skema } from './pendamping';
import { createRuntime, setRuntimeForTests, type Runtime } from './runtime';

const ORIGIN = 'http://localhost:3000';
const SID = 'ab'.repeat(16);
const NIK = ['3312', '0101', '0190', '0001'].join('');

let rt: Runtime;
let calls: { url: string; body: any; auth: string | null }[];
let reply: (path: string, body: any) => { status: number; body: unknown };

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
  vi.stubEnv('PENDAMPING_INTERNAL_URL', 'http://pendamping:4000/');
  vi.stubEnv('PENDAMPING_INTERNAL_TOKEN', 'token-uji');
  calls = [];
  reply = () => ({ status: 201, body: sesi() });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body, auth: new Headers(init.headers).get('authorization') });
    const r = reply(new URL(url).pathname, body);
    return new Response(JSON.stringify(r.body), { status: r.status });
  });
});
afterEach(() => {
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
      auth: 'Bearer token-uji',
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
        : path.endsWith('/antrean')
          ? { status: 200, body: { aktif: 1, maks: 2, menunggu: 0 } }
          : { status: 200, body: sesi({ mode: 'takeover' }) };
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
