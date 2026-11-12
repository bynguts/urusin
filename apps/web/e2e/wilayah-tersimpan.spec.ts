import { expect, test } from '@playwright/test';
import { daftarAkunUji } from './akun-uji';

// QA prod (warga di HP 390, sudah masuk): wilayah yang disimpan di Pengaturan > Wilayah layanan harus dipakai saat
// urusan dimulai dari kartu peristiwa di landing. Landing tanpa JavaScript (csr=false) tidak bisa membaca
// localStorage, jadi pilihan itu sampai ke server lewat cookie dan menjadi kartu usulan "KTP Anda terdaftar di …?".
test('warga di HP: wilayah dari Pengaturan menjadi usulan saat mulai dari kartu peristiwa landing', async ({
  browser,
}) => {
  const page = await browser.newPage({
    baseURL: test.info().project.use.baseURL,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    extraHTTPHeaders: { 'x-forwarded-proto': 'http', 'x-forwarded-for': '10.20.30.61' },
  });
  try {
    await daftarAkunUji(page);
    await page.goto('/pengaturan');
    const kota = page.getByRole('combobox', { name: 'Kab/kota', exact: true });
    // Tunggu hidrasi: sebelum itu kolomnya masih <select> SSR.
    await expect(kota).toHaveAttribute('aria-autocomplete', 'list');
    await kota.fill('Sleman');
    await kota.press('Enter');
    await expect(kota).toHaveValue('Kabupaten Sleman');
    await page.getByRole('button', { name: 'Simpan wilayah' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Wilayah disimpan' })).toBeVisible();

    await page.goto('/');
    await page.locator('form:has(input[name="peristiwa"][value="kematian"]) button[type="submit"]').click();
    await expect(page).toHaveURL(/\/urusan\/u_[0-9a-f]{32}$/);
    await expect(page.getByText('KTP Anda terdaftar di Kabupaten Sleman?')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ya, betul' })).toBeVisible();
  } finally {
    await page.close();
  }
});
