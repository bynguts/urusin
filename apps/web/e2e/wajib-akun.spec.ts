import { expect, test } from '@playwright/test';
import { ORIGIN } from '../playwright.config';
import { emailUji, SANDI_UJI } from './akun-uji';

// Wajib akun: tanpa sesi, memulai atau membuka urusan mengarah ke /daftar (atau /masuk) lalu kembali ke tujuan
// semula setelah daftar. Halaman informatif tetap publik. IP klien sendiri per tes (batas laju per IP).
test.beforeEach(async ({ context }) => {
  const oktet = () => Math.floor(Math.random() * 250) + 1;
  await context.setExtraHTTPHeaders({
    'x-forwarded-proto': 'http',
    'x-forwarded-for': `10.${oktet()}.${oktet()}.${oktet()}`,
  });
});

test('tanpa sesi: "Mulai urusan ini" → /daftar → kembali ke rencana yang sama → urusan dimulai', async ({
  page,
}) => {
  await page.goto('/peristiwa/kelahiran?kodeKabKota=3312');
  await page.getByRole('button', { name: 'Mulai urusan ini' }).click();
  const tujuan = '/peristiwa/kelahiran?kodeKabKota=3312';
  await expect(page).toHaveURL(`/daftar?next=${encodeURIComponent(tujuan)}`);
  await expect(page.getByRole('link', { name: 'Coba tanpa daftar' })).toHaveCount(0);

  await page.getByLabel('Email').fill(emailUji('mulai'));
  await page.getByLabel(/Kata sandi/).fill(SANDI_UJI);
  await page.getByRole('button', { name: 'Daftar', exact: true }).click();
  await expect(page).toHaveURL(tujuan);

  await page.getByRole('button', { name: 'Mulai urusan ini' }).click();
  await expect(page).toHaveURL(/\/urusan\/u_[0-9a-f]{32}$/);
  const log = page.getByRole('log', { name: 'Percakapan urusan' });
  await expect(log.locator('[data-pelaku="ai"]').first()).toBeVisible({ timeout: 20_000 });
});

test('tanpa sesi: kartu "Mulai urus" di landing dan tombol "Mulai urusan" mengarah ke /daftar', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('form[action="/?/mulai"]').first().getByRole('button').click();
  await expect(page).toHaveURL(`/daftar?next=${encodeURIComponent('/peristiwa/kelahiran')}`);
  await page.goto('/');
  await page.getByRole('link', { name: 'Mulai urusan' }).first().click();
  await expect(page).toHaveURL(/\/daftar$/);
});

test('tanpa sesi: API urusan → 401, halaman urusan dan aplikasi → /masuk?next=…; halaman informatif publik', async ({
  page,
}) => {
  const r = await page.request.post('/api/urusan', { headers: { origin: ORIGIN }, data: {} });
  expect(r.status()).toBe(401);
  expect(await r.json()).toMatchObject({ kode: 'BELUM_MASUK' });
  const turn = await page.request.post(`/api/urusan/u_${'0'.repeat(32)}/turn`, {
    headers: { origin: ORIGIN },
    data: { teks: 'halo' },
  });
  expect(turn.status()).toBe(401);
  expect((await page.request.get('/api/vault')).status()).toBe(401);

  const urusan = `/urusan/u_${'0'.repeat(32)}`;
  await page.goto(urusan);
  await expect(page).toHaveURL(`/masuk?next=${encodeURIComponent(urusan)}`);
  await expect(page.getByRole('link', { name: 'Coba tanpa daftar' })).toHaveCount(0);
  for (const path of ['/urusanku', '/pengaturan', '/data-diri', '/dokumen']) {
    await page.goto(path);
    await expect(page).toHaveURL(`/masuk?next=${encodeURIComponent(path)}`);
  }
  await page.goto('/beranda');
  await expect(page).toHaveURL(/\/masuk\?lanjut=%2Fberanda$/);

  for (const path of ['/', '/urusan', '/peristiwa/kelahiran', '/tanya-jawab', '/privasi', '/bantuan']) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    await expect(page).toHaveURL(path);
  }
});

test('/daftar: "Syarat layanan" dan "Kebijakan privasi" adalah tautan tebal bergaris bawah', async ({
  page,
}) => {
  await page.goto('/daftar');
  const persetujuan = page.getByText('Dengan mendaftar, Anda setuju dengan');
  for (const [nama, href] of [
    ['Syarat layanan', '/syarat'],
    ['Kebijakan privasi', '/privasi'],
  ]) {
    const a = persetujuan.getByRole('link', { name: nama });
    await expect(a).toHaveAttribute('href', href);
    await expect(a).toHaveCSS('text-decoration-line', 'underline');
    await expect(a).toHaveCSS('font-weight', '600');
  }
});
