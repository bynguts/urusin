import { expect, test } from '@playwright/test';

// Semua layar auth memakai kerangka yang sama. Periksa juga ukuran huruf terbesar dari Pengaturan,
// bukan hanya viewport kecil dengan teks bawaan: leading piksel tetap membuat judul bertumpuk.
for (const width of [320, 768, 1024, 1440]) {
  test(`auth membungkus teks besar dan kontrol tetap bekerja di ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 600 });
    await page.addInitScript(() => {
      localStorage.setItem('urusin.prefs.v1', JSON.stringify({ ukuranHuruf: 1.5 }));
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    for (const path of ['/masuk', '/daftar', '/lupa-sandi', '/atur-ulang-sandi']) {
      await page.goto(path);
      await expect(page.locator('html')).toHaveCSS('font-size', '24px');
      const ukuran = await page.evaluate(() => {
        const heading = getComputedStyle(document.querySelector('h1')!);
        return {
          lebar: document.documentElement.scrollWidth,
          font: parseFloat(heading.fontSize),
          tinggiBaris: parseFloat(heading.lineHeight),
        };
      });
      expect(ukuran.lebar, path).toBeLessThanOrEqual(width);
      expect(ukuran.tinggiBaris, path).toBeGreaterThanOrEqual(ukuran.font * 1.1);
    }

    await page.goto('/masuk');
    await page.getByLabel('Email', { exact: true }).fill('warga@example.com');
    await page.getByLabel('Kata sandi', { exact: true }).fill('contoh-sandi-aman');
    await page.getByRole('button', { name: 'Tampilkan sandi' }).click();
    await expect(page.locator('#sandi')).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Sembunyikan sandi' }).click();
    await expect(page.locator('#sandi')).toHaveAttribute('type', 'password');
    await page.getByRole('link', { name: 'Lupa kata sandi?' }).click();
    await expect(page).toHaveURL(/\/lupa-sandi$/);
    expect(errors).toEqual([]);
  });
}

test('alamat email panjang pada hasil auth tidak memperlebar halaman HP', async ({ page, context }) => {
  await page.setViewportSize({ width: 320, height: 600 });
  await context.setExtraHTTPHeaders({
    'x-forwarded-proto': 'http',
    'x-forwarded-for': '10.250.21.1',
  });
  await page.addInitScript(() => {
    localStorage.setItem('urusin.prefs.v1', JSON.stringify({ ukuranHuruf: 1.5 }));
  });
  await page.goto('/lupa-sandi');
  await page.getByLabel('Email', { exact: true }).fill(`${'alamatpanjang'.repeat(4)}@example.com`);
  await page.getByRole('button', { name: 'Kirim tautan' }).click();
  await expect(page.getByRole('status')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
