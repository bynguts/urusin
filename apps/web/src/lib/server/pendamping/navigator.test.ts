import { MemoryMailer } from '@urusin/akun/testing';
import {
  AksiSesiInternalSchema,
  CatatanPendampingSchema,
  SelesaiSesiInternalSchema,
  TungguSesiInternalSchema,
  type Aksi,
  type Pengamatan,
} from '@urusin/contracts';
import { DemoProvider } from '@urusin/harness';
import { FakeProvider, fakeCompletion } from '@urusin/llm';
import { KATALOG_PLACEHOLDER, PESAN_AMBIL_ALIH, PESAN_BERHENTI } from '@urusin/navigator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import {
  GalatTangan,
  hentikanNavigator,
  hostsFixture,
  jalankanNavigatorUrusan,
  mulaiNavigator,
  navigatorBerjalan,
  tanganWorker,
} from './navigator';
import type { TanganPendamping } from '@urusin/navigator';

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
function workerPalsu(host: string, opsi: { belumSiap?: number; sukses?: boolean } = {}) {
  let belumSiap = opsi.belumSiap ?? 0;
  const panggilan: { path: string; body: Record<string, unknown> }[] = [];
  let mode: 'ai' | 'takeover' | 'done' = 'ai';
  /** `sukses`: warga sudah menekan Kirim sendiri sesudah serah final (halaman sukses baru muncul sesudahnya). */
  let dikirimWarga = false;
  /** Buffer jejak worker (dikuras lewat /internal/sesi/jejak). */
  let jejak: unknown[] = [];
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
        // Peramban sesi masih dimulai (Chromium belum siap): 409 LAYANAN_TIDAK_TERSEDIA.
        if (belumSiap-- > 0)
          return json({ kode: 'LAYANAN_TIDAK_TERSEDIA', pesanWarga: 'peramban sesi belum siap' }, 409);
        return json({
          mode,
          pengamatan: dikirimWarga
            ? {
                ...pengamatan(host),
                sidik: 'sukses',
                elemen: [],
                teks: 'Permohonan berhasil. Nomor registrasi: REG-2026-00555.',
                sinyal: { ...pengamatan(host).sinyal, halamanAkhir: false, sukses: true },
              }
            : pengamatan(host),
        });
      case '/internal/sesi/aksi': {
        const a = AksiSesiInternalSchema.parse(body);
        for (const x of a.aksi as Aksi[])
          if (x.jenis === 'serahkan') {
            mode = 'takeover';
            jejak.push({ jenis: 'ambil_alih', fase: 'mulai', alasan: x.alasan });
            if (opsi.sukses && x.alasan === 'final') dikirimWarga = true;
          }
        return json({ mode, hasil: a.aksi.map((_, indeks) => ({ indeks, kode: 'ok' })) });
      }
      case '/internal/sesi/selesai': {
        // Worker memeriksa ulang halaman lalu mencatat bukti ke jejaknya sendiri; sesi siaga, kendali ke warga.
        const s = SelesaiSesiInternalSchema.parse(body);
        if (!dikirimWarga) return json({ kode: 'PESAN_TIDAK_SAH', pesanWarga: 'bukan halaman sukses' }, 409);
        if (s.bukti) jejak.push({ jenis: 'bukti', bukti: s.bukti });
        mode = 'takeover';
        return json({
          sesiId: 's1',
          urusanId: s.urusanId,
          executionId: 'x_uji',
          status: 'siaga',
          mode,
          antrean: null,
          hasil: 'berhasil',
          dibuatPada: '2026-11-10T00:00:00.000Z',
          kedaluwarsaPada: '2026-11-10T01:00:00.000Z',
        });
      }
      case '/internal/sesi/tunggu':
        TungguSesiInternalSchema.parse(body);
        // Warga menekan Kirim sendiri lalu menekan Lanjutkan: kendali kembali ke AI di halaman sukses.
        if (dikirimWarga && mode === 'takeover') {
          mode = 'ai';
          return json({ mode, status: 'berjalan', habisWaktu: false });
        }
        mode = 'done';
        return json({ mode, status: 'selesai', habisWaktu: false });
      case '/internal/sesi/jejak': {
        const catatan = jejak;
        jejak = [];
        return json({ executionId: 'x_uji', catatan, terbuang: 0 });
      }
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
    expect(await tangan.kuras?.()).toEqual({
      executionId: 'x_uji',
      catatan: [{ jenis: 'ambil_alih', fase: 'mulai', alasan: 'final' }],
      terbuang: 0,
    });
    expect(w.panggilan.map((p) => p.path)).toEqual([
      '/internal/sesi/status',
      '/internal/sesi/amati',
      '/internal/sesi/aksi',
      '/internal/sesi/tunggu',
      '/internal/sesi/jejak',
    ]);
    expect(w.panggilan[3]?.body).toEqual({ ...OWNER, maksMs: 25_000 });
    expect(w.panggilan[4]?.body).toEqual(OWNER);
    // Tanpa baris: field kolom tidak dikirim.
    expect(w.panggilan[2]?.body).not.toHaveProperty('kolom');
    // Baris lembar (label portal + tidak lazim) dari validator ikut ke worker untuk butuh_data.
    const kolom = [{ placeholder: '{{PEMOHON.NIK}}', labelPortal: 'Nomor Kependudukan', tidakLazim: true }];
    await tangan.aksi({
      rencanaHash: 'e'.repeat(64),
      aksi: [{ jenis: 'isi', ref: 'e1', nilai: '{{PEMOHON.NIK}}' }],
      seq: 1,
      kolom,
      berkas: [],
    });
    expect(w.panggilan.at(-1)).toMatchObject({ path: '/internal/sesi/aksi', body: { kolom } });
    // Terikat eksekusi: amati (termasuk pantau) dan aksi membawa executionId loop.
    const terikat = tanganWorker(CFG, OWNER, w.fetcher, 'x_uji');
    await terikat.amati({ pantau: true });
    await terikat.aksi({
      rencanaHash: 'f'.repeat(64),
      aksi: [{ jenis: 'serahkan', alasan: 'berhenti' }],
      seq: 1,
      kolom: [],
      berkas: [],
    });
    expect(w.panggilan.slice(-2).map((p) => [p.path, p.body.executionId])).toEqual([
      ['/internal/sesi/amati', 'x_uji'],
      ['/internal/sesi/aksi', 'x_uji'],
    ]);
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
    // Warga mengakhiri sesi sesudah serah final: pesan "sesi berakhir", bukan giliran warga yang basi.
    expect(progress).toContain(PESAN_BERHENTI.sesi_berakhir);
    // Jejak worker dikuras sesudah setiap panggilan dan masuk rantai audit urusan.
    expect(jejak.map((j) => j.catatan)).toContainEqual({
      jenis: 'ambil_alih',
      fase: 'mulai',
      alasan: 'final',
    });
    const jalur = w.panggilan.map((p) => p.path).filter((x) => x !== '/internal/sesi/status');
    for (const [i, x] of jalur.entries())
      if (x !== '/internal/sesi/jejak') expect(jalur[i + 1]).toBe('/internal/sesi/jejak');
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
    // Tidak ada aksi halaman: satu-satunya panggilan aksi = mengembalikan kendali ke warga (tanpa ref/nilai).
    expect(w.panggilan.filter((p) => p.path === '/internal/sesi/aksi').map((p) => p.body.aksi)).toEqual([
      [{ jenis: 'serahkan', alasan: 'berhenti' }],
    ]);
    expect(llm.provider.calls).toHaveLength(0);
  });

  it('biaya LLM Navigator masuk kuota runtime urusan yang sama (token + biaya harian)', async () => {
    const u = rt.store.createUrusan({ jenis: 'kelahiran', kodeKabKota: '3374' });
    const w = workerPalsu(HOST_REPLIKA);
    const provider = new FakeProvider({
      replies: [
        fakeCompletion({
          content: JSON.stringify({ aksi: [{ jenis: 'serahkan', alasan: 'final' }] }),
          usage: { prompt_tokens: 900, completion_tokens: 40, total_tokens: 940 },
        }),
      ],
    });
    const harian = rt.store.dailyCostIdr();
    await jalankanNavigatorUrusan(
      rt,
      { urusan: u, executionId: 'x_uji', owner: { urusanId: u.id, sidHash: OWNER.sidHash }, modeUji: true },
      { cfg: CFG, fetcher: w.fetcher, llm: { ...llmFinal(), provider } },
    );
    const row = rt.store.getUrusanOrThrow(u.id);
    expect([row.tokensIn, row.tokensOut]).toEqual([900, 40]);
    expect(rt.store.dailyCostIdr()).toBeCloseTo(
      harian + rt.quota.costIdr({ prompt_tokens: 900, completion_tokens: 40 }),
    );
  });

  it('kuota runtime habis: kendali ke warga dengan pesan templat, tanpa memanggil model', async () => {
    const u = rt.store.createUrusan({ jenis: 'kelahiran', kodeKabKota: '3374' });
    // Urusan ini sudah menghabiskan batas token per urusan (mis. akun juri yang dipakai berulang).
    rt.store.addUsage(u.id, {
      tokensIn: rt.quota.config.sessionTokenCap,
      tokensOut: 0,
      costIdr: 0,
      degraded: false,
    });
    const w = workerPalsu(HOST_REPLIKA);
    const llm = llmFinal();
    const h = await jalankanNavigatorUrusan(
      rt,
      { urusan: u, executionId: 'x_uji', owner: { urusanId: u.id, sidHash: OWNER.sidHash }, modeUji: true },
      { cfg: CFG, fetcher: w.fetcher, llm },
    );
    expect(h).toMatchObject({ akhir: 'ambil_alih', alasan: 'kuota', pesan: PESAN_AMBIL_ALIH.kuota });
    expect(llm.provider.calls).toHaveLength(0);
    const aksi = w.panggilan.filter((p) => p.path === '/internal/sesi/aksi').map((p) => p.body.aksi);
    expect(aksi).toEqual([[{ jenis: 'serahkan', alasan: 'berhenti' }]]);
    const progress = rt.store
      .eventsOfType(u.id, 'progress', 5)
      .map((e) => (e.payload as { label: string }).label);
    expect(progress).toContain(PESAN_AMBIL_ALIH.kuota);
  });

  it('N8: loop lama yang diganti eksekusi baru tidak menerbitkan progres ke layar (resi tetap di jejaknya)', async () => {
    const u = rt.store.createUrusan({ jenis: 'kelahiran', kodeKabKota: '3374' });
    /** Tangan yang menahan amati sampai dilepas, lalu gagal (loop yang sudah dibatalkan = dibatalkan). */
    const tahan = () => {
      let lepas!: () => void;
      const gerbang = new Promise<void>((r) => (lepas = r));
      const t: TanganPendamping = {
        amati: async () => {
          await gerbang;
          throw new Error('sesi lama ditutup');
        },
        aksi: async () => ({ mode: 'done', hasil: [] }),
        tunggu: async () => ({ mode: 'done', status: 'dibatalkan', habisWaktu: false }),
      };
      return { t, lepas };
    };
    const m = (executionId: string) => ({
      urusan: u,
      executionId,
      owner: { urusanId: u.id, sidHash: OWNER.sidHash },
      modeUji: true,
    });
    const a = tahan();
    const b = tahan();
    expect(mulaiNavigator(rt, m('x_a'), { cfg: CFG, tangan: a.t, llm: llmFinal() })).toBe(true);
    expect(mulaiNavigator(rt, m('x_b'), { cfg: CFG, tangan: b.t, llm: llmFinal() })).toBe(true);
    expect(navigatorBerjalan(u.id)).toBe('x_b');
    a.lepas();
    await vi.waitFor(() =>
      expect(
        rt.store
          .eventsOfType(u.id, 'jejak_pendamping', 50)
          .some(
            (e) =>
              (e.payload as { executionId: string; catatan: { jenis: string } }).catatan.jenis === 'resi',
          ),
      ).toBe(true),
    );
    const progress = rt.store
      .eventsOfType(u.id, 'progress', 10)
      .map((e) => (e.payload as { label: string }).label);
    expect(progress).not.toContain(PESAN_BERHENTI.dibatalkan);
    expect(navigatorBerjalan(u.id)).toBe('x_b');
    hentikanNavigator(u.id);
    b.lepas();
    await vi.waitFor(() => expect(navigatorBerjalan(u.id)).toBeUndefined());
    // Loop yang dihentikan sendiri (bukan diganti) tetap memberi tahu layar.
    await vi.waitFor(() =>
      expect(
        rt.store.eventsOfType(u.id, 'progress', 10).map((e) => (e.payload as { label: string }).label),
      ).toContain(PESAN_BERHENTI.dibatalkan),
    );
  });

  it('galat worker dipetakan: 409 belum siap & 503 = sementara (diulang loop), 404/422 = bukan', () => {
    expect(new GalatTangan(409, 'LAYANAN_TIDAK_TERSEDIA').sementara).toBe('belum_siap');
    expect(new GalatTangan(503).sementara).toBe('sesaat');
    expect(new GalatTangan(409, 'SESI_SUDAH_ADA').sementara).toBeUndefined();
    expect(new GalatTangan(404, 'SESI_TIDAK_ADA').sementara).toBeUndefined();
    expect(new GalatTangan(422, 'PESAN_TIDAK_SAH').sementara).toBeUndefined();
    // N6: 404 sesi tidak ada = sesi sudah diakhiri (loop berhenti sesi_berakhir), bukan galat worker.
    expect(new GalatTangan(404, 'SESI_TIDAK_ADA').berakhir).toBe(true);
    expect(new GalatTangan(404).berakhir).toBe(false);
    // Sesi memegang eksekusi lain (amati/aksi ber-executionId): loop ini selesai, bukan galat worker.
    expect(new GalatTangan(409, 'PESAN_TIDAK_SAH').berakhir).toBe(true);
    expect(new GalatTangan(409, 'LAYANAN_TIDAK_TERSEDIA').berakhir).toBe(false);
    expect(new GalatTangan(503).berakhir).toBe(false);
  });

  it('sesi baru: worker menjawab 409 "belum siap" di awal, loop menunggu lalu jalan (bukan galat_worker)', async () => {
    const u = rt.store.createUrusan({ jenis: 'kelahiran', kodeKabKota: '3374' });
    const w = workerPalsu(HOST_REPLIKA, { belumSiap: 2 });
    const h = await jalankanNavigatorUrusan(
      rt,
      { urusan: u, executionId: 'x_uji', owner: { urusanId: u.id, sidHash: OWNER.sidHash }, modeUji: true },
      { cfg: CFG, fetcher: w.fetcher, llm: llmFinal() },
    );
    expect(h).toMatchObject({ akhir: 'ambil_alih', alasan: 'final' });
    expect(w.panggilan.filter((p) => p.path === '/internal/sesi/amati').length).toBeGreaterThanOrEqual(3);
  });

  it('halaman sukses sesudah serah final: hasil berhasil dicatat ke urusan saat itu juga, resi masuk jejak', async () => {
    const u = rt.store.createUrusan({ jenis: 'kelahiran', kodeKabKota: '3374' });
    const w = workerPalsu(HOST_REPLIKA, { sukses: true });
    const h = await jalankanNavigatorUrusan(
      rt,
      { urusan: u, executionId: 'x_uji', owner: { urusanId: u.id, sidHash: OWNER.sidHash }, modeUji: true },
      { cfg: CFG, fetcher: w.fetcher, llm: llmFinal() },
    );
    expect(h).toMatchObject({ akhir: 'selesai', bukti: { nomor: 'REG-2026-00555' } });
    // Worker mengonfirmasi halaman lewat /internal/sesi/selesai (bukti ikut); satu-satunya aksi AI adalah serah
    // final (warga sendiri yang menekan Kirim), tidak ada serahkan sesudah halaman sukses.
    expect(w.panggilan.find((p) => p.path === '/internal/sesi/selesai')?.body).toMatchObject({
      executionId: 'x_uji',
      bukti: { nomor: 'REG-2026-00555' },
    });
    expect(w.panggilan.filter((p) => p.path === '/internal/sesi/aksi').map((p) => p.body.aksi)).toEqual([
      [{ jenis: 'serahkan', alasan: 'final' }],
    ]);
    const progress = rt.store
      .eventsOfType(u.id, 'progress', 10)
      .map((e) => (e.payload as { label: string }).label);
    expect(progress).toContain('Browser Pendamping melaporkan langkah berhasil.');
    // Laporan "dibatalkan" yang datang kemudian (warga menutup sesi) tidak menimpa: hasil eksekusi sudah ada.
    expect(rt.store.recordExecutionResult(u.id, 'x_uji', 'dibatalkan')).toBe(false);
    const jejak = rt.store
      .eventsOfType(u.id, 'jejak_pendamping', 50)
      .map((e) => (e.payload as { catatan: { jenis: string } }).catatan);
    expect(jejak.find((c) => c.jenis === 'resi')).toMatchObject({ akhir: 'selesai', hash: h.resi.hash });
    // Bukti dicatat sekali (oleh worker), bukan dua kali.
    expect(jejak.filter((c) => c.jenis === 'bukti')).toHaveLength(1);
  });

  it('katalog placeholder Navigator = field Data Diri yang bisa diselesaikan server', () => {
    for (const ph of Object.keys(KATALOG_PLACEHOLDER))
      expect([ph, fieldDataDiri(ph)]).not.toEqual([ph, undefined]);
  });
});
