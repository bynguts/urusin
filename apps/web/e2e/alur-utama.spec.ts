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

// Halaman Web publik dari frame pen (Cara kerja, Urusan, Tanya jawab): statis tanpa JS, tanpa geser samping,
// dicapai dari navigasi landing; tanya jawab memakai <details> yang tetap jalan tanpa JavaScript.
const HALAMAN_WEB = [
  { path: '/cara-kerja', nav: 'Cara kerja', h1: 'Dari cerita sampai pengajuan, langkah demi langkah' },
  { path: '/urusan', nav: 'Urusan', h1: 'Urusan yang bisa dibantu Urusin' },
  { path: '/tanya-jawab', nav: 'Tanya jawab', h1: 'Pertanyaan yang sering diajukan' },
];
for (const lebar of [390, 1440]) {
  test(`halaman web cara kerja, urusan, tanya jawab di ${lebar}px`, async ({ page }) => {
    await page.setViewportSize({ width: lebar, height: lebar < 600 ? 844 : 960 });
    for (const h of HALAMAN_WEB) {
      await page.goto(h.path);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(h.h1);
      expect(await page.locator('script').count()).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(lebar);
    }
    // Kartu peristiwa: judul menuju halaman peristiwa, tombol mulai = formulir POST ke aksi landing
    await page.goto('/urusan');
    await expect(page.getByRole('link', { name: 'Kelahiran' })).toHaveAttribute(
      'href',
      /\/peristiwa\/kelahiran$/,
    );
    await expect(page.locator('form[action="/?/mulai"] input[name="peristiwa"]')).toHaveCount(5);
    // Akordeon: pertanyaan tertutup terbuka saat diklik
    await page.goto('/tanya-jawab');
    const tanya = page.locator('details', { hasText: 'Apakah password saya aman?' });
    await expect(tanya).not.toHaveAttribute('open');
    await tanya.getByRole('heading', { name: 'Apakah password saya aman?' }).click();
    await expect(tanya).toHaveAttribute('open');
    await expect(tanya.getByText('tidak dikirim ke AI')).toBeVisible();
    if (lebar >= 1024) {
      for (const h of HALAMAN_WEB) {
        await page.goto('/');
        const nav = page.getByRole('navigation', { name: 'Navigasi utama' });
        await nav.getByRole('link', { name: h.nav, exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`${h.path}$`));
        await expect(
          page
            .getByRole('navigation', { name: 'Navigasi utama' })
            .getByRole('link', { name: h.nav, exact: true }),
        ).toHaveAttribute('aria-current', 'page');
      }
    }
  });
}

// Regresi 409: pesan lanjutan setelah turn selesai tidak boleh ditolak (versi urusan sampai ke klien lewat done).
test('pesan lanjutan berturut-turut tidak pernah 409 dan tidak menampilkan "masih memproses"', async ({
  page,
}) => {
  const statusTurn: number[] = [];
  page.on('response', (r) => {
    if (/\/api\/urusan\/u_[0-9a-f]+\/turn$/.test(r.url()) && r.request().method() === 'POST')
      statusTurn.push(r.status());
  });
  await page.goto('/peristiwa/kelahiran');
  await page.getByRole('button', { name: 'Mulai urusan ini' }).click();
  await expect(page).toHaveURL(/\/urusan\/u_[0-9a-f]{32}$/);
  const log = page.getByRole('log', { name: 'Percakapan urusan' });
  await expect(log.locator('[data-pelaku="ai"]').first()).toBeVisible({ timeout: 20_000 });
  const komposer = page.getByLabel('Tulis jawaban atau pertanyaan');
  let terkirim = 0;
  for (const teks of ['Apa saja dokumen yang perlu saya bawa?', 'Berapa biayanya?', 'Terima kasih']) {
    await komposer.fill(teks);
    await expect(page.getByRole('button', { name: 'Kirim' })).toBeEnabled({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Kirim' }).click();
    await expect(log).toContainText(teks);
    await expect.poll(() => statusTurn.length).toBe(++terkirim);
    // tunggu turn selesai sebelum pesan berikutnya (seperti warga membaca jawaban dulu)
    const idUrusan = page.url().split('/').at(-1);
    await expect
      .poll(async () => (await (await page.request.get(`/api/urusan/${idUrusan}`)).json()).berjalan, {
        timeout: 20_000,
      })
      .toBe(false);
  }
  await expect(page.getByText('masih memproses langkah sebelumnya')).toHaveCount(0);
  expect(statusTurn.every((s) => s === 202)).toBe(true);
});
