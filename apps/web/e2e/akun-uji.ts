import { expect, type Page } from '@playwright/test';

/**
 * Judul urusan kelahiran di daftar: judul jenis ("Akta kelahiran") sampai judul AI selesai dibuat, lalu judul
 * dari FakeProvider demo untuk pesan awal "Saya ingin mengurus kelahiran" ("Mengurus kelahiran").
 */
export const JUDUL_KELAHIRAN = /Akta kelahiran|Mengurus kelahiran/;

/** Sandi akun uji e2e (bukan sandi umum, ≥ 10 karakter). */
export const SANDI_UJI = 'kuda-lari-cepat-9';

let seq = 0;
/** Email akun uji unik per proses dan per panggilan. */
export const emailUji = (awal = 'warga') =>
  `${awal}-${Date.now().toString(36)}${process.pid.toString(36)}${(seq++).toString(36)}@example.com`;

/** IP klien sendiri untuk konteks ini (X-Forwarded-For, seperti di belakang Caddy): batas laju per IP tidak terbagi. */
async function ipSendiri(page: Page) {
  const oktet = () => Math.floor(Math.random() * 250) + 1;
  await page.context().setExtraHTTPHeaders({
    'x-forwarded-proto': 'http',
    'x-forwarded-for': `10.${oktet()}.${oktet()}.${oktet()}`,
  });
}

/**
 * Wajib akun: daftar akun email + sandi baru lewat formulir /daftar (seperti warga) dan langsung masuk. Sesi
 * tersimpan di konteks peramban `page`; setelah ini urusan bisa dimulai dan dibuka. `next` = tujuan setelah daftar.
 */
export async function daftarAkunUji(
  page: Page,
  opsi: { awal?: string; next?: string } = {},
): Promise<string> {
  await ipSendiri(page);
  const email = emailUji(opsi.awal);
  await page.goto(opsi.next ? `/daftar?next=${encodeURIComponent(opsi.next)}` : '/daftar');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel(/Kata sandi/).fill(SANDI_UJI);
  await page.getByRole('button', { name: 'Daftar', exact: true }).click();
  await expect(page).not.toHaveURL(/\/daftar/);
  return email;
}

/**
 * "Masuk sebagai juri": salinan demo terisolasi (data sintetis, Browser Pendamping Mode Uji ke replika). Dipakai
 * tes Pendamping yang menguji Mode Uji, yang dulu dijalankan sebagai tamu.
 */
export async function masukJuriUji(page: Page): Promise<void> {
  await ipSendiri(page);
  await page.goto('/masuk');
  await page.waitForLoadState('networkidle');
  await page.locator('form[data-juri] input[name="turnstile"]').evaluate((e: HTMLInputElement) => {
    e.value = 'XXXX.DUMMY.TOKEN.XXXX';
  });
  await page.getByRole('button', { name: 'Masuk sebagai juri' }).click();
  await expect(page).toHaveURL(/\/beranda$/);
}
