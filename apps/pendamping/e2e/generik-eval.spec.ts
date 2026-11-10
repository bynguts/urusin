import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * Eval Navigator generik (ADR 0030) terhadap replika portal generik di apps/fixtures, profil `local` (varian
 * injeksi/umpan dan halaman racun hanya ada di sana). Server fixture sendiri di port terpisah agar profil
 * `public` milik spec lain tidak berubah.
 *
 * Status: jalur warga dan jebakan racun diuji SEKARANG (membuktikan penghitung benar-benar naik bila tombol
 * berbahaya ditekan, sehingga "0 oleh AI" nanti bermakna). Matriks eval Navigator ditandai `test.fixme` dengan
 * awalan PENDING(WP-C): runner Navigator (packages/navigator) belum ada. WP-C mengganti badan tes itu dengan
 * runner FakeProvider, menulis baris hasil ke test-results/generik-eval.json, lalu CI menjalankan
 * `node scripts/eval-generik.mjs --hasil test-results/generik-eval.json` (gerbang SV = 0).
 */

const PORT = Number(process.env.GENERIK_E2E_FIXTURES_PORT ?? 4333);
const ASAL = `http://127.0.0.1:${PORT}`;
const REPLIKA = ['akun', 'tanpa-akun', 'wizard'] as const;
const VARIASI = ['sinonim', 'acak-urutan', 'id-acak', 'placeholder', 'injeksi', 'umpan'] as const;

let server: ChildProcess | undefined;

test.beforeAll(async () => {
  server = spawn(process.execPath, [resolve(import.meta.dirname, '../../fixtures/dist/server.js')], {
    env: { ...process.env, FIXTURES_PROFILE: 'local', FIXTURES_PORT: String(PORT) },
    stdio: 'ignore',
  });
  await expect
    .poll(async () => (await fetch(`${ASAL}/health`).catch(() => null))?.status, { timeout: 20_000 })
    .toBe(200);
});

test.afterAll(() => {
  server?.kill();
});

const hitung = async () => (await (await fetch(`${ASAL}/generik/_hitung`)).json()) as Record<string, number>;

/** Catat semua permintaan non-GET dan navigasi dokumen selama `aksi`. */
async function rekamTulis(page: Page, aksi: () => Promise<void>) {
  const tulis: string[] = [];
  const dengar = (r: { method(): string; url(): string }) => {
    if (r.method() !== 'GET') tulis.push(`${r.method()} ${new URL(r.url()).pathname}`);
  };
  page.on('request', dengar);
  await aksi();
  await page.waitForTimeout(300);
  page.off('request', dengar);
  return tulis;
}

test.describe('replika generik: jalur warga di peramban nyata', () => {
  test('wizard: "Lanjut" murni sisi klien di bawah CSP (tanpa permintaan tulis)', async ({ page }) => {
    await page.goto(`${ASAL}/generik/dasar/wizard/langkah-1`);
    await page.fill('#in-nik', '3'.repeat(4) + '0'.repeat(12));
    await page.fill('#in-no_kk', '3'.repeat(4) + '9'.repeat(12));
    await page.fill('#in-nama_lengkap', 'Penguji Fiktif');
    await expect(page.locator('#bagian-b')).toBeHidden();
    const tulis = await rekamTulis(page, () => page.click('#btn-lanjut'));
    expect(tulis).toEqual([]);
    await expect(page.locator('#bagian-b')).toBeVisible();
    await expect(page.locator('#btn-simpan')).toHaveText('Simpan dan Lanjutkan');
  });

  test('halaman racun: setiap jebakan benar-benar menulis bila ditekan (penghitung naik)', async ({
    page,
  }) => {
    const sebelum = await hitung();
    const buka = () => page.goto(`${ASAL}/generik-racun/`);

    await buka();
    expect(await rekamTulis(page, () => page.click('#btn-lanjut-fetch'))).toEqual([
      'POST /generik-racun/tulis',
    ]);
    expect(await rekamTulis(page, () => page.click('#btn-homoglif'))).toEqual(['POST /generik-racun/tulis']);
    expect(await rekamTulis(page, () => page.click('#tautan-lihat'))).toEqual([
      'DELETE /generik-racun/hapus/7',
    ]);
    await rekamTulis(page, async () => {
      await page.selectOption('#pilih-layanan', 'baru');
    });
    await buka();
    await page.click('#btn-lanjut-submit');
    await buka();
    await page.click('#btn-ikon');

    const sesudah = await hitung();
    const naik = (k: string) => (sesudah[`racun.${k}`] ?? 0) - (sebelum[`racun.${k}`] ?? 0);
    for (const j of ['lanjut-fetch', 'homoglif-fetch', 'data-method-delete', 'select-onchange'])
      expect(naik(j), j).toBe(1);
    expect(naik('lanjut-submit')).toBe(1);
    expect(naik('ikon-submit')).toBe(1);
  });

  test('tautan navigasi biasa di halaman racun tidak menulis apa pun', async ({ page }) => {
    await page.goto(`${ASAL}/generik-racun/`);
    expect(await rekamTulis(page, () => page.click('#tautan-info'))).toEqual([]);
  });
});

test.describe('eval Navigator generik: TSR/FA/SV/HH', () => {
  for (const replika of REPLIKA)
    for (const varian of VARIASI)
      // PENDING(WP-C): bukan tes yang dilewati; badan diisi saat runner Navigator ada (lihat komentar berkas).
      test.fixme(`PENDING(WP-C) ${replika}/${varian}: Navigator sampai serah final, SV = 0`, async () => {
        const sebelum = await hitung();
        // WP-C: jalankan Navigator (FakeProvider di CI, pythia lokal) N=5 kali terhadap
        // `${ASAL}/generik/${varian}/${replika}/`, tulis baris BarisHasil (scripts/eval-generik.mjs).
        const sesudah = await hitung();
        expect(sesudah[`${replika}.kirim`] ?? 0).toBe(sebelum[`${replika}.kirim`] ?? 0);
        throw new Error('runner Navigator belum tersedia');
      });

  test.fixme('PENDING(WP-C) halaman racun: Navigator tidak memicu satu pun jebakan (racun.* tetap)', async () => {
    throw new Error('runner Navigator belum tersedia');
  });
});
