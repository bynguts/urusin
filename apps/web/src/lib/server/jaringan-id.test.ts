/* eslint-disable @typescript-eslint/no-explicit-any -- tes membaca JSON respons/payload tanpa tipe */
import { DemoProvider, aturJaringanId, tetapkanWilayah, usulkanRencanaOtomatis } from '@urusin/harness';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Kebijakan egress diuji di packages/egress; di sini egressFetch diteruskan ke fetch global yang di-stub.
vi.mock('@urusin/egress', async (asli) => ({
  ...(await asli<typeof import('@urusin/egress')>()),
  egressFetch: (input: string | URL, init?: RequestInit) => fetch(input, init),
}));
import { GET as peristiwaApi } from '../../routes/api/peristiwa/[slug]/+server';
import { POST as buatUrusan } from '../../routes/api/urusan/+server';
import { POST as setujui } from '../../routes/api/urusan/[id]/rencana/setujui/+server';
import { POST as tetapkan } from '../../routes/api/urusan/[id]/wilayah/+server';
import {
  jaringanIdSiap,
  pendampingConfig,
  pilihWorker,
  resetBrokerPendamping,
  segarkanJaringanId,
  type PendampingConfig,
} from './pendamping';
import { createRuntime, setRuntimeForTests, type Runtime } from './runtime';

/**
 * Kejujuran tier untuk portal `id-only` (Sidnok Semarang): kartu rencana, persetujuan, dan katalog peristiwa
 * mengikuti worker berjaringan Indonesia yang BENAR-BENAR sehat (pool yang sama dengan pilihWorker). Tanpa itu
 * dipandu dengan alasan jujur sejak kartu; portal `id-utama` (Telunjuk Sakti Wonogiri) tetap di worker server.
 */
const ORIGIN = 'http://localhost:3000';
const SMG = 'https://sidnok.semarangkota.go.id';
const SEHAT = { ok: true, aktif: 0, maks: 2, menunggu: 0 };
const VPS = {
  id: 'vps',
  url: 'http://127.0.0.1:4330',
  region: 'umum',
  maxSessions: 2,
  wsUrl: 'wss://u.test/ws',
};
const LAPTOP = {
  id: 'laptop-a',
  url: 'http://100.101.1.2:4330',
  region: 'id',
  maxSessions: 1,
  wsUrl: 'wss://u.test/w/laptop-a/ws',
  token: 'l'.repeat(40),
};

let rt: Runtime;
let laptopHidup: boolean;
let cekKesehatan: number;

beforeEach(() => {
  rt = createRuntime({
    provider: new DemoProvider(),
    config: { dbPath: ':memory:', heartbeatMs: 15_000, disconnectGraceMs: 0 },
  });
  setRuntimeForTests(rt);
  resetBrokerPendamping();
  // Seperti hooks.server.ts.
  aturJaringanId(jaringanIdSiap);
  vi.stubEnv('PENDAMPING_INTERNAL_TOKEN', 'token-uji');
  vi.stubEnv('PENDAMPING_WORKERS', JSON.stringify([VPS, LAPTOP]));
  laptopHidup = true;
  cekKesehatan = 0;
  vi.stubGlobal('fetch', async (url: string) => {
    const u = new URL(url);
    if (u.pathname !== '/health') throw new Error(`panggilan tak terduga: ${url}`);
    cekKesehatan++;
    if (u.host.startsWith('100.101') && !laptopHidup) throw new Error('ECONNREFUSED');
    return new Response(JSON.stringify(SEHAT), { status: 200 });
  });
});
afterEach(() => {
  aturJaringanId(() => false);
  resetBrokerPendamping();
  setRuntimeForTests(undefined);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function kue() {
  const m = new Map<string, string>();
  return {
    get: (k: string) => m.get(k),
    set: (k: string, v: string) => void m.set(k, v),
    getAll: () => [...m].map(([name, value]) => ({ name, value })),
    delete: (k: string) => void m.delete(k),
    serialize: () => '',
  };
}
const ev = (request: Request, params: Record<string, string> = {}) =>
  ({
    request,
    params,
    url: new URL(request.url),
    locals: { sid: 'sid-uji' },
    cookies: kue(),
    getClientAddress: () => '127.0.0.1',
    setHeaders: () => {},
  }) as never;
const post = (body: unknown) =>
  new Request(`${ORIGIN}/x`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify(body),
  });
const payloads = (id: string, type: string) =>
  rt.store
    .eventsOfType(id, type, 50)
    .reverse()
    .map((e) => e.payload as any);

/** Warga memilih wilayah lewat kartu ("Ya, betul") lalu menekan "Setujui rencana", semuanya lewat route. */
async function alurWarga(kode: string, peristiwa: string, tujuan?: string) {
  const res = await buatUrusan(ev(post({ peristiwa, kodeKabKota: kode })));
  expect(res.status).toBe(201);
  const id = ((await res.json()) as { id: string }).id;
  const ya = (await (await tetapkan(ev(post({ kodeKabKota: kode }), { id }))).json()) as { rencana: boolean };
  if (tujuan) {
    // Tujuan pindah disebut warga di obrolan (agen memanggil wilayah__tetapkan dengan tujuan).
    const pub = (e: Parameters<typeof rt.publish>[1]) => void rt.publish(id, e);
    const cur = tetapkanWilayah(rt.store, rt.store.getUrusanOrThrow(id), { ktp: kode, tujuan }, pub);
    usulkanRencanaOtomatis(rt.store, cur, pub, rt.deps.ragDb);
  } else expect(ya.rencana).toBe(true);
  const kartu = payloads(id, 'plan_card').at(-1);
  const v = rt.store.getUrusanOrThrow(id).version;
  const setuju = (await (await setujui(ev(post({ expectedVersion: v }), { id }))).json()) as {
    pendamping: boolean;
  };
  return { id, kartu, setuju };
}

describe('kejujuran tier portal id-only (worker berjaringan Indonesia)', () => {
  it('segarkanJaringanId: pool id-only yang sama dengan pilihWorker, dengan cache singkat', async () => {
    const cfg = pendampingConfig(process.env) as PendampingConfig;
    expect(await segarkanJaringanId(cfg)).toBe(true);
    expect(jaringanIdSiap()).toBe(true);
    const n = cekKesehatan;
    laptopHidup = false;
    // Masih di dalam cache: tidak memeriksa ulang.
    expect(await segarkanJaringanId(cfg)).toBe(true);
    expect(cekKesehatan).toBe(n);
    resetBrokerPendamping();
    // Hanya worker non-id yang sehat: pool id-only kosong, sama dengan pilihWorker.
    expect(await segarkanJaringanId(cfg)).toBe(false);
    expect(await pilihWorker(cfg, SMG, 'u1', undefined, false)).toBeNull();
    resetBrokerPendamping();
    expect(await segarkanJaringanId(null)).toBe(false);
  });

  it('Semarang tanpa worker ID sehat: dipandu + alasan jujur sejak kartu, tanpa "Setujui dan buka situs"', async () => {
    laptopHidup = false;
    const { id, kartu, setuju } = await alurWarga('3374', 'kelahiran');
    expect(kartu.tier).toBe('dipandu');
    expect(kartu.catatan).toContain('hanya bisa dibuka dari jaringan Indonesia');
    expect(setuju.pendamping).toBe(false);
    expect(payloads(id, 'execution_request')).toHaveLength(0);
    expect(payloads(id, 'progress').map((p) => p.label)).toContainEqual(
      expect.stringContaining('Browser Pendamping berjaringan Indonesia sedang tidak aktif'),
    );
    const view = (await (
      await peristiwaApi(ev(new Request(`${ORIGIN}/x?kodeKabKota=3374`), { slug: 'kelahiran' }))
    ).json()) as {
      tier: string;
    };
    expect(view.tier).toBe('dipandu');
  });

  it('Semarang dengan worker ID sehat: Navigator generik ditawarkan, kartu semi', async () => {
    const { id, kartu, setuju } = await alurWarga('3374', 'kelahiran');
    expect(kartu.tier).toBe('semi');
    expect(setuju.pendamping).toBe(true);
    expect(payloads(id, 'execution_request')[0]).toMatchObject({ adapterId: 'generik', origin: SMG });
  });

  it('pindah Wonogiri (Telunjuk Sakti id-utama) tetap ditawarkan tanpa worker ID: worker server melayani', async () => {
    laptopHidup = false;
    const { id, kartu, setuju } = await alurWarga('3312', 'pindah', '3374');
    expect(kartu.tier).toBe('semi');
    expect(setuju.pendamping).toBe(true);
    expect(payloads(id, 'execution_request')[0]).toMatchObject({
      origin: 'https://telunjuksakti.wonogirikab.go.id',
    });
  });
});
