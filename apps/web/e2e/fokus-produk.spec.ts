import { expect, test } from '@playwright/test';
import { masukJuriUji } from './akun-uji';

test('detail topik tetap muat di 320px dengan huruf 150%', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.addInitScript(() =>
    localStorage.setItem('urusin.prefs.v1', JSON.stringify({ ukuranHuruf: 1.5 })),
  );
  await masukJuriUji(page);
  for (const slug of ['kelahiran', 'kematian', 'perkawinan', 'pindah', 'lainnya']) {
    await page.goto(`/peristiwa/${slug}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth), slug).toBeLessThanOrEqual(320);
    await expect(page.getByText('Browser Pendamping', { exact: false })).toHaveCount(0);
  }
});

test('halaman publik mempertahankan Urusin dan memisahkan katalog dari promosi', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 640 });
  await page.goto('/');
  await expect(page).toHaveTitle('Urusin: pendamping layanan publik');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Tanyakan ke Urusin');
  await expect(page.getByText('Browser Pendamping', { exact: false })).toHaveCount(0);
  await page.goto('/urusan');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Urusan yang bisa dibantu Urusin');
  await expect(page.getByRole('heading', { name: 'Topik yang tersedia' })).toBeVisible();
  await expect(page.getByText('Banyak instansi, banyak situs.', { exact: false })).toHaveCount(0);
  await expect(page.getByText('Urusan berikutnya,', { exact: false })).toHaveCount(0);
  await page.goto('/cara-kerja');
  await expect(page.locator('#browser-pendamping')).toContainText('Coming soon');
  await expect(page.getByRole('heading', { name: 'Browser Pendamping', exact: true })).toHaveCount(0);
  await page.goto('/tanya-jawab');
  await page.getByText('Apakah Urusin mengajukan permohonan untuk saya?', { exact: true }).click();
  await expect(page.locator('details[open]')).toContainText('Coming soon');
});

test('percakapan dapat dimulai dan endpoint browser tetap coming soon', async ({ page }) => {
  await masukJuriUji(page);
  await expect(page).toHaveTitle('Beranda · Urusin');
  await page.getByLabel('Tulis pertanyaan Anda').fill('Saya mau bertanya tentang mengurus akta kelahiran');
  await page.getByRole('button', { name: 'Kirim', exact: true }).click();
  await expect(page).toHaveURL(/\/urusan\/u_[a-f0-9]{32}$/);
  await expect(page.getByRole('textbox')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Setujui dan buka situs' })).toHaveCount(0);
  const id = page.url().split('/').at(-1);
  const response = await page.request.post(`/api/urusan/${id}/pendamping`, {
    data: {},
    headers: { origin: new URL(page.url()).origin },
  });
  expect(response.status()).toBe(503);
  expect(await response.text()).toContain('Coming soon');
});
