import { expect, test } from '@playwright/test';
import { daftarAkunUji } from './akun-uji';

test.beforeEach(async ({ context }) => {
  const octet = () => Math.floor(Math.random() * 250) + 1;
  await context.setExtraHTTPHeaders({
    'x-forwarded-proto': 'http',
    'x-forwarded-for': `10.${octet()}.${octet()}.${octet()}`,
  });
});

async function masuk(page: import('@playwright/test').Page) {
  await page.goto('/masuk');
  await page.waitForLoadState('networkidle');
  await page.locator('form[data-juri] input[name="turnstile"]').evaluate((el: HTMLInputElement) => {
    el.value = 'XXXX.DUMMY.TOKEN.XXXX';
  });
  await page.getByRole('button', { name: 'Masuk sebagai juri' }).click();
  await expect(page).toHaveURL(/\/beranda$/);
  await page.waitForLoadState('networkidle');
}

test('Urusan baru membersihkan draf dan memfokuskan kotak cerita, termasuk klik berulang', async ({
  page,
}) => {
  await masuk(page);
  const kotak = page.getByLabel('Ceritakan urusan Anda');
  await kotak.fill('Draf lama yang belum dikirim');
  const baru = page.getByRole('link', { name: 'Urusan baru', exact: true });
  await baru.click();
  await expect(kotak).toHaveValue('');
  await expect(kotak).toBeFocused();
  await kotak.fill('Draf kedua');
  await baru.click();
  await expect(kotak).toHaveValue('');
  await expect(kotak).toBeFocused();
});

test('menu ponsel menutup dengan Escape dan klik di luar, lalu pintasan Bantuan membuka jawaban yang disaring', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/bantuan');
  await page.waitForLoadState('networkidle');
  const buka = page.getByRole('button', { name: 'Buka menu', exact: true });
  await buka.click();
  const tutup = page.getByRole('button', { name: 'Tutup menu', exact: true });
  await expect(tutup).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(buka).toBeFocused();
  await expect(page.locator('#menu-app-hp')).toHaveCount(0);
  await buka.click();
  await expect(tutup).toBeVisible();
  await page.mouse.click(4, 420);
  await expect(page.locator('#menu-app-hp')).toHaveCount(0);

  await page.getByRole('searchbox').fill('OTP');
  await expect(page.locator('#tanya-situs-berubah')).toHaveCount(0);
  await page.getByRole('link', { name: 'Situs resmi bermasalah?', exact: false }).click();
  await expect(page.getByRole('searchbox')).toHaveValue('');
  await expect(page.locator('#tanya-situs-berubah')).toHaveJSProperty('open', true);
});

test('dialog unggah dibuka ulang dengan berkas kosong dan bisa memilih berkas yang sama', async ({
  page,
}) => {
  let unggahan = 0;
  await page.route('**/api/vault', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { dokumen: [] } });
    unggahan++;
    return route.fulfill({
      json: {
        id: 'dok_uji',
        jenis: 'ktp',
        judul: 'Berkas uji fiktif',
        mime: 'application/pdf',
        ukuran: 24,
        disimpanPada: new Date().toISOString(),
      },
    });
  });
  await daftarAkunUji(page);
  await page.goto('/dokumen');
  const tambah = page.getByRole('button', { name: 'Tambah dokumen', exact: true });
  await tambah.click();
  const dialog = page.getByRole('dialog', { name: 'Tambah dokumen' });
  const input = dialog.getByLabel('Foto atau PDF', { exact: true });
  const berkas = {
    name: 'contoh.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 berkas uji fiktif'),
  };
  await input.setInputFiles(berkas);
  await dialog.getByRole('button', { name: 'Batal', exact: true }).click();
  await tambah.click();
  expect(await input.evaluate((e: HTMLInputElement) => e.files?.length)).toBe(0);
  await dialog.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(dialog.getByText('Pilih foto atau PDF dokumen.', { exact: true })).toBeVisible();
  expect(unggahan).toBe(0);
  await input.setInputFiles(berkas);
  await dialog.getByLabel('Nama dokumen').fill('Berkas uji fiktif');
  await dialog.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('link', { name: 'Berkas uji fiktif (lihat berkas)' })).toBeVisible();
  expect(unggahan).toBe(1);
});

for (const width of [320, 1024]) {
  test(`kontrol dashboard tetap muat dengan huruf 150% pada ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() =>
      localStorage.setItem('urusin.prefs.v1', JSON.stringify({ ukuranHuruf: 1.5 })),
    );
    await daftarAkunUji(page);
    await page.goto('/pengaturan');
    await expect(page.getByRole('combobox', { name: 'Kab/kota', exact: true })).toHaveAttribute(
      'aria-autocomplete',
      'list',
    );
    const ukuran = page.getByRole('group', { name: 'Ukuran huruf', exact: true });
    expect(
      await ukuran.locator('label').evaluateAll((labels) =>
        labels.every((label) => {
          const r = label.getBoundingClientRect();
          return [...label.querySelectorAll('span')].every((span) => {
            const s = span.getBoundingClientRect();
            return s.left >= r.left - 1 && s.right <= r.right + 1;
          });
        }),
      ),
    ).toBe(true);
    const hapus = page.getByRole('button', { name: 'Hapus data di perangkat ini', exact: true });
    await hapus.scrollIntoViewIfNeeded();
    expect(
      await hapus.evaluate((e) => {
        const b = e.getBoundingClientRect();
        const p = e.parentElement!.getBoundingClientRect();
        return b.left >= p.left && b.right <= p.right && b.right <= window.innerWidth;
      }),
    ).toBe(true);
    if (width < 1024) {
      const nav = page.getByRole('navigation', { name: 'Navigasi utama', exact: true });
      expect(
        await nav.getByRole('link').evaluateAll((links) =>
          links.every((link) => {
            const b = link.getBoundingClientRect();
            const text = link.querySelector('span')!.getBoundingClientRect();
            return text.left >= b.left && text.right <= b.right;
          }),
        ),
      ).toBe(true);
    }
    await page.screenshot({ path: test.info().outputPath(`pengaturan-${width}.png`) });
  });
}

test('status gagal berhenti memuat dan dapat dicoba ulang tanpa memuat ulang dashboard', async ({ page }) => {
  const id = `u_${'a'.repeat(32)}`;
  await page.addInitScript(
    (id) =>
      localStorage.setItem(
        'urusin.lokal.v1',
        JSON.stringify({
          versiWilayah: 2,
          urusan: [
            { id, judul: 'Contoh urusan uji', peristiwa: 'kelahiran', dibuatPada: new Date().toISOString() },
          ],
        }),
      ),
    id,
  );
  let panggilan = 0;
  await page.route('**/api/urusan?ids=*', (route) => {
    panggilan++;
    return panggilan === 1
      ? route.fulfill({ status: 503, json: {} })
      : route.fulfill({ json: { urusan: [{ id, state: 'MENUNGGU_SUBMIT_WARGA' }] } });
  });
  await masuk(page);
  await expect(page.getByRole('alert')).toContainText('Status terbaru belum bisa dimuat');
  await expect(page.getByRole('article')).toContainText('Status belum tersedia');
  await expect(page.getByRole('article')).not.toContainText('Memuat status');
  await page.getByRole('button', { name: 'Coba lagi', exact: true }).click();
  await expect(page.getByRole('article')).toContainText('Giliran Anda: tekan Kirim');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(panggilan).toBe(2);
});
