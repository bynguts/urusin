import { expect, test } from '@playwright/test';
import { daftarAkunUji } from './akun-uji';

// Judul urusan oleh AI: setelah turn pertama warga, server meminta judul ke provider (di e2e: FakeProvider demo,
// deterministik dari pesan yang sudah disaring) lalu sidebar "Urusan aktif" dan header menampilkannya. Nama
// pilihan warga (Ganti nama) menang dan tidak ditimpa turn berikutnya.
test('judul AI tampil di sidebar setelah turn pertama; ganti nama manual bertahan', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await daftarAkunUji(page);
  await page.goto('/peristiwa/kelahiran');
  const id = await page.evaluate(async () => {
    const r = await fetch('/api/urusan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ peristiwa: 'kelahiran' }),
    });
    return ((await r.json()) as { id: string }).id;
  });
  await page.goto(`/urusan/${id}`);
  const komposer = page.getByLabel('Tulis jawaban atau pertanyaan');
  await komposer.fill('Mau urus akta lahir anak kedua');
  await komposer.press('Enter');

  const sidebar = page.locator(`[data-urusan-aktif="${id}"]`);
  const JUDUL_AI = 'Urus akta lahir anak kedua';
  await expect(sidebar.getByRole('link')).toHaveText(JUDUL_AI, { timeout: 30_000 });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(JUDUL_AI);
  // Tersimpan di server: halaman baru langsung memakai judul ini.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(JUDUL_AI);

  // Klik kanan pada urusan di sidebar membuka menu yang sama dengan tombol titik tiga.
  await sidebar.getByRole('link').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Ganti nama' }).click();
  const dialog = page.getByRole('dialog', { name: 'Ganti nama urusan' });
  await expect(dialog.getByLabel('Nama urusan')).toHaveValue(JUDUL_AI);
  // NIK di nama ditolak server (pesan PII), nama tidak berubah. Angka dirakit saat runtime.
  await dialog.getByLabel('Nama urusan').fill(`Akta ${['3312', '0101', '0101', '0001'].join('')}`);
  await dialog.getByRole('button', { name: 'Simpan' }).click();
  await expect(dialog.locator('[id$="-nama-galat"]')).toBeVisible();
  await dialog.getByLabel('Nama urusan').fill('Akta si bungsu');
  await dialog.getByRole('button', { name: 'Simpan' }).click();
  await expect(dialog).toBeHidden();
  await expect(sidebar.getByRole('link')).toHaveText('Akta si bungsu');

  // Turn berikutnya tidak menimpa nama warga.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Akta si bungsu');
  await komposer.fill('Apa saja dokumen yang perlu saya bawa?');
  await komposer.press('Enter');
  await expect(page.locator('[data-pelaku="ai"]').last()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  const r = await page.evaluate(
    async (u) => (await (await fetch(`/api/urusan?ids=${u}`)).json()) as { urusan: { judul?: string }[] },
    id,
  );
  expect(r.urusan[0]?.judul).toBe('Akta si bungsu');

  // Urusanku: judul server + menu titik tiga "Ganti nama".
  await page.goto('/urusanku');
  await expect(page.getByRole('heading', { name: 'Akta si bungsu' })).toBeVisible();
  await page.getByRole('button', { name: 'Opsi urusan Akta si bungsu' }).first().click();
  await page.getByRole('menuitem', { name: 'Ganti nama' }).click();
  await dialog.getByLabel('Nama urusan').fill('Akta adik');
  await dialog.getByRole('button', { name: 'Simpan' }).click();
  await expect(page.getByRole('heading', { name: 'Akta adik' })).toBeVisible();
  await expect(sidebar.getByRole('link')).toHaveText('Akta adik');
});
