import { expect, test } from '@playwright/test';

// HP lambat (dan runner CI yang sibuk): warga memilih kab/kota sebelum JS halaman terpasang. Pilihan itu harus
// tetap membuka rencana wilayahnya setelah hidrasi, bukan hilang karena onchange belum ada saat dipilih.
test('kab/kota dipilih sebelum hidrasi tetap membuka rencana wilayah itu', async ({ page }) => {
  let lepas = () => {};
  const ditahan = new Promise<void>((r) => (lepas = r));
  await page.route('**/_app/immutable/nodes/**', async (route) => {
    await ditahan;
    await route.continue();
  });
  try {
    await page.goto('/peristiwa/kelahiran');
    await page.getByLabel('Kabupaten/kota sesuai KTP Anda').selectOption('3312');
    await expect(page).not.toHaveURL(/kodeKabKota=/);
  } finally {
    lepas(); // selalu dilepas: permintaan tertahan tidak boleh menggantung penutupan konteks
  }
  await expect(page).toHaveURL(/kodeKabKota=3312/);
  await expect(page.getByLabel('Kabupaten/kota sesuai KTP Anda')).toHaveValue('3312');
  await expect(page.getByRole('button', { name: 'Mulai urusan ini' })).toBeVisible();
});
