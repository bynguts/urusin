import { expect, test, type Page } from '@playwright/test';
import { daftarAkunUji } from './akun-uji';

// UX chat urusan: Enter/Shift+Enter di komposer, URL di pesan AI jadi tautan biru yang membuka tab baru, dan
// lampiran (klip + tempel gambar) yang masuk brankas terenkripsi tanpa isi/nama berkas ikut ke body /turn.
// Stream urusan dan /turn diganti tiruan di batas jaringan peramban (pola qa-warga.spec.ts); brankas asli.

const URL_AI = 'https://contoh.go.id/layanan/akta?langkah=1';

/** Urusan baru milik akun ini, dengan stream tiruan (satu pesan AI berisi URL) dan /turn yang dicatat. */
async function urusanTiruan(page: Page): Promise<{ id: string; turn: string[] }> {
  await daftarAkunUji(page);
  await page.goto('/peristiwa/kelahiran');
  const { status, id } = await page.evaluate(async () => {
    const r = await fetch('/api/urusan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ peristiwa: 'kelahiran' }),
    });
    return { status: r.status, id: ((await r.json()) as { id: string }).id };
  });
  expect(status).toBe(201);
  const at = new Date().toISOString();
  const sse = (seq: number, e: Record<string, unknown>) =>
    `id: ${seq}\nevent: ${e.type}\ndata: ${JSON.stringify({ seq, at, chainHead: 'h', ...e })}\n\n`;
  await page.route(`**/api/urusan/${id}/stream*`, (route) =>
    route.fulfill({
      headers: { 'content-type': 'text/event-stream' },
      body:
        sse(1, { type: 'state', state: 'MEMAHAMI', version: 1 }) +
        sse(2, { type: 'assistant_text', delta: `Daftar lewat ${URL_AI}. Bawa KTP asli.` }) +
        sse(3, { type: 'done', turnId: 't1', status: 'selesai' }),
    }),
  );
  const turn: string[] = [];
  await page.route(`**/api/urusan/${id}/turn`, (route) => {
    turn.push(route.request().postData() ?? '');
    return route.fulfill({ status: 202, json: { turnId: `t${turn.length + 1}`, diterima: true } });
  });
  await page.goto(`/urusan/${id}`);
  await expect(page.getByRole('log', { name: 'Percakapan urusan' })).toContainText('Bawa KTP asli.');
  return { id, turn };
}

const teksTurn = (body: string | undefined) => (JSON.parse(body ?? '{}') as { teks?: string }).teks;

test('Enter mengirim, Shift+Enter menambah baris', async ({ page }) => {
  const { turn } = await urusanTiruan(page);
  const komposer = page.getByLabel('Tulis jawaban atau pertanyaan');
  await komposer.click();
  await komposer.pressSequentially('baris satu');
  await komposer.press('Shift+Enter');
  await komposer.pressSequentially('baris dua');
  await expect(komposer).toHaveValue('baris satu\nbaris dua');
  expect(turn).toHaveLength(0);
  await komposer.press('Enter');
  await expect.poll(() => turn.length).toBe(1);
  expect(teksTurn(turn[0])).toBe('baris satu\nbaris dua');
  await expect(komposer).toHaveValue('');
  const log = page.getByRole('log', { name: 'Percakapan urusan' });
  await expect(log.locator('[data-pelaku="warga"]').last()).toContainText('baris dua');
});

test('Beranda: Enter mengirim, Shift+Enter menambah baris (sama dengan komposer urusan)', async ({
  page,
}) => {
  await daftarAkunUji(page);
  await page.goto('/beranda');
  const kirim: string[] = [];
  await page.route(/\/beranda\?\/mulai/, (route) => {
    kirim.push(route.request().postData() ?? '');
    return route.abort();
  });
  const kotak = page.getByLabel('Ceritakan urusan Anda');
  await kotak.click();
  await kotak.pressSequentially('anak saya lahir');
  await kotak.press('Shift+Enter');
  await kotak.pressSequentially('di Wonogiri');
  await expect(kotak).toHaveValue('anak saya lahir\ndi Wonogiri');
  expect(kirim).toHaveLength(0);
  await kotak.press('Enter');
  await expect.poll(() => kirim.length).toBe(1);
  expect(new URLSearchParams(kirim[0]).get('pesan')).toBe('anak saya lahir\ndi Wonogiri');
});

test('URL di pesan AI jadi tautan biru yang bisa diklik dan membuka tab baru', async ({ page, context }) => {
  await context.route('https://contoh.go.id/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>Situs tiruan</title>ok' }),
  );
  await urusanTiruan(page);
  const log = page.getByRole('log', { name: 'Percakapan urusan' });
  const tautan = log.locator('[data-pelaku="ai"]').getByRole('link', { name: /contoh\.go\.id\/layanan/ });
  await expect(tautan).toBeVisible();
  await expect(tautan).toHaveAttribute('href', URL_AI);
  await expect(tautan).toHaveAttribute('target', '_blank');
  await expect(tautan).toHaveAttribute('rel', 'noopener noreferrer nofollow');
  // Titik akhir kalimat bukan bagian tautan.
  await expect(tautan).toHaveText(/akta\?langkah=1\s\(buka di tab baru\)$/);
  const gaya = await tautan.evaluate((a) => {
    const s = getComputedStyle(a);
    return { warna: s.color, garis: s.textDecorationLine };
  });
  expect(gaya).toEqual({ warna: 'rgb(24, 88, 192)', garis: 'underline' });
  const [tab] = await Promise.all([context.waitForEvent('page'), tautan.click()]);
  await expect(tab).toHaveURL(URL_AI);
  await tab.close();

  // Tema gelap: biru terang dari token yang sama (kontras AA di latar gelap).
  await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
  expect(await tautan.evaluate((a) => getComputedStyle(a).color)).toBe('rgb(138, 180, 248)');
});

test('lampiran lewat klip dan tempel gambar: chip, tersimpan di Dokumen, isi tidak ikut /turn', async ({
  page,
}) => {
  const { turn } = await urusanTiruan(page);
  const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 24, height: 24 } });
  // Nama berkas memuat angka mirip NIK (dirakit saat runtime): tidak boleh sampai ke body /turn.
  const angka = '3' + '1'.repeat(15);
  const unggahan: number[] = [];
  page.on('response', (r) => {
    if (r.url().endsWith('/api/vault') && r.request().method() === 'POST') unggahan.push(r.status());
  });

  await page.locator('form input[type="file"]').setInputFiles({
    name: `KK ${angka}.png`,
    mimeType: 'image/png',
    buffer: png,
  });
  const chip = page.locator('[data-lampiran]');
  await expect(chip).toHaveCount(1);
  await expect(chip.first().getByRole('combobox')).toHaveValue('kk');
  await expect(chip.first().locator('img')).toHaveAttribute('src', /^blob:/);

  // Tempel tangkapan layar (Ctrl+V) ke kotak tulis.
  const komposer = page.getByLabel('Tulis jawaban atau pertanyaan');
  await komposer.evaluate((el, b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, png.toString('base64'));
  await expect(chip).toHaveCount(2);
  await expect(chip.nth(1).getByRole('combobox')).toHaveValue('lainnya');

  // Hapus lalu tempel lagi: tombol hapus bekerja.
  await page.getByRole('button', { name: 'Hapus lampiran Dokumen lain' }).click();
  await expect(chip).toHaveCount(1);
  await komposer.evaluate((el, b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, png.toString('base64'));
  await expect(chip).toHaveCount(2);

  await komposer.fill('ini dokumen saya');
  await komposer.press('Enter');
  await expect.poll(() => turn.length).toBe(1);
  expect(unggahan).toEqual([201, 201]);
  expect(teksTurn(turn[0])).toBe(
    '[warga melampirkan dokumen: Kartu Keluarga (gambar)]\n' +
      '[warga melampirkan dokumen: Dokumen lain (gambar)]\nini dokumen saya',
  );
  const body = turn[0]!;
  expect(body).not.toContain(angka);
  expect(body).not.toContain('.png');
  expect(body).not.toContain(png.toString('base64').slice(0, 24));
  expect(body).not.toContain('data:image');
  expect(body.length).toBeLessThan(400);

  // Gelembung warga: chip lampiran + tulisan; komposer bersih.
  await expect(chip).toHaveCount(0);
  const gelembung = page.locator('[data-pelaku="warga"]').last();
  await expect(gelembung.getByRole('link', { name: /Kartu Keluarga \(gambar\)/ })).toHaveAttribute(
    'href',
    '/dokumen',
  );
  await expect(gelembung).toContainText('Dokumen lain (gambar)');
  await expect(gelembung).toContainText('ini dokumen saya');
  await expect(gelembung).not.toContainText('[warga melampirkan');

  // Tersimpan di brankas (tab Dokumen), terhubung ke urusannya lewat judul.
  await page.goto('/dokumen');
  await expect(
    page.getByRole('link', { name: 'Kartu Keluarga (lampiran urusan: Akta kelahiran)' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Dokumen lain (lampiran urusan: Akta kelahiran)' }),
  ).toBeVisible();
});

test.describe('layar sentuh', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('Enter menambah baris, kirim lewat tombol', async ({ page }) => {
    const { turn } = await urusanTiruan(page);
    const komposer = page.getByLabel('Tulis jawaban atau pertanyaan');
    await komposer.click();
    await komposer.pressSequentially('satu');
    await komposer.press('Enter');
    await komposer.pressSequentially('dua');
    await expect(komposer).toHaveValue('satu\ndua');
    expect(turn).toHaveLength(0);
    await page.getByRole('button', { name: 'Kirim' }).click();
    await expect.poll(() => turn.length).toBe(1);
    expect(teksTurn(turn[0])).toBe('satu\ndua');
  });
});
