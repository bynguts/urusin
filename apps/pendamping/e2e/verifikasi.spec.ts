import { expect, test } from '@playwright/test';
import { css, fill, nav } from '@urusin/core';
import type { PendampingEvent, PendampingHasil, PendampingSorot, PendampingStatus } from '@urusin/contracts';
import { createBrowserFactory } from '../src/browser.js';
import { loadConfig } from '../src/config.js';
import type { ActiveRun, Hooks } from '../src/sessions.js';
import { FIXTURE_ORIGIN, FIXTURES_PORT } from '../playwright.config.js';

/**
 * Verifikasi situs (B-b) terhadap tiruan halaman tantangan di apps/fixtures (bukan Cloudflare asli):
 * AI berhenti di tantangan, warga mengetuk sendiri lewat input yang diteruskan (sentuh -> mouse CDP), AI lanjut.
 * Tantangan yang gagal/berulang dua kali -> dipandu. AI tidak pernah mengeklik kotak verifikasi.
 */

type Rekam = {
  events: PendampingEvent[];
  modes: string[];
  ended?: { status: PendampingStatus; hasil: PendampingHasil; pesan: string };
};

/** Origin pasangan lintas-situs fixture (widget tantangan dalam iframe lintas-proses). */
const FIXTURE_LINTAS = `http://localhost:${FIXTURES_PORT}`;

async function mulai(jalur: string): Promise<{ run: ActiveRun; rekam: Rekam }> {
  const config = loadConfig({
    PENDAMPING_FIXTURE_ORIGINS: `${FIXTURE_ORIGIN},${FIXTURE_LINTAS}`,
    PENDAMPING_HEADLESS: '1',
  });
  const rekam: Rekam = { events: [], modes: [] };
  const hooks: Hooks = {
    mode: (m, pesan) => rekam.modes.push(`${m}:${pesan ?? ''}`),
    fokus: () => {},
    event: (e) => rekam.events.push(e),
    activity: () => {},
    ended: (status, hasil, pesan) => void (rekam.ended ??= { status, hasil, pesan }),
    langkahSelesai: (pesan) => void (rekam.ended ??= { status: 'siaga', hasil: 'berhasil', pesan }),
    berkasKurang: () => {},
  };
  const run = await createBrowserFactory(config)({
    sesiId: `verif-${jalur}`,
    program: { origin: FIXTURE_ORIGIN, steps: [nav(jalur), fill(css('#nopol'), 'B 1234 UJI')] },
    executionId: 'x_verif',
    viewport: { lebar: 390, tinggi: 844, dpr: 2, seluler: true },
    hooks,
    data: { value: () => undefined, file: () => undefined },
  });
  await run.mulaiAi();
  return { run, rekam };
}

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
