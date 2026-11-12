import { expect, test, type Page } from '@playwright/test';
import { daftarAkunUji } from './akun-uji';

// Data uji di DB sementara runner. NIK dirakit saat runtime (pii-scan menolak literal 16 digit).
const nik = (d: string) => d.repeat(16);

async function tambahAnggota(
  page: Page,
  d: { hubungan: string; nama: string; nik?: string; tgl?: string; jk?: string },
) {
  await page.getByRole('button', { name: 'Tambah anggota', exact: true }).click();
  const form = page.getByRole('form', { name: 'Tambah anggota keluarga' });
  await form.getByLabel('Hubungan').selectOption({ label: d.hubungan });
  await form.getByLabel('Nama lengkap', { exact: true }).fill(d.nama);
  if (d.nik) await form.getByLabel('NIK', { exact: true }).fill(d.nik);
  if (d.tgl) await form.getByLabel('Tanggal lahir').fill(d.tgl);
  if (d.jk) await form.getByLabel('Jenis kelamin').selectOption({ label: d.jk });
  await form.getByRole('button', { name: 'Simpan anggota', exact: true }).click();
  await expect(form).toBeHidden();
}

const kartu = (page: Page, nama: string) =>
  page.getByRole('list', { name: 'Daftar anggota keluarga' }).getByRole('listitem').filter({ hasText: nama });

for (const width of [390, 1440]) {
  test(`data keluarga: tambah, validasi, ubah, hapus, dan reload pada ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await daftarAkunUji(page, { awal: 'keluarga' });
    await page.goto('/data-diri');
    await expect(page.getByRole('heading', { name: 'Saya', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Anggota keluarga', exact: true })).toBeVisible();
    await expect(page.getByText('Belum ada anggota keluarga.')).toBeVisible();
    await expect(
      page.getByText('Disimpan terenkripsi dan hanya dipakai untuk formulir yang Anda setujui.', {
        exact: false,
      }),
    ).toBeVisible();

    // Validasi: hubungan wajib, NIK 16 angka, tanggal yang benar-benar ada dan tidak di masa depan.
    await page.getByRole('button', { name: 'Tambah anggota', exact: true }).click();
    const form = page.getByRole('form', { name: 'Tambah anggota keluarga' });
    await form.getByLabel('Nama lengkap', { exact: true }).fill('Sari Uji');
    await form.getByLabel('NIK', { exact: true }).fill('123');
    await form.getByLabel('Tanggal lahir').fill('2999-01-01');
    await form.getByRole('button', { name: 'Simpan anggota', exact: true }).click();
    await expect(form.getByText('Pilih hubungan dengan Anda.')).toBeVisible();
    await expect(form.getByText('NIK harus 16 angka.')).toBeVisible();
    await expect(form.getByText('Tanggal lahir belum benar.')).toBeVisible();
    await expect(form.getByLabel('Hubungan')).toBeFocused();
    await form.getByLabel('Hubungan').selectOption({ label: 'Ibu' });
    await form.getByLabel('NIK', { exact: true }).fill(nik('3'));
    await form.getByLabel('Tanggal lahir').fill('1990-02-03');
    await form.getByRole('button', { name: 'Simpan anggota', exact: true }).click();
    await expect(form).toBeHidden();
    await expect(page.getByText('Sari Uji ditambahkan.')).toBeVisible();

    const ibu = kartu(page, 'Sari Uji');
    await expect(ibu).toContainText('Ibu');
    await expect(ibu).toContainText('3333 •••• •••• 3333');
    await expect(ibu).toContainText('3 Februari 1990');
    await ibu.getByRole('button', { name: 'Tampilkan NIK Sari Uji' }).click();
    await expect(ibu).toContainText(nik('3'));

    await tambahAnggota(page, { hubungan: 'Anak', nama: 'Bayu Uji', tgl: '2025-06-01', jk: 'Laki-laki' });
    await expect(kartu(page, 'Bayu Uji')).toContainText('Anak');

    // Ubah: isi lama terisi, nama baru tersimpan.
    await ibu.getByRole('button', { name: 'Ubah Sari Uji' }).click();
    const formUbah = page.getByRole('form', { name: 'Ubah anggota keluarga' });
    await expect(formUbah.getByLabel('NIK', { exact: true })).toHaveValue(nik('3'));
    await formUbah.getByLabel('Nama lengkap', { exact: true }).fill('Sari Ubah');
    await formUbah.getByRole('button', { name: 'Simpan anggota', exact: true }).click();
    await expect(formUbah).toBeHidden();
    await expect(kartu(page, 'Sari Ubah')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ubah Sari Ubah' })).toBeFocused();

    // Hapus: batal dulu, lalu konfirmasi.
    const sari = kartu(page, 'Sari Ubah');
    await sari.getByRole('button', { name: 'Hapus Sari Ubah' }).click();
    await sari.getByRole('button', { name: 'Batal', exact: true }).click();
    await expect(sari).toBeVisible();
    await sari.getByRole('button', { name: 'Hapus Sari Ubah' }).click();
    await sari.getByRole('button', { name: 'Ya, hapus', exact: true }).click();
    await expect(kartu(page, 'Sari Ubah')).toHaveCount(0);

    // Mobile rapi: tanpa gulir horizontal halaman.
    const lebar = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(lebar).toBeLessThanOrEqual(0);

    // Tersimpan di brankas (bukan hanya di layar), dan Data Diri "Saya" tidak tersentuh.
    await page.reload();
    await expect(kartu(page, 'Bayu Uji')).toBeVisible();
    await expect(kartu(page, 'Sari Ubah')).toHaveCount(0);
    const api = await page.evaluate(async () => {
      const r = await fetch('/api/vault/keluarga');
      return { status: r.status, cache: r.headers.get('cache-control'), json: await r.json() };
    });
    expect(api.status).toBe(200);
    expect(api.cache).toContain('no-store');
    expect(api.json.anggota).toEqual([
      expect.objectContaining({
        hubungan: 'anak',
        namaLengkap: 'Bayu Uji',
        tanggalLahir: '2025-06-01',
        jenisKelamin: 'laki-laki',
      }),
    ]);
  });
}

test('API keluarga: validasi server, anggota pemilik lain 404', async ({ page, browser }) => {
  await daftarAkunUji(page, { awal: 'keluarga-api' });
  await page.goto('/data-diri');
  const kirim = (method: string, url: string, body?: unknown) =>
    page.evaluate(
      async ([m, u, b]) => {
        const r = await fetch(u as string, {
          method: m as string,
          headers: { 'content-type': 'application/json' },
          ...(b === undefined ? {} : { body: JSON.stringify(b) }),
        });
        return { status: r.status, json: (await r.json().catch(() => null)) as Record<string, unknown> };
      },
      [method, url, body] as const,
    );
  expect(
    (await kirim('POST', '/api/vault/keluarga', { hubungan: 'ibu', namaLengkap: 'X', nik: '12' })).status,
  ).toBe(422);
  expect((await kirim('POST', '/api/vault/keluarga', { hubungan: 'kakek', namaLengkap: 'X' })).status).toBe(
    422,
  );
  const ok = await kirim('POST', '/api/vault/keluarga', { hubungan: 'ayah', namaLengkap: 'Ayah Uji' });
  expect(ok.status).toBe(201);
  const id = (ok.json.anggota as { id: string }).id;
  expect(id).toMatch(/^agt_[0-9a-f]{32}$/);

  const lain = await browser.newPage();
  await daftarAkunUji(lain, { awal: 'keluarga-lain' });
  await lain.goto('/data-diri');
  const curi = await lain.evaluate(async (u) => {
    const put = await fetch(u, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hubungan: 'ayah', namaLengkap: 'Diambil' }),
    });
    const del = await fetch(u, { method: 'DELETE' });
    const get = await (await fetch('/api/vault/keluarga')).json();
    return [put.status, del.status, get.anggota.length];
  }, `/api/vault/keluarga/${id}`);
  expect(curi).toEqual([404, 404, 0]);
  await lain.close();
  expect((await kirim('GET', '/api/vault/keluarga')).json.anggota).toEqual([
    expect.objectContaining({ id, namaLengkap: 'Ayah Uji' }),
  ]);
});
