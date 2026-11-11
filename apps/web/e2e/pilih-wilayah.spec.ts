import { expect, test } from '@playwright/test';

test('cari wilayah, batalkan, simpan, dan hapus pilihan tanpa mengubahnya menjadi teks bebas', async ({
  page,
}) => {
  await page.goto('/pengaturan');
  const kota = page.getByRole('combobox', { name: 'Kab/kota', exact: true });
  await expect(kota).toHaveAttribute('aria-autocomplete', 'list');
  await kota.fill('  SURABAYA  ');
  await expect(page.getByRole('option')).toHaveCount(1);
  await kota.press('Enter');
  await expect(kota).toHaveValue('Kota Surabaya');
  await page.getByRole('button', { name: 'Simpan wilayah' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Wilayah disimpan' })).toContainText(
    'Wilayah disimpan: Kota Surabaya.',
  );

  await kota.fill('wilayah-tidak-ada');
  await expect(page.getByRole('status').filter({ hasText: 'Wilayah tidak ditemukan' })).toBeVisible();
  await kota.press('Enter');
  await expect(page.getByRole('listbox')).toBeVisible();
  await kota.press('Escape');
  await expect(kota).toHaveValue('Kota Surabaya');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await page.reload();
  await expect(kota).toHaveValue('Kota Surabaya');

  await page.goto('/peristiwa/kelahiran');
  await expect(page).toHaveURL(/kodeKabKota=3578/);
  const ktp = page.getByRole('combobox', { name: 'Kabupaten/kota sesuai KTP Anda' });
  await expect(ktp).toHaveValue('Kota Surabaya');
  await ktp.fill('Wonogiri');
  await ktp.press('ArrowDown');
  await expect(ktp).toHaveAttribute('aria-activedescendant', /kota-opsi-0/);
  await ktp.press('Enter');
  await expect(page).toHaveURL(/kodeKabKota=3312/);
  await expect(ktp).toHaveValue('Kabupaten Wonogiri');

  await page.goto('/pengaturan');
  await kota.fill('Belum dipilih');
  await kota.press('Enter');
  await page.getByRole('button', { name: 'Simpan wilayah' }).click();
  await expect(page.getByRole('status')).toContainText('Pilihan wilayah dihapus.');
  await page.goto('/peristiwa/kelahiran');
  await expect(page).not.toHaveURL(/kodeKabKota=/);
});

test('pilihan di ponsel bisa disentuh, keluar dengan Tab, dan tidak melebar dari layar', async ({
  browser,
}) => {
  const page = await browser.newPage({
    baseURL: test.info().project.use.baseURL,
    viewport: { width: 320, height: 740 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    await page.goto('/pengaturan');
    const kota = page.getByRole('combobox', { name: 'Kab/kota', exact: true });
    await expect(kota).toHaveAttribute('aria-autocomplete', 'list');
    await kota.tap();
    await kota.fill('Kepulauan');
    const daftar = page.getByRole('listbox');
    const box = await daftar.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    await page.getByRole('option', { name: 'Kabupaten Administrasi Kepulauan Seribu', exact: true }).tap();
    await expect(kota).toHaveValue('Kabupaten Administrasi Kepulauan Seribu');
    await expect(daftar).toHaveCount(0);
    await kota.tap();
    await kota.fill('Surabaya');
    await kota.press('Tab');
    await expect(kota).toHaveValue('Kabupaten Administrasi Kepulauan Seribu');
    await expect(daftar).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Simpan wilayah' })).toBeFocused();
  } finally {
    await page.close();
  }
});

test('tanpa JavaScript, select dan tombol Tampilkan tetap membuka rencana wilayah', async ({ browser }) => {
  const page = await browser.newPage({ baseURL: test.info().project.use.baseURL, javaScriptEnabled: false });
  try {
    await page.goto('/peristiwa/kelahiran');
    await page.getByLabel('Kabupaten/kota sesuai KTP Anda').selectOption('3312');
    await page.getByRole('button', { name: 'Tampilkan', exact: true }).click();
    await expect(page).toHaveURL(/kodeKabKota=3312/);
    await expect(page.getByLabel('Kabupaten/kota sesuai KTP Anda')).toHaveValue('3312');
  } finally {
    await page.close();
  }
});
