import { expect, test, type Page } from '@playwright/test';
import { daftarAkunUji } from './akun-uji';

// Semua data uji berada di DB sementara runner. CRUD brankas lewat UI dan backend sebenarnya, tanpa mock API.
test.beforeEach(async ({ context }) => {
  const octet = () => Math.floor(Math.random() * 250) + 1;
  await context.setExtraHTTPHeaders({
    'x-forwarded-proto': 'http',
    'x-forwarded-for': `10.${octet()}.${octet()}.${octet()}`,
  });
});

async function masuk(page: Page) {
  await page.goto('/masuk');
  await page.waitForLoadState('networkidle');
  await page.locator('form[data-juri] input[name="turnstile"]').evaluate((e: HTMLInputElement) => {
    e.value = 'XXXX.DUMMY.TOKEN.XXXX';
  });
  await page.getByRole('button', { name: 'Masuk sebagai juri' }).click();
  await expect(page).toHaveURL(/\/beranda$/);
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('dokumen: unggah, filter, unduh, batal hapus, hapus jenis terakhir, dan hapus semua', async ({
  page,
}) => {
  await daftarAkunUji(page);
  await page.goto('/dokumen');
  await expect(page.getByText('Belum ada dokumen', { exact: true })).toBeVisible();
  for (const [jenis, judul] of [
    ['kk', 'KK Uji Interaksi'],
    ['foto', 'Foto Uji Interaksi'],
  ]) {
    await page.getByRole('button', { name: 'Tambah dokumen', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Tambah dokumen' });
    await dialog.getByLabel('Jenis dokumen').selectOption(jenis!);
    await dialog.getByLabel('Nama dokumen').fill(judul!);
    await dialog
      .getByLabel('Foto atau PDF', { exact: true })
      .setInputFiles({ name: 'contoh.png', mimeType: 'image/png', buffer: PNG });
    await dialog.getByRole('button', { name: 'Simpan', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('link', { name: `${judul} (lihat berkas)` })).toBeVisible();
  }
  await page
    .getByRole('group', { name: 'Saring dokumen' })
    .getByRole('button', { name: /Pas foto/ })
    .click();
  await expect(page.getByRole('link', { name: 'KK Uji Interaksi (lihat berkas)' })).toHaveCount(0);
  const foto = page.getByRole('link', { name: 'Foto Uji Interaksi (lihat berkas)' });
  const [unduhan] = await Promise.all([page.waitForEvent('download'), foto.click()]);
  expect(unduhan.suggestedFilename()).toContain('Foto Uji Interaksi');
  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('button', { name: 'Hapus Foto Uji Interaksi', exact: true }).click();
  await expect(foto).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Hapus Foto Uji Interaksi', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Foto Uji Interaksi dihapus.');
  await expect(page.getByRole('link', { name: 'KK Uji Interaksi (lihat berkas)' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', { name: 'KK Uji Interaksi (lihat berkas)' })).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Hapus semua dokumen', exact: true }).click();
  await expect(page.getByText('Belum ada dokumen', { exact: true })).toBeVisible();
});

test('dokumen contoh juri hanya baca; hapus semua hanya menghapus unggahan sendiri', async ({ page }) => {
  await masuk(page);
  await page.goto('/dokumen');
  await expect(page.getByText('Contoh bawaan · hanya baca', { exact: true })).toHaveCount(3);
  await expect(page.getByRole('button', { name: /^Hapus/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Tambah dokumen', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Tambah dokumen' });
  await dialog.getByLabel('Nama dokumen').fill('Berkas Uji Juri');
  await dialog
    .getByLabel('Foto atau PDF', { exact: true })
    .setInputFiles({ name: 'contoh.png', mimeType: 'image/png', buffer: PNG });
  await dialog.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Berkas Uji Juri (lihat berkas)' })).toBeVisible();
  page.once('dialog', async (d) => {
    expect(d.message()).toContain('1 dokumen');
    await d.accept();
  });
  await page.getByRole('button', { name: 'Hapus semua dokumen', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Berkas Uji Juri (lihat berkas)' })).toHaveCount(0);
  await expect(page.getByText('Contoh bawaan · hanya baca', { exact: true })).toHaveCount(3);
});

for (const [width, scale] of [
  [320, 1.5],
  [1024, 1],
]) {
  test(`data diri: tampil/sembunyikan NIK, validasi, batal, simpan, dan reload pada ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: width!, height: 900 });
    await page.addInitScript(
      (scale) => localStorage.setItem('urusin.prefs.v1', JSON.stringify({ ukuranHuruf: scale })),
      scale,
    );
    await masuk(page);
    await page.goto('/data-diri');
    await expect(page.getByRole('button', { name: 'Ubah data diri', exact: true })).toBeVisible();
    // Hapus data tetap terjangkau dari Data diri (footer situs tidak lagi memuatnya).
    await expect(page.getByRole('link', { name: 'Hapus data saya' })).toHaveAttribute(
      'href',
      /pengaturan#zona-bahaya$/,
    );
    const tabel = page.getByRole('table', { name: 'Data diri tersimpan' });
    const ubah = tabel.getByRole('button', { name: 'Ubah Nama lengkap', exact: true });
    const akses = await ubah.evaluate((e) => {
      const r = e.getBoundingClientRect();
      const box = e.closest('table')!.parentElement!;
      return r.right <= window.innerWidth || getComputedStyle(box).overflowX === 'auto';
    });
    expect(akses, 'aksi tabel yang melebar harus bisa digeser pengguna').toBe(true);
    const wilayahTabel = page.getByRole('region', { name: 'Tabel data diri', exact: true });
    if (await wilayahTabel.evaluate((e) => e.scrollWidth > e.clientWidth)) {
      await wilayahTabel.focus();
      await wilayahTabel.press('ArrowRight');
      await expect.poll(() => wilayahTabel.evaluate((e) => e.scrollLeft)).toBeGreaterThan(0);
      await wilayahTabel.hover();
      await page.mouse.wheel(600, 0);
      await expect.poll(() => wilayahTabel.evaluate((e) => e.scrollLeft)).toBeGreaterThan(0);
    }
    const bukaNik = page.getByRole('button', { name: 'Tampilkan NIK', exact: true });
    await bukaNik.click();
    await expect(page.getByRole('button', { name: 'Sembunyikan NIK', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: 'Sembunyikan NIK', exact: true }).click();
    await page.getByRole('button', { name: 'Ubah data diri', exact: true }).click();
    await page.getByLabel('Nama lengkap', { exact: true }).fill('Warga Uji Interaksi');
    await page.getByLabel('NIK', { exact: true }).fill('123');
    await page.getByRole('button', { name: 'Simpan data diri', exact: true }).click();
    await expect(page.getByLabel('NIK', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByLabel('NIK', { exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Batal', exact: true }).click();
    await expect(tabel).not.toContainText('Warga Uji Interaksi');
    await page.getByRole('button', { name: 'Ubah data diri', exact: true }).click();
    await page.getByLabel('Nama lengkap', { exact: true }).fill('Warga Uji Interaksi');
    await page.getByRole('button', { name: 'Simpan data diri', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Data diri tersimpan.');
    await page.reload();
    await expect(tabel).toContainText('Warga Uji Interaksi');
  });
}

test('pengaturan: saklar, ukuran huruf, wilayah, reload, batal dan konfirmasi hapus data lokal', async ({
  page,
}) => {
  await daftarAkunUji(page);
  await page.goto('/pengaturan');
  const wilayah = page.getByRole('combobox', { name: 'Kab/kota', exact: true });
  await expect(wilayah).toHaveAttribute('aria-autocomplete', 'list');
  await page.getByRole('switch', { name: 'Kontras tinggi', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-kontras', 'tinggi');
  await page.getByRole('switch', { name: 'Kurangi gerakan', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-gerak', 'kurang');
  await page.getByText('Sangat besar', { exact: true }).click();
  await wilayah.fill('Surabaya');
  await page.getByRole('option', { name: 'Kota Surabaya', exact: true }).click();
  await page.getByRole('button', { name: 'Simpan wilayah', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Wilayah disimpan' })).toContainText(
    'Wilayah disimpan: Kota Surabaya.',
  );
  await page.reload();
  await expect(wilayah).toHaveValue('Kota Surabaya');
  await expect(page.getByRole('radio', { name: 'Sangat besar', exact: true })).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-kontras', 'tinggi');
  const hapus = page.getByRole('button', { name: 'Hapus data di perangkat ini', exact: true });
  page.once('dialog', (d) => d.dismiss());
  await hapus.click();
  await expect(wilayah).toHaveValue('Kota Surabaya');
  page.once('dialog', (d) => d.accept());
  await hapus.click();
  await expect(wilayah).toHaveValue('');
  await expect(page.locator('html')).toHaveAttribute('data-kontras', 'normal');
  await expect(page.locator('html')).toHaveAttribute('data-gerak', 'normal');
  await expect(page.getByRole('radio', { name: 'Normal', exact: true })).toBeChecked();
});

test('navigasi sidebar dan filter Urusanku membuka urusan yang benar', async ({ page }) => {
  await masuk(page);
  await page.goto('/peristiwa/kelahiran?kodeKabKota=3312');
  await page.getByRole('button', { name: 'Mulai urusan ini', exact: true }).click();
  await expect(page).toHaveURL(/\/urusan\/u_[0-9a-f]{32}$/);
  const url = page.url();
  await page.getByRole('button', { name: 'Ya, betul', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Setujui rencana', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Ciutkan menu samping', exact: true }).click();
  await page.getByRole('link', { name: 'Urusanku', exact: true }).click();
  const filter = page.getByRole('group', { name: 'Saring urusan' });
  await filter.getByRole('button', { name: /Menunggu instansi/ }).click();
  await expect(page.getByText('Tidak ada urusan di kelompok ini', { exact: true })).toBeVisible();
  await filter.getByRole('button', { name: /Menunggu Anda/ }).click();
  await expect(page.getByRole('article')).toContainText('Akta kelahiran');
  await page.getByRole('link', { name: /Tinjau rencana\s*:\s*Akta kelahiran/ }).click();
  await expect(page).toHaveURL(url);
  await page.getByRole('button', { name: 'Buka menu samping', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Menu samping' })).toContainText('Urusan aktif');
});
