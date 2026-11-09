import { expect, test } from '@playwright/test';

// IP klien sendiri per tes (lewat X-Forwarded-For, seperti di belakang Caddy): kuota tamu/urusan baru per IP
// tidak terbagi antartes atau antarulangan (--repeat-each).
test.beforeEach(async ({ context }) => {
  const oktet = () => Math.floor(Math.random() * 250) + 1;
  await context.setExtraHTTPHeaders({
    'x-forwarded-proto': 'http',
    'x-forwarded-for': `10.${oktet()}.${oktet()}.${oktet()}`,
  });
});

// Alur utama warga: Landing → Rencana peristiwa → layar urusan (percakapan) di HP 390px dan laptop 1440px.
// Server memakai DemoProvider (tanpa kunci LLM), jadi tidak ada yang dikirim ke situs pemerintah.
for (const lebar of [390, 1440]) {
  test(`landing → peristiwa → urusan di ${lebar}px`, async ({ page }) => {
    await page.setViewportSize({ width: lebar, height: lebar < 600 ? 844 : 960 });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Urusan administrasi');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(lebar);

    // Kartu urusan Kelahiran "Pelajari" → rencana langkah dengan sumber resmi
    await page.getByRole('link', { name: 'Pelajari' }).first().click();
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

    // Peramban dengan urusan berjalan masuk ke Beranda (App 01): urusannya tampil di "Urusan berjalan"
    await page.goto('/');
    await expect(page).toHaveURL(/\/beranda$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Apa yang ingin Anda urus?');
    const berjalan = page.getByRole('region', { name: 'Urusan berjalan' });
    await expect(berjalan.getByRole('heading', { name: 'Akta kelahiran' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(lebar);

    // Urusan baru tetap bisa dimulai dari kotak cerita
    await page.goto('/beranda?baru');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Apa yang ingin Anda urus?');
  });
}

// /privasi (frame F6RSq): statis tanpa JS, dicapai dari tautan persetujuan /daftar dan navigasi landing.
for (const lebar of [390, 1440]) {
  test(`privasi dari /daftar dan landing di ${lebar}px`, async ({ page }) => {
    await page.setViewportSize({ width: lebar, height: lebar < 600 ? 844 : 960 });
    await page.goto('/daftar');
    await page.getByRole('link', { name: 'Kebijakan privasi' }).first().click();
    await expect(page).toHaveURL(/\/privasi$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Data keluargamu tetap milikmu');
    await expect(page.getByRole('table', { name: 'Data yang disimpan Urusin' })).toBeVisible();
    // Muat langsung: halaman statis tanpa satu pun <script> (navigasi dari /daftar dirender router klien).
    await page.goto('/privasi');
    expect(await page.locator('script').count()).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(lebar);
    await expect(page.getByRole('link', { name: 'Hapus data saya' }).first()).toHaveAttribute(
      'href',
      /pengaturan#zona-bahaya$/,
    );
    if (lebar >= 1024) {
      await page.goto('/');
      await page
        .getByRole('navigation', { name: 'Navigasi utama' })
        .getByRole('link', { name: 'Privasi' })
        .click();
      await expect(page).toHaveURL(/\/privasi$/);
      await expect(
        page.getByRole('navigation', { name: 'Navigasi utama' }).getByRole('link', { name: 'Privasi' }),
      ).toHaveAttribute('aria-current', 'page');
    }
  });
}
