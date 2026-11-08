import { expect, test } from '@playwright/test';

// Alur utama warga: Landing → Rencana peristiwa → layar urusan (percakapan) di HP 390px dan laptop 1440px.
// Server memakai DemoProvider (tanpa kunci LLM), jadi tidak ada yang dikirim ke situs pemerintah.
for (const lebar of [390, 1440]) {
  test(`landing → peristiwa → urusan di ${lebar}px`, async ({ page }) => {
    await page.setViewportSize({ width: lebar, height: lebar < 600 ? 844 : 960 });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Teman AI untuk');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(lebar);

    // Kartu cerita → rencana langkah dengan sumber resmi
    await page.getByRole('link', { name: /Mulai cerita.*Baru punya anak/ }).click();
    await expect(page).toHaveURL(/\/peristiwa\/kelahiran/);
    await expect(page.getByRole('button', { name: 'Mulai urusan ini' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(lebar);

    // Mulai urusan → layar urusan; pesan pertama warga tampil dan AI menjawab
    await page.getByRole('button', { name: 'Mulai urusan ini' }).click();
    await expect(page).toHaveURL(/\/urusan\/u_[0-9a-f]{32}$/);
    const log = page.getByRole('log', { name: 'Percakapan urusan' });
    await expect(log).toContainText('Saya ingin mengurus kelahiran');
    await expect(log.locator('[data-pelaku="ai"]').first()).toBeVisible({ timeout: 20_000 });

    // Warga bertanya lagi lewat komposer
    const komposer = page.getByLabel('Tulis jawaban atau pertanyaan');
    await komposer.fill('Apa saja dokumen yang perlu saya bawa?');
    await page.getByRole('button', { name: 'Kirim' }).click();
    await expect(log).toContainText('Apa saja dokumen yang perlu saya bawa?');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(lebar);

    // Urusan tercatat di Urusanku perangkat ini
    await page.goto('/urusanku');
    await expect(page.getByRole('heading', { name: 'Akta kelahiran' }).first()).toBeVisible();

    // Ringkasan melanjutkan urusan terakhir: pertanyaan terakhir warga dan fase urusan tampil
    await page.goto('/beranda');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Kita lanjutkan');
    await expect(page.getByRole('region', { name: 'Percakapan terakhir' })).toContainText(
      'Apa saja dokumen yang perlu saya bawa?',
    );
    await expect(page.getByText(/Langkah \d dari 4/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(lebar);

    // Urusan baru tetap bisa dimulai dari kotak cerita
    await page.goto('/beranda?baru');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Apa yang ingin Anda urus?');
  });
}
