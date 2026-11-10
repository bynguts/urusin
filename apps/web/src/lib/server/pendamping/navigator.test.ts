import { MemoryMailer } from '@urusin/akun/testing';
import {
  AksiSesiInternalSchema,
  CatatanPendampingSchema,
  TungguSesiInternalSchema,
  type Aksi,
  type Pengamatan,
} from '@urusin/contracts';
import { DemoProvider } from '@urusin/harness';
import { FakeProvider, fakeCompletion } from '@urusin/llm';
import { KATALOG_PLACEHOLDER, PESAN_AMBIL_ALIH, PESAN_BERHENTI } from '@urusin/navigator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fieldDataDiri } from '#lib/pendamping/isi-data.js';
import {
  HEADER_ISI,
  HEADER_NONCE,
  HEADER_TANDA,
  HEADER_WAKTU,
  resetBrokerPendamping,
  tandaInternal,
  type PendampingConfig,
} from '../pendamping';
import { createRuntime, setRuntimeForTests, type Runtime } from '../runtime';
import { hostsFixture, jalankanNavigatorUrusan, tanganWorker } from './navigator';

const TOKEN = 't'.repeat(40);
const CFG: PendampingConfig = {
  token: TOKEN,
  workers: [{ id: 'utama', url: 'http://127.0.0.1:4500', region: 'umum', maxSessions: 4 }],
};
const OWNER = { urusanId: 'u-x', sidHash: 'c'.repeat(64) };

const HOST_REPLIKA = [...hostsFixture()][0]!;
const pengamatan = (host: string): Pengamatan => ({
  v: 1,
  seq: 1,
  host,
  jalur: '/generik/tanpa-akun/tinjau',
  judul: 'Tinjau Permohonan',
  sinyal: {
    login: false,
    otp: false,
    captcha: false,
    tantangan: false,
    halamanAkhir: true,
    sukses: false,
    galatForm: false,
  },
  elemen: [{ ref: 'e1', peran: 'tombol', nama: 'Kirim', kelas: 'kirim' }],
  teks: 'Periksa data Anda.',
  sidik: 'tinjau',
});

/**
 * Worker palsu di balik `fetcher`: memeriksa tanda tangan HMAC dan skema badan setiap panggilan internal, lalu
 * menjawab sesuai kontrak. Setelah `serahkan`, warga dianggap menyelesaikan sendiri (mode done).
 */
function workerPalsu(host: string) {
  const panggilan: { path: string; body: Record<string, unknown> }[] = [];
  let mode: 'ai' | 'takeover' | 'done' = 'ai';
  const fetcher = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (url.pathname === '/health') return json({ ok: true, aktif: 1, maks: 4, menunggu: 0 });
    const h = new Headers(init?.headers);
    const raw = String(init?.body ?? '');
    const tanda = tandaInternal(TOKEN, h.get(HEADER_WAKTU)!, h.get(HEADER_NONCE)!, 'POST', url.pathname, raw);
    if (h.get(HEADER_TANDA) !== tanda || !h.get(HEADER_ISI))
      return json({ kode: 'TIKET_TIDAK_SAH', pesanWarga: 'x' }, 401);
    const body = JSON.parse(raw) as Record<string, unknown>;
    panggilan.push({ path: url.pathname, body });
    switch (url.pathname) {
      // Penemuan worker pemegang sesi (peta lokasi kosong setelah reset).
      case '/internal/sesi/status':
        return json({
          sesiId: 's1',
          urusanId: String(body.urusanId),
          executionId: 'x_uji',
          status: 'berjalan',
          mode,
          antrean: null,
          dibuatPada: '2026-11-10T00:00:00.000Z',
          kedaluwarsaPada: '2026-11-10T01:00:00.000Z',
        });
      case '/internal/sesi/amati':
        return json({ mode, pengamatan: pengamatan(host) });
      case '/internal/sesi/aksi': {
        const a = AksiSesiInternalSchema.parse(body);
        if (a.aksi.some((x: Aksi) => x.jenis === 'serahkan')) mode = 'takeover';
        return json({ mode, hasil: a.aksi.map((_, indeks) => ({ indeks, kode: 'ok' })) });
      }
      case '/internal/sesi/tunggu':
        TungguSesiInternalSchema.parse(body);
        mode = 'done';
        return json({ mode, status: 'selesai', habisWaktu: false });
      default:
        return json({ kode: 'SESI_TIDAK_ADA', pesanWarga: 'x' }, 404);
    }
  };
  return { fetcher, panggilan };
}

let rt: Runtime;
beforeEach(() => {
  resetBrokerPendamping();
  rt = createRuntime({
    provider: new DemoProvider(),
    config: { dbPath: ':memory:', disconnectGraceMs: 0 },
    akun: { mailer: new MemoryMailer(), google: null, vault: { diskPersen: () => 10 } },
  });
  setRuntimeForTests(rt);
});
afterEach(() => setRuntimeForTests(undefined));

const llmFinal = () => ({
  provider: new FakeProvider({
    replies: [
      fakeCompletion({ content: JSON.stringify({ aksi: [{ jenis: 'serahkan', alasan: 'final' }] }) }),
    ],
  }),
  model: 'fake-model',
  caps: { json_schema_strict: true, tools: false },
});

describe('broker Navigator web', () => {
  it('klien worker: HMAC + skema kontrak; long-poll tunggu memakai batas sendiri', async () => {
    const w = workerPalsu(HOST_REPLIKA);
    const tangan = tanganWorker(CFG, OWNER, w.fetcher);
    expect((await tangan.amati()).pengamatan.host).toBe(HOST_REPLIKA);
    const r = await tangan.aksi({
      rencanaHash: 'd'.repeat(64),
      aksi: [{ jenis: 'serahkan', alasan: 'final' }],
      seq: 1,
      kolom: [],
      berkas: [],
    });
    expect(r).toEqual({ mode: 'takeover', hasil: [{ indeks: 0, kode: 'ok' }] });
    expect(await tangan.tunggu(25_000)).toMatchObject({ mode: 'done' });
    expect(w.panggilan.map((p) => p.path)).toEqual([
      '/internal/sesi/status',
      '/internal/sesi/amati',
      '/internal/sesi/aksi',
      '/internal/sesi/tunggu',
    ]);
    expect(w.panggilan[3]?.body).toEqual({ ...OWNER, maksMs: 25_000 });
  });

  it('Mode Uji di replika: loop berjalan, jejak tersimpan di rantai audit tanpa nilai, pesan templat', async () => {
    const u = rt.store.createUrusan({ jenis: 'kelahiran', kodeKabKota: '3374' });
    const w = workerPalsu(HOST_REPLIKA);
    const h = await jalankanNavigatorUrusan(
      rt,
      { urusan: u, executionId: 'x_uji', owner: { urusanId: u.id, sidHash: OWNER.sidHash }, modeUji: true },
      { cfg: CFG, fetcher: w.fetcher, llm: llmFinal() },
    );
    expect(h).toMatchObject({ akhir: 'ambil_alih', alasan: 'final' });
    const jejak = rt.store
      .eventsOfType(u.id, 'jejak_pendamping', 50)
      .map((e) => e.payload as { catatan: unknown });
    expect(jejak.length).toBeGreaterThan(0);
    for (const j of jejak) expect(CatatanPendampingSchema.safeParse(j.catatan).success).toBe(true);
    // Hash rencana tidak dirusak redaksi penyimpanan.
    const rencana = jejak.map((j) => j.catatan).find((c) => (c as { jenis: string }).jenis === 'rencana');
    expect((rencana as { rencanaHash: string }).rencanaHash).toBe(h.resi.rencana[0]);
    const progress = rt.store
      .eventsOfType(u.id, 'progress', 5)
      .map((e) => (e.payload as { label: string }).label);
    expect(progress).toContain(PESAN_AMBIL_ALIH.final);
  });

  it('Mode Uji: host non-fixture langsung berhenti, tanpa aksi ke worker dan tanpa LLM', async () => {
    const u = rt.store.createUrusan({ jenis: 'kelahiran', kodeKabKota: '3312' });
    const w = workerPalsu('telunjuksakti.wonogirikab.go.id');
    const llm = llmFinal();
    const h = await jalankanNavigatorUrusan(
      rt,
      { urusan: u, executionId: 'x_uji', owner: { urusanId: u.id, sidHash: OWNER.sidHash }, modeUji: true },
      { cfg: CFG, fetcher: w.fetcher, llm },
    );
    expect(h).toMatchObject({
      akhir: 'berhenti',
      alasan: 'mode_uji_host',
      pesan: PESAN_BERHENTI.mode_uji_host,
    });
    expect(w.panggilan.filter((p) => p.path === '/internal/sesi/aksi')).toHaveLength(0);
    expect(llm.provider.calls).toHaveLength(0);
  });

  it('katalog placeholder Navigator = field Data Diri yang bisa diselesaikan server', () => {
    for (const ph of Object.keys(KATALOG_PLACEHOLDER))
      expect([ph, fieldDataDiri(ph)]).not.toEqual([ph, undefined]);
  });
});
