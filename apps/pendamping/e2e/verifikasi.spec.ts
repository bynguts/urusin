import { expect, test, type Page } from '@playwright/test';
import { hostsSesi, type Program } from '@urusin/adapters';
import { css, fill, nav } from '@urusin/core';
import type { PendampingEvent, PendampingHasil, PendampingSorot, PendampingStatus } from '@urusin/contracts';
import { launchIsolated, wire } from '../src/browser.js';
import { loadConfig } from '../src/config.js';
import type { ActiveRun, Hooks } from '../src/sessions.js';
import { FIXTURE_LOCAL_ORIGIN, FIXTURE_ORIGIN, FIXTURES_PORT } from '../playwright.config.js';

/**
 * Verifikasi situs (B-b) terhadap tiruan halaman tantangan di apps/fixtures (bukan Cloudflare asli):
 * AI berhenti di tantangan, warga mengetuk sendiri lewat input yang diteruskan (sentuh -> mouse CDP), AI lanjut.
 * Tantangan yang gagal/berulang dua kali -> dipandu. AI tidak pernah mengeklik kotak verifikasi.
 */

type Rekam = {
  events: PendampingEvent[];
  modes: string[];
  lolosAwal: number;
  ended?: { status: PendampingStatus; hasil: PendampingHasil; pesan: string };
};

/** Origin pasangan lintas-situs fixture (widget tantangan dalam iframe lintas-proses). */
const FIXTURE_LINTAS = `http://localhost:${FIXTURES_PORT}`;

const VIEWPORT = { lebar: 390, tinggi: 844, dpr: 2, seluler: true };

/**
 * Sama dengan `createBrowserFactory` (launchIsolated + wire), tetapi halaman Chromium ikut dikembalikan agar uji
 * bisa MENGAMATI (tidak menyentuh) kotak tantangan dan kolom formulir.
 */
async function mulai(
  jalur: string,
  origin = FIXTURE_ORIGIN,
  awal = false,
): Promise<{ run: ActiveRun; rekam: Rekam; halaman: Page }> {
  const config = loadConfig({
    PENDAMPING_FIXTURE_ORIGINS: `${FIXTURE_ORIGIN},${FIXTURE_LINTAS},${FIXTURE_LOCAL_ORIGIN}`,
    PENDAMPING_HEADLESS: '1',
  });
  const rekam: Rekam = { events: [], modes: [], lolosAwal: 0 };
  const hooks: Hooks = {
    mode: (m, pesan) => rekam.modes.push(`${m}:${pesan ?? ''}`),
    fokus: () => {},
    event: (e) => rekam.events.push(e),
    activity: () => {},
    ended: (status, hasil, pesan) => void (rekam.ended ??= { status, hasil, pesan }),
    langkahSelesai: (pesan) => void (rekam.ended ??= { status: 'siaga', hasil: 'berhasil', pesan }),
    berkasKurang: () => {},
    tantanganLolos: () => void rekam.lolosAwal++,
  };
  const program: Program = { origin, steps: [nav(jalur), fill(css('#nopol'), 'B 1234 UJI')] };
  const iso = await launchIsolated(config, VIEWPORT, hostsSesi(program));
  const run = await wire(
    config,
    {
      sesiId: `verif-${jalur}`,
      program,
      executionId: 'x_verif',
      viewport: VIEWPORT,
      hooks,
      data: { value: () => undefined, file: () => undefined },
    },
    iso,
  );
  const halaman = iso.context.pages()[0]!;
  // `awal`: seperti sesi sungguhan, portal dibuka dulu (bukaAwal) dan AI baru mulai sesudah izin isi.
  if (awal) await run.bukaAwal!();
  else await run.mulaiAi();
  return { run, rekam, halaman };
}

/** Kotak centang di frame tantangan, DIBACA saja (`isChecked` tidak mengeklik). */
async function kotakTercentang(halaman: Page): Promise<boolean> {
  const frame = halaman.frames().find((f) => f.url().includes('/cdn-cgi/challenge-platform/'));
  if (!frame) throw new Error('frame tantangan tidak ada');
  return frame.locator('#kotak-manusia').isChecked();
}

/** Nilai #nopol di halaman utama; null bila kolomnya belum ada (masih di halaman tantangan). */
const nilaiNopol = (halaman: Page) =>
  halaman.evaluate(() => document.querySelector<HTMLInputElement>('#nopol')?.value ?? null);

const verifikasi = (r: Rekam) =>
  r.events.filter(
    (e): e is Extract<PendampingEvent, { jenis: 'giliran_anda' }> =>
      e.jenis === 'giliran_anda' && e.alasan === 'verifikasi_situs',
  );

/** Tunggu event verifikasi_situs ber-sorot (kotak iframe tantangan) yang pesannya memuat `pesan`. */
async function tungguSorot(r: Rekam, pesan: string): Promise<PendampingSorot> {
  const cari = () => verifikasi(r).find((e) => e.sorot && e.pesan.includes(pesan))?.sorot;
  await expect.poll(cari, { timeout: 30_000 }).toBeTruthy();
  return cari()!;
}

/** Ketukan warga (sentuh) di tengah kotak: dipetakan ke klik mouse CDP, sampai ke dalam iframe. */
async function ketuk(run: ActiveRun, s: PendampingSorot) {
  const x = s.x + s.lebar / 2;
  const y = s.y + s.tinggi / 2;
  await run.input({ type: 'pointer', aksi: 'down', x, y, jenis: 'touch', tombol: 'left', klik: 1 });
  await run.input({ type: 'pointer', aksi: 'up', x, y, jenis: 'touch', tombol: 'left', klik: 1 });
}

test('tantangan situs: AI berhenti, warga mengetuk sendiri, AI melanjutkan pengisian', async () => {
  const { run, rekam } = await mulai('/uji-cf/');
  try {
    const sorot = await tungguSorot(rekam, 'Situs meminta verifikasi');
    expect(sorot.lebar).toBeGreaterThan(200);
    expect(rekam.modes.at(-1)).toMatch(/^takeover:Situs meminta verifikasi/);
    // Tanpa ketukan warga tidak ada yang terjadi: AI tidak mengeklik dan tidak mengisi.
    await new Promise((r) => setTimeout(r, 2_500));
    expect(rekam.ended).toBeUndefined();
    expect(verifikasi(rekam).some((e) => e.pesan.includes('belum diterima'))).toBe(false);

    await ketuk(run, sorot);
    await expect
      .poll(() => rekam.ended, { timeout: 30_000 })
      .toMatchObject({ status: 'siaga', hasil: 'berhasil' });
    expect(rekam.modes).toContain('ai:Verifikasi selesai. AI melanjutkan pengisian.');
  } finally {
    await run.destroy();
  }
});

test('tantangan di halaman AWAL sebelum izin isi: tertahan, warga mengetuk, lolos tanpa "AI melanjutkan"', async () => {
  const { run, rekam, halaman } = await mulai('/uji-cf/', FIXTURE_ORIGIN, true);
  try {
    // bukaAwal kembali sesudah tantangan terdeteksi: sesi menahan lembar izin dan tidak mengganti mode ke 'ai'.
    expect(run.ditahanTantangan?.()).toBe(true);
    expect(rekam.modes.at(-1)).toMatch(/^takeover:Situs meminta verifikasi/);
    const sorot = await tungguSorot(rekam, 'Situs meminta verifikasi');
    await ketuk(run, sorot);
    await expect.poll(() => rekam.lolosAwal, { timeout: 30_000 }).toBe(1);
    expect(run.ditahanTantangan?.()).toBe(false);
    // AI belum pernah mulai: bukan "AI melanjutkan", dan tidak ada yang diisi sebelum izin.
    expect(rekam.modes.some((m) => m.startsWith('ai:'))).toBe(false);
    expect(rekam.modes.at(-1)).toBe('takeover:Verifikasi selesai.');
    expect(await nilaiNopol(halaman)).toBe('');
    // Izin isi diberikan: AI mulai dan mengisi.
    await run.mulaiAi();
    await expect
      .poll(() => rekam.ended, { timeout: 30_000 })
      .toMatchObject({ status: 'siaga', hasil: 'berhasil' });
    expect(await nilaiNopol(halaman)).toBe('B 1234 UJI');
  } finally {
    await run.destroy();
  }
});

test('widget tantangan di iframe LINTAS-origin: ketukan warga diteruskan CDP sampai ke dalamnya', async () => {
  const { run, rekam } = await mulai('/uji-cf/lintas/');
  try {
    const sorot = await tungguSorot(rekam, 'Situs meminta verifikasi');
    expect(sorot.lebar).toBeGreaterThan(200);
    await ketuk(run, sorot);
    await expect
      .poll(() => rekam.ended, { timeout: 30_000 })
      .toMatchObject({ status: 'siaga', hasil: 'berhasil' });
    expect(rekam.modes).toContain('ai:Verifikasi selesai. AI melanjutkan pengisian.');
  } finally {
    await run.destroy();
  }
});

test('kotak centang "Performing security verification" (200, tanpa cf-mitigated): serah ke warga, lanjut otomatis', async () => {
  const { run, rekam, halaman } = await mulai('/uji-cf/kotak/', FIXTURE_LOCAL_ORIGIN);
  try {
    const sorot = await tungguSorot(rekam, 'Situs meminta verifikasi keamanan');
    expect(sorot.lebar).toBeGreaterThan(200);
    expect(rekam.modes.at(-1)).toMatch(
      /^takeover:Situs meminta verifikasi keamanan\. Ketuk kotak verifikasinya \('Verifikasi bahwa Anda adalah manusia' atau 'Verify you are human'\)/,
    );
    // AI menunggu: tidak mencentang, tidak mengisi. Diamati langsung di Chromium, sebelum DAN sesudah jeda.
    expect(await kotakTercentang(halaman)).toBe(false);
    expect(await nilaiNopol(halaman)).toBeNull();
    await new Promise((r) => setTimeout(r, 2_500));
    expect(rekam.ended).toBeUndefined();
    expect(await kotakTercentang(halaman)).toBe(false);
    expect(await nilaiNopol(halaman)).toBeNull();

    await ketuk(run, sorot);
    await expect
      .poll(() => rekam.ended, { timeout: 30_000 })
      .toMatchObject({ status: 'siaga', hasil: 'berhasil' });
    expect(rekam.modes).toContain('ai:Verifikasi selesai. AI melanjutkan pengisian.');
    // Baru setelah ketukan warga AI mengisi formulir di halaman tujuan.
    expect(await nilaiNopol(halaman)).toBe('B 1234 UJI');
  } finally {
    await run.destroy();
  }
});

test('selama tantangan halaman pindah ke luar allowlist: AI tidak mengisi di sana (cek ulang setelah dilepas)', async () => {
  const { run, rekam, halaman } = await mulai('/uji-cf/kotak/', FIXTURE_LOCAL_ORIGIN);
  try {
    await tungguSorot(rekam, 'Situs meminta verifikasi keamanan');
    // Halaman berpindah (bukan oleh AI) ke dokumen di luar domain resmi/fixture yang juga punya kolom #nopol.
    // Interpreter sudah memeriksa domain sebelum op isi mulai menunggu; tanpa cek ulang, AI mengisi di sini.
    await halaman.goto('data:text/html,<title>lain</title><input id="nopol">');
    await expect
      .poll(() => rekam.ended, { timeout: 30_000 })
      .toMatchObject({ status: 'gagal', hasil: 'gagal' });
    expect(await nilaiNopol(halaman)).toBe('');
  } finally {
    await run.destroy();
  }
});

test('tantangan yang gagal/berulang dua kali -> mode dipandu dengan pesan jujur', async () => {
  const { run, rekam } = await mulai('/uji-cf/gagal/');
  try {
    await ketuk(run, await tungguSorot(rekam, 'Situs meminta verifikasi'));
    const kedua = await tungguSorot(rekam, 'belum diterima');
    // Satu event ber-sorot per kemunculan tantangan (tidak berulang tiap detik poll).
    expect(verifikasi(rekam).filter((e) => e.sorot)).toHaveLength(2);
    expect(rekam.ended).toBeUndefined();
    await ketuk(run, kedua);
    await expect
      .poll(() => rekam.ended, { timeout: 30_000 })
      .toMatchObject({ status: 'dipandu', hasil: 'drift' });
    expect(rekam.ended?.pesan).toContain('buka situs resmi di perangkat Anda sendiri');
  } finally {
    await run.destroy();
  }
});
