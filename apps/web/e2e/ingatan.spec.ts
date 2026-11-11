import { expect, test } from '@playwright/test';

// Ingatan warga (ADR 0031) dengan DemoProvider: urusan 1 → agen mencatat preferensi + wilayah KTP → urusan 2 tidak
// menanyakan ulang dari nol (kartu usulan, warga memastikan) → Pengaturan: hapus ingatan → hilang.
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
  await komposer.fill('Saya sudah lansia dan tuli. KTP saya Kabupaten Wonogiri.');
  await page.getByRole('button', { name: 'Kirim' }).click();
  await expect(log).toContainText('Urusin mengingat: Warga lansia', { timeout: 20_000 });
  await expect(log).toContainText('Urusin mengingat: Wilayah KTP: Kabupaten Wonogiri');

  // Kebutuhan aksesibilitas (data sensitif) hanya diingat setelah warga menyetujui di kartu.
  await expect(log).toContainText('Ingat bahwa Anda tuli?');
  await log.getByRole('button', { name: 'Ya, ingat' }).click();
  await expect(log).toContainText('Urusin mengingat: Kebutuhan aksesibilitas: tuli');

  // Warga membatalkan satu ingatan langsung dari kartu chat.
  await log.getByRole('button', { name: 'Batalkan ingatan Warga lansia' }).click();
  await expect(log).toContainText('Dibatalkan, Urusin tidak mengingat: Warga lansia');

  // Urusan 2: wilayah dari ingatan hanya usulan di kartu (tanpa teks pertanyaan ganda); warga yang memastikan.
  await page.goto('/peristiwa/perkawinan');
  await page.getByRole('button', { name: 'Mulai urusan ini' }).click();
  await expect(page).toHaveURL(/\/urusan\/u_[0-9a-f]{32}$/);
  const konfirmasi = page.getByRole('region', { name: 'Konfirmasi wilayah KTP' });
  await expect(konfirmasi).toContainText('yang Urusin ingat dari urusan Anda sebelumnya', {
    timeout: 20_000,
  });
  await expect(konfirmasi).toContainText('KTP Anda terdaftar di Kabupaten Wonogiri?');
  await expect(log).not.toContainText('KTP Anda terdaftar di Kabupaten Wonogiri, betul?');
  await expect(log).not.toContainText('KTP Anda terdaftar di kabupaten/kota mana?');
  await expect(page.getByRole('button', { name: 'Setujui rencana', exact: true })).toHaveCount(0);
  await konfirmasi.getByRole('button', { name: 'Ya, betul', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Setujui rencana', exact: true })).toBeEnabled({
    timeout: 20_000,
  });

  // Pengaturan: daftar ingatan, lalu hapus semua (hak hapus UU PDP).
  await page.goto('/pengaturan#ingatan');
  const bagian = page.getByRole('region', { name: 'Yang Urusin ingat' });
  const daftar = bagian.getByRole('list', { name: 'Butir yang diingat' });
  await expect(daftar).toContainText('Wilayah KTP: Kabupaten Wonogiri');
  await expect(daftar).toContainText('Kebutuhan aksesibilitas: tuli');
  await expect(daftar).not.toContainText('Warga lansia');
  await bagian.getByRole('button', { name: 'Hapus semua ingatan' }).click();
  await expect(page).toHaveURL(/\/pengaturan#ingatan$/);
  await expect(bagian).toContainText('Belum ada yang diingat.');
  await expect(bagian.getByRole('list', { name: 'Butir yang diingat' })).toHaveCount(0);
});
