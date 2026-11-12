import { expect, test } from '@playwright/test';
import type { Aksi, AksiSesiResponse } from '@urusin/contracts';
import { unmark } from '@urusin/harness';
import { fakeCompletion, type ChatParams, type ChatProvider } from '@urusin/llm';
import {
  BATAS_ANGGARAN,
  BATAS_KOREKSI,
  jalankanNavigator,
  type HasilNavigator,
  type PersetujuanHalaman,
  type TanganPendamping,
} from '@urusin/navigator';
import { FIXTURE_ORIGIN } from '../playwright.config.js';
import { createBrowserFactory } from '../src/browser.js';
import { loadConfig } from '../src/config.js';
import { ADAPTER_GENERIK, SessionManager, sidHashOf } from '../src/sessions.js';

/**
 * Periksa-sesudah-aksi + riwayat lintasan Navigator ujung ke ujung: loop @urusin/navigator yang sama dengan
 * produksi, worker = SessionManager in-process (Chromium nyata, amatan + galat validasi dari halaman, gerbang
 * tulis), terhadap replika `generik/dasar/koreksi` (apps/fixtures): wizard sisi klien yang MENOLAK pilihan
 * pertama di langkah 2 dengan galat di samping kolom (tanpa pindah halaman).
 * Otak = provider deterministik yang HANYA membaca prompt: pilih opsi 1 pada pandangan pertama, dan bila prompt
 * memuat PERIKSA HASIL untuk kolom itu, pilih opsi berikutnya (model `keras` mengabaikannya). Yang diuji: galat
 * situs sampai ke prompt berikutnya (terbungkus), model mengoreksi tanpa serah ke warga, model yang tidak mau
 * mengoreksi tetap berhenti terbatas, dan AI tidak pernah mengirim.
 */

const ASAL = FIXTURE_ORIGIN;
const RESMI = 'https://telunjuksakti.wonogirikab.go.id';
const CAPS = { json_schema_strict: true, tools: false };
/** Data Diri sintetis (dirakit agar pemindai PII tidak menganggapnya literal). */
const VAULT: Record<string, string> = {
  '{{PEMOHON.NIK}}': ['3312', '0115', '0890', '0001'].join(''),
  '{{PEMOHON.NAMA}}': 'Penguji Sintetis',
};

const bukaData = (s: string) => unmark(s.replace(/<<\/?DATA_TAK_TEPERCAYA[^>]*>>/g, '')).trim();
const normal = (s: string) => s.replace(/\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

type ElemenPrompt = {
  ref: string;
  peran: string;
  nama: string;
  kelas?: string;
  isian?: string;
  opsi: number;
};

/** Urai pesan user Navigator: sinyal, ELEMEN, dan baris PERIKSA HASIL (`- eN (nama=...) tadi diisi opsi k`). */
function urai(params: ChatParams) {
  const teks = String(params.messages.find((m) => m.role === 'user')?.content ?? '');
  const baris = teks.split('\n');
  const sinyal = (baris.find((b) => b.startsWith('SINYAL: ')) ?? '').slice(8).split(', ');
  const elemen: ElemenPrompt[] = [];
  for (const b of baris) {
    if (!/^- e\d+ \| /.test(b)) continue;
    const bagian = b.slice(2).split(' | ');
    const e: ElemenPrompt = { ref: bagian[0]!, peran: bagian[1]!, nama: '', opsi: 0 };
    for (const x of bagian.slice(2)) {
      if (x.startsWith('kelas=')) e.kelas = x.slice(6);
      else if (x.startsWith('isian=')) e.isian = x.slice(6);
      else if (x.startsWith('nama=')) e.nama = bukaData(x.slice(5));
      else if (x.startsWith('opsi: ')) e.opsi = (x.match(/(?:^|; )\d+=<<DATA/g) ?? []).length;
    }
    elemen.push(e);
  }
  const koreksi = new Map<string, number>();
  for (const m of teks.matchAll(/^- (e\d+) \(nama=.*?\) tadi diisi opsi (\d+): /gm))
    koreksi.set(m[1]!, Number(m[2]));
  return { teks, sinyal, elemen, koreksi };
}

class ProviderKoreksi implements ChatProvider {
  readonly baseURL = 'https://fake.llm.invalid/v1';
  readonly prompt: string[] = [];
  /** `keras`: model yang mengabaikan PERIKSA HASIL dan terus memilih opsi yang ditolak. */
  constructor(private readonly keras = false) {}
  async create(params: ChatParams) {
    const h = urai(params);
    this.prompt.push(h.teks);
    const jawab = (aksi: Record<string, unknown>[]) =>
      fakeCompletion({ content: JSON.stringify({ pikir: 'Rencana orakel uji.', aksi }) });
    if (h.sinyal.includes('halamanAkhir')) return jawab([{ jenis: 'serahkan', alasan: 'final' }]);
    const aksi: Record<string, unknown>[] = [];
    for (const e of h.elemen) {
      const n = normal(e.nama);
      const lalu = this.keras ? undefined : h.koreksi.get(e.ref);
      if (e.peran === 'pilihan' && /jenis permohonan/.test(n) && e.opsi > 1)
        aksi.push({
          jenis: 'pilih',
          ref: e.ref,
          nilai: { opsi: lalu === undefined ? 1 : (lalu % (e.opsi - 1)) + 1 },
        });
      else if (e.peran === 'teks' && e.isian === 'kosong' && /\bnik\b/.test(n))
        aksi.push({ jenis: 'isi', ref: e.ref, nilai: '{{PEMOHON.NIK}}' });
      else if (e.peran === 'teks' && e.isian === 'kosong' && /\bnama\b/.test(n))
        aksi.push({ jenis: 'isi', ref: e.ref, nilai: '{{PEMOHON.NAMA}}' });
    }
    const mulai = h.elemen.find((e) => e.peran === 'tautan' && /\bmulai\b/.test(normal(e.nama)));
    if (aksi.length === 0 && mulai) return jawab([{ jenis: 'klik', ref: mulai.ref }]);
    const lanjut = h.elemen.find((e) => e.kelas === 'lanjut' && /lanjut/.test(normal(e.nama)));
    return jawab(
      lanjut
        ? [...aksi, { jenis: 'klik', ref: lanjut.ref }]
        : [...aksi, { jenis: 'serahkan', alasan: 'tidak_yakin' }],
    );
  }
  async stream(): Promise<never> {
    throw new Error('tidak dipakai');
  }
  async transcribe(): Promise<never> {
    throw new Error('tidak dipakai');
  }
  async embed(): Promise<never> {
    throw new Error('tidak dipakai');
  }
}

let manager: SessionManager | undefined;

test.beforeAll(async () => {
  await expect
    .poll(async () => (await fetch(`${ASAL}/health`).catch(() => null))?.status, { timeout: 20_000 })
    .toBe(200);
  const config = loadConfig({
    PENDAMPING_FIXTURE_ORIGINS: ASAL,
    PENDAMPING_ORIGIN_OVERRIDES: `${RESMI}=${ASAL}`,
    PENDAMPING_HEADLESS: '1',
  });
  manager = new SessionManager(config, createBrowserFactory(config));
});

test.afterAll(async () => {
  await manager?.shutdown();
});

const hitung = async () => (await (await fetch(`${ASAL}/generik/_hitung`)).json()) as Record<string, number>;
const jeda = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Satu run: sesi generik baru (Mode Uji) di replika koreksi, warga simulasi menyetujui setiap lembar (nilai
 * sintetis) lalu mengakhiri sesi begitu kendali ada di tangannya (tidak pernah mengirim).
 */
async function jalankanRun(keras: boolean) {
  const m = manager!;
  const sebelum = await hitung();
  const o = {
    urusanId: `u-koreksi-${crypto.randomUUID()}`,
    sidHash: sidHashOf(crypto.randomUUID().replace(/-/g, '')),
  };
  const sesi = await m.create({
    ...o,
    executionId: `x_koreksi_${crypto.randomUUID().slice(0, 8)}`,
    adapterId: ADAPTER_GENERIK,
    flowId: 'navigator',
    origin: RESMI,
    params: { jalur: '/generik/dasar/koreksi/' },
    modeUji: true,
  });
  await m.attach(sesi.sesiId, {
    send: () => undefined,
    frame: () => undefined,
    ack: () => undefined,
    close: () => undefined,
  });
  await expect.poll(() => m.status(o).status, { timeout: 30_000 }).toBe('berjalan');

  const serah: string[] = [];
  const persetujuan = new Map<string, PersetujuanHalaman>();
  let selesai = false;
  const catatSerah = (aksi: Aksi[], r: AksiSesiResponse) => {
    for (const h of r.hasil) {
      const a = aksi[h.indeks];
      if (h.kode === 'ok' && a?.jenis === 'serahkan') serah.push(a.alasan);
    }
  };
  const tangan: TanganPendamping = {
    amati: () => m.amati(o),
    aksi: async (r) => {
      const h = await m.aksi(o, {
        ...o,
        rencanaHash: r.rencanaHash,
        aksi: r.aksi,
        seq: r.seq,
        ...(r.kolom.length > 0 ? { kolom: r.kolom } : {}),
      });
      catatSerah(r.aksi, h);
      return h;
    },
    tunggu: (maksMs) => m.tunggu(o, Math.min(maksMs, 2_000)),
    kuras: async () => m.kurasJejak(o),
  };

  const warga = (async () => {
    while (!selesai) {
      await jeda(80);
      let st;
      try {
        st = m.status(o);
      } catch {
        return;
      }
      if (['selesai', 'gagal', 'dipandu', 'kedaluwarsa', 'dibatalkan'].includes(st.status)) return;
      if (st.status === 'menunggu_data') {
        const b = m.butuhData(o);
        if (!b.rencanaHash) continue;
        const isian = Object.fromEntries(b.placeholder.flatMap((p) => (VAULT[p] ? [[p, VAULT[p]]] : [])));
        persetujuan.set(b.rencanaHash, { placeholder: new Set(Object.keys(isian)), berkas: new Set() });
        await m.isiData(o, isian, b.rencanaHash);
        continue;
      }
      if (st.mode === 'takeover') {
        await m.akhiri(o);
        return;
      }
    }
  })();

  const provider = new ProviderKoreksi(keras);
  let hasil: HasilNavigator;
  try {
    hasil = await jalankanNavigator({
      executionId: sesi.executionId,
      tangan,
      llm: { provider, model: 'uji-koreksi', caps: CAPS },
      tujuan: 'Kartu Keluarga',
      hostsBoleh: new Set([new URL(ASAL).host]),
      modeUji: { hostsFixture: new Set([new URL(ASAL).host]) },
      kodeKabKota: '3312',
      jejak: () => undefined,
      persetujuan: (h) => persetujuan.get(h),
      tungguTotalMs: 60_000,
    });
  } finally {
    selesai = true;
    await warga.catch(() => undefined);
    await m.akhiri(o).catch(() => undefined);
  }
  const sesudah = await hitung();
  const naik = (k: string) => (sesudah[k] ?? 0) - (sebelum[k] ?? 0);
  return { hasil, serah, prompt: provider.prompt, naik };
}

test('koreksi: galat situs masuk PERIKSA HASIL, AI memilih opsi lain, sampai serah final tanpa mengirim', async () => {
  test.setTimeout(120_000);
  const { hasil, serah, prompt, naik } = await jalankanRun(false);

  expect(hasil).toMatchObject({ akhir: 'ambil_alih', alasan: 'final' });
  // AI tidak pernah mengirim (final tetap milik warga): penghitung POST replika tetap.
  expect(naik('koreksi.percobaan')).toBe(0);
  expect(naik('koreksi.kirim')).toBe(0);
  // Tidak ada serah ke warga di tengah jalan: koreksi dikerjakan AI, satu-satunya serah = final.
  expect(serah).toEqual(['final']);

  // Galat situs (dari DOM nyata) sampai ke prompt koreksi: ref kolom, opsi yang dipakai, teks galat terbungkus.
  const periksa = prompt.filter((p) => p.includes('PERIKSA HASIL'));
  expect(periksa).toHaveLength(1);
  const blok = periksa[0]!.slice(periksa[0]!.indexOf('PERIKSA HASIL'));
  expect(blok).toMatch(
    /- e\d+ \(nama=<<DATA_TAK_TEPERCAYA[^\n]*\) tadi diisi opsi 1: situs menolak: galat=<<DATA_TAK_TEPERCAYA/,
  );
  expect(bukaData(blok)).toContain('Kuota KK Baru (Pecah KK) hari ini sudah habis');
  expect(blok).toContain(`Koreksi ke-1 dari ${BATAS_KOREKSI}`);
  // Prompt langkah pernyataan mengingat langkah sebelumnya, termasuk penolakan situs; tanpa nilai vault.
  const akhir = prompt.at(-1)!;
  expect(akhir).toContain('SINYAL: halamanAkhir');
  expect(akhir).toContain('situs menolak isian AI');
  expect(akhir).toContain('<- {{PEMOHON.NIK}} [ok]');
  expect(akhir).toContain('<- opsi 2 [ok]');
  for (const nilai of Object.values(VAULT)) expect(prompt.join('\n')).not.toContain(nilai);
});

test('model yang tidak mau mengoreksi: berhenti terbatas ke warga, tanpa mengirim', async () => {
  test.setTimeout(120_000);
  const { hasil, serah, prompt, naik } = await jalankanRun(true);

  // Halaman yang sama dengan galat yang sama berulang: anggaran putaran (atau batas koreksi) menyerahkan ke warga.
  expect(hasil.akhir).toBe('ambil_alih');
  expect(['putaran', 'isi_sendiri']).toContain((hasil as { alasan: string }).alasan);
  expect(serah).not.toContain('final');
  expect(prompt.filter((p) => p.includes('PERIKSA HASIL')).length).toBeLessThanOrEqual(BATAS_KOREKSI);
  expect(prompt.length).toBeLessThan(BATAS_ANGGARAN.panggilanLlm);
  expect(naik('koreksi.percobaan')).toBe(0);
  expect(naik('koreksi.kirim')).toBe(0);
});
