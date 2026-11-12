import { expect, test } from '@playwright/test';
import { daftarAkunUji } from './akun-uji';

// ADR 0033: daerah di luar 10 daerah Browser Pendamping aktif tetap dipandu lengkap dengan kartu positif
// "sedang dikembangkan", kanal resmi daerah yang bisa diklik, dan tanpa jalan buntu. Server memakai DemoProvider.
test.beforeEach(async ({ context }) => {
  const oktet = () => Math.floor(Math.random() * 250) + 1;
  await context.setExtraHTTPHeaders({
    'x-forwarded-proto': 'http',
    'x-forwarded-for': `10.${oktet()}.${oktet()}.${oktet()}`,
  });
});

test('Kota Jayapura: kartu dipandu "sedang dikembangkan", kanal resmi bisa diklik, tanpa Browser Pendamping', async ({
  page,
}) => {
  await daftarAkunUji(page);
  await page.goto('/peristiwa/kelahiran');
  const kota = page.getByRole('combobox', { name: 'Kabupaten/kota sesuai KTP Anda' });
  // Kotak cari baru tampil setelah hidrasi (sebelumnya select tanpa JavaScript).
  await expect(kota).toHaveAttribute('aria-autocomplete', 'list');
  await kota.fill('Jayapura');
  await page.getByRole('option', { name: 'Kota Jayapura', exact: true }).click();
  await expect(page).toHaveURL(/kodeKabKota=9171/);
  await page.getByRole('button', { name: 'Mulai urusan ini' }).click();
  await expect(page).toHaveURL(/\/urusan\/u_[0-9a-f]{32}$/);
  const benar = page.getByRole('button', { name: 'Ya, betul' });
  await expect(benar).toBeEnabled({ timeout: 20_000 });
  await benar.click();

  const setujui = page.getByRole('button', { name: 'Setujui rencana' });
  await expect(setujui).toBeEnabled({ timeout: 20_000 });
  const kartu = page.getByTestId('kartu-dipandu').last();
  await expect(kartu).toContainText('Untuk Kota Jayapura, Urusin memandu Anda langkah demi langkah.');
  await expect(kartu).toContainText('untuk Kota Jayapura sedang kami kembangkan');
  await expect(kartu).toContainText('Surabaya, Wonogiri, Semarang');
  await expect(kartu).toContainText('Gratis.');
  const portal = kartu.getByRole('link', { name: /Layanan online Disdukcapil Kota Jayapura/ });
  await expect(portal).toHaveAttribute('href', 'https://dukcapil.jayapurakota.go.id/pacemace');
  await expect(portal).toHaveAttribute('target', '_blank');

  await setujui.click();
  await expect(
    page
      .getByText(
        /Browser Pendamping \(AI ikut mengisi formulir di situs resmi\) untuk Kota Jayapura sedang kami kembangkan/,
      )
      .last(),
  ).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole('button', { name: 'Setujui dan buka situs' })).toHaveCount(0);
  await expect(page.getByText(/belum bisa dibantu/)).toHaveCount(0);
});

test('halaman cara kerja menyebut cakupan Browser Pendamping dengan jujur', async ({ page }) => {
  await page.goto('/cara-kerja');
  const cakupan = page.getByTestId('cakupan-pendamping');
  await expect(cakupan).toContainText(
    'Saat ini aktif di Surabaya, Wonogiri, Semarang, Medan, Malang, Depok, Kota Tangerang, Padang, Bandar Lampung, dan Banjarmasin.',
  );
  await expect(cakupan).toContainText('sedang kami kembangkan');
});
