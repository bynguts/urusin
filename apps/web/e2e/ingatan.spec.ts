import { expect, test } from '@playwright/test';

// Ingatan warga (ADR 0031) dengan DemoProvider: urusan 1 → agen mencatat preferensi + wilayah KTP → urusan 2 tidak
// menanyakan ulang dari nol (tetap konfirmasi "betul?") → Pengaturan: hapus ingatan → hilang.
test.beforeEach(async ({ context }) => {
  const oktet = () => Math.floor(Math.random() * 250) + 1;
  await context.setExtraHTTPHeaders({
    'x-forwarded-proto': 'http',
    'x-forwarded-for': `10.${oktet()}.${oktet()}.${oktet()}`,
  });
});

test('urusan kedua memakai ingatan sebagai usulan, lalu ingatan dihapus di Pengaturan', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  const log = page.getByRole('log', { name: 'Percakapan urusan' });

  // Urusan 1: kelahiran; agen menanyakan wilayah KTP dari nol (belum ada ingatan).
  await page.goto('/peristiwa/kelahiran');
  await page.getByRole('button', { name: 'Mulai urusan ini' }).click();
  await expect(page).toHaveURL(/\/urusan\/u_[0-9a-f]{32}$/);
  await expect(log).toContainText('KTP Anda terdaftar di kabupaten/kota mana?', { timeout: 20_000 });

  const komposer = page.getByLabel('Tulis jawaban atau pertanyaan');
  await komposer.fill('Saya sudah lansia. KTP saya Kabupaten Wonogiri.');
  await page.getByRole('button', { name: 'Kirim' }).click();
  await expect(log).toContainText('Urusin mengingat: Warga lansia', { timeout: 20_000 });
  await expect(log).toContainText('Urusin mengingat: Wilayah KTP: Kabupaten Wonogiri');

  // Warga membatalkan satu ingatan langsung dari kartu chat.
  await log.getByRole('button', { name: 'Batalkan ingatan Warga lansia' }).click();
  await expect(log).toContainText('Dibatalkan, Urusin tidak mengingat: Warga lansia');

  // Urusan 2: wilayah dari ingatan hanya usulan; agen mengonfirmasi, tidak bertanya "di mana" dari nol.
  await page.goto('/peristiwa/perkawinan');
  await page.getByRole('button', { name: 'Mulai urusan ini' }).click();
  await expect(page).toHaveURL(/\/urusan\/u_[0-9a-f]{32}$/);
  await expect(page.getByRole('region', { name: 'Konfirmasi wilayah KTP' })).toContainText(
    'yang Urusin ingat dari urusan Anda sebelumnya',
    { timeout: 20_000 },
  );
  await expect(log).toContainText('KTP Anda terdaftar di Kabupaten Wonogiri, betul?', { timeout: 20_000 });
  await expect(log).not.toContainText('KTP Anda terdaftar di kabupaten/kota mana?');

  // Pengaturan: daftar ingatan, lalu hapus semua (hak hapus UU PDP).
  await page.goto('/pengaturan#ingatan');
  const bagian = page.getByRole('region', { name: 'Yang Urusin ingat' });
  const daftar = bagian.getByRole('list', { name: 'Butir yang diingat' });
  await expect(daftar).toContainText('Wilayah KTP: Kabupaten Wonogiri');
  await expect(daftar).not.toContainText('Warga lansia');
  await bagian.getByRole('button', { name: 'Hapus semua ingatan' }).click();
  await expect(page).toHaveURL(/\/pengaturan#ingatan$/);
  await expect(bagian).toContainText('Belum ada yang diingat.');
  await expect(bagian.getByRole('list', { name: 'Butir yang diingat' })).toHaveCount(0);
});
