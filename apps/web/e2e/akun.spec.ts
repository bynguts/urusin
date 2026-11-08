import { mkdirSync, readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { E2E_DIR, OUTBOX } from '../playwright.config';

mkdirSync(E2E_DIR, { recursive: true });

/** Tautan terakhir di outbox mailer dev untuk penerima + jenis (menunggu sampai muncul). */
async function tautan(email: string, jenis: 'verifikasi' | 'atur-ulang'): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      () => {
        let isi: string;
        try {
          isi = readFileSync(OUTBOX, 'utf8');
        } catch {
          return undefined;
        }
        link = isi
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l) as { to: string; jenis: string; link: string })
          .filter((m) => m.to === email && m.jenis === jenis)
          .at(-1)?.link;
        return link;
      },
      { timeout: 10_000 },
    )
    .toBeTruthy();
  return link!;
}

async function masuk(page: Page, email: string, sandi: string) {
  await page.goto('/masuk');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Kata sandi').fill(sandi);
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();
}

test('daftar → verifikasi → masuk → lupa sandi → atur ulang', async ({ page, context }) => {
  const email = `e2e-${Date.now()}@example.com`;
  const sandi = 'kuda-lari-cepat-9';
  const sandiBaru = 'gajah-terbang-tinggi-7';

  // Daftar
  await page.goto('/daftar');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel(/Kata sandi/).fill(sandi);
  await page.getByRole('button', { name: 'Daftar', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Cek email Anda');

  // Belum terverifikasi: masuk ditolak dengan arahan kirim ulang
  await masuk(page, email, sandi);
  await expect(page.getByRole('alert')).toHaveAttribute('data-kode', 'EMAIL_BELUM_TERVERIFIKASI');

  // Verifikasi: membuka tautan tidak memakai token; tombol yang memakainya
  const verif = await tautan(email, 'verifikasi');
  await page.goto(verif);
  await page.getByRole('button', { name: 'Pastikan email saya' }).click();
  await expect(page.getByRole('status')).toContainText('Email sudah dipastikan');
  await page.goto(verif);
  await expect(page.getByRole('alert')).toHaveAttribute('data-kode', 'TOKEN_TIDAK_VALID');

  // Masuk → Lengkapi profil → beranda; cookie sesi __Host- HttpOnly Secure
  await masuk(page, email, sandi);
  await expect(page).toHaveURL(/\/lengkapi-profil\?next=%2F$/);
  await page.getByLabel(/Nama lengkap/).fill('Warga Uji E2E');
  await page.getByRole('button', { name: 'Simpan' }).click();
  await expect(page).toHaveURL(/\/$/);
  const sesi = (await context.cookies()).find((c) => c.name === '__Host-urusin_akun');
  expect(sesi).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
  const akun = await (await page.request.get('/api/akun')).json();
  expect(akun).toMatchObject({ masuk: true, akun: { email, profilLengkap: true } });

  // Lupa sandi → tautan reset → sandi baru; semua sesi (termasuk yang ini) dikeluarkan
  await page.goto('/lupa-sandi');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Kirim tautan' }).click();
  await expect(page.getByRole('status')).toContainText('Tautan berlaku 30 menit');
  const reset = await tautan(email, 'atur-ulang');
  await page.goto(reset);
  await page.getByLabel(/Kata sandi baru/).fill(sandiBaru);
  await page.getByRole('button', { name: 'Simpan kata sandi' }).click();
  await expect(page.getByRole('status')).toContainText('Kata sandi baru tersimpan');
  expect((await (await page.request.get('/api/akun')).json()).masuk).toBe(false);

  // Tautan reset sekali pakai
  await page.goto(reset);
  await expect(page.getByRole('alert')).toHaveAttribute('data-kode', 'TOKEN_TIDAK_VALID');

  // Sandi lama ditolak, sandi baru diterima
  await masuk(page, email, sandi);
  await expect(page.getByRole('alert')).toHaveAttribute('data-kode', 'KREDENSIAL_SALAH');
  await masuk(page, email, sandiBaru);
  await expect(page).toHaveURL(/\/$/);
  expect((await (await page.request.get('/api/akun')).json()).masuk).toBe(true);
});

test('tamu tetap bisa memakai aplikasi tanpa daftar', async ({ page }) => {
  await page.goto('/');
  expect((await (await page.request.get('/api/akun')).json()).masuk).toBe(false);
  await page.goto('/masuk');
  await page.getByRole('link', { name: 'Coba tanpa daftar' }).click();
  await expect(page).toHaveURL(/\/$/);
});
