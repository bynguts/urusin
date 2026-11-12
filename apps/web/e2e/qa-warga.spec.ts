import { expect, test, type Page } from '@playwright/test';
import { daftarAkunUji } from './akun-uji';

// Temuan QA warga (360–1366 px): panel Rencana, kartu persetujuan Browser Pendamping, tab Sumber, tombol
// Lanjutkan, landmark + urutan heading, dan status kartu Beranda. Server memakai DemoProvider; tidak ada yang
// dibuka atau dikirim ke situs pemerintah.
test.beforeEach(async ({ context }) => {
  const oktet = () => Math.floor(Math.random() * 250) + 1;
  await context.setExtraHTTPHeaders({
    'x-forwarded-proto': 'http',
    'x-forwarded-for': `10.${oktet()}.${oktet()}.${oktet()}`,
  });
});

/** Pelanggaran urutan heading (axe `heading-order`): level naik lebih dari satu dari heading sebelumnya. */
function headingLoncat(page: Page) {
  return page.evaluate(() => {
    const hs = [...document.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')].filter(
      (h) => h.getClientRects().length > 0,
    );
    const salah: string[] = [];
    let sebelum = 0;
    for (const h of hs) {
      const n = Number(h.tagName[1]);
      if (sebelum && n > sebelum + 1) salah.push(`${h.tagName}: ${h.textContent?.trim().slice(0, 40)}`);
      sebelum = n;
    }
    return salah;
  });
}

/** Elemen terlihat yang tidak berada di landmark mana pun (axe `region`), kecuali tautan lewati. */
function diLuarLandmark(page: Page) {
  return page.evaluate(() => {
    const landmark =
      'header,nav,main,aside,footer,[role="banner"],[role="navigation"],[role="main"],[role="region"],[role="complementary"],[role="contentinfo"],section[aria-label],section[aria-labelledby]';
    return [...document.querySelectorAll<HTMLElement>('body a, body button, body img, body h1, body p')]
      .filter(
        (el) =>
          el.getClientRects().length > 0 && !el.closest(landmark) && el.getAttribute('href') !== '#konten',
      )
      .map((el) => el.outerHTML.slice(0, 80));
  });
}

async function mulaiWonogiri(page: Page) {
  await page.goto('/peristiwa/kelahiran');
  const kota = page.getByRole('combobox', { name: 'Kabupaten/kota sesuai KTP Anda' });
  await expect(kota).toHaveAttribute('aria-autocomplete', 'list');
  await kota.fill('Wonogiri');
  await page.getByRole('option', { name: 'Kabupaten Wonogiri', exact: true }).click();
  await expect(page).toHaveURL(/kodeKabKota=3312/);
  await page.getByRole('button', { name: 'Mulai urusan ini' }).click();
  await expect(page).toHaveURL(/\/urusan\/u_[0-9a-f]{32}$/);
  const benar = page.getByRole('button', { name: 'Ya, betul' });
  await expect(benar).toBeEnabled({ timeout: 20_000 });
  await benar.click();
  const setujui = page.getByRole('button', { name: 'Setujui rencana' });
  await expect(setujui).toBeEnabled({ timeout: 20_000 });
  return setujui;
}

test('360 px: kartu persetujuan tergulir ke tampilan, tidak tertutup komposer, judul tidak terjepit', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await daftarAkunUji(page);
  const setujui = await mulaiWonogiri(page);
  await setujui.click();
  const buka = page.getByRole('button', { name: 'Setujui dan buka situs' });
  await expect(buka).toBeEnabled({ timeout: 20_000 });
  await expect.soft(buka).toBeInViewport({ ratio: 1 });
  // Titik tengah tombol benar-benar tombol itu (bukan komposer lengket di atasnya).
  const kena = await buka.evaluate((b) => {
    const r = b.getBoundingClientRect();
    return b.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  });
  expect.soft(kena).toBe(true);
  // Chip "Situs resmi" turun baris: judul kartu memakai hampir seluruh lebar kartu, bukan 1–2 kata per baris.
  const kartu = page.getByRole('region', { name: 'Periksa sebelum AI mengisi' });
  const judul = await kartu.getByRole('heading').boundingBox();
  expect.soft(judul!.width).toBeGreaterThan(150);

  // Panel HP terlipat: heading percakapan langsung di bawah h1 halaman.
  expect.soft(await headingLoncat(page)).toEqual([]);

  // Panel: rencana Wonogiri dibantu Pendamping -> lima langkah; Sumber = kutipan + sumber rencana.
  await page.getByRole('button', { name: 'Rencana, dokumen, dan sumber' }).click();
  const panel = page.locator('#panel-konteks');
  await expect(panel).toContainText('Langkah 2 dari 5');
  const jumlah = Number(
    await page
      .locator('#panel-tab-sumber')
      .innerText()
      .then((t) => t.replace(/\D/g, '')),
  );
  expect.soft(jumlah).toBeGreaterThan(0);
  await page.locator('#panel-tab-sumber').click();
  await expect.soft(panel.locator('#panel-panel-sumber article')).toHaveCount(jumlah);

  expect.soft(await diLuarLandmark(page)).toEqual([]);
  await page.goto('/urusanku');
  await expect(page.getByRole('heading', { name: 'Akta kelahiran' }).first()).toBeVisible();
  expect.soft(await headingLoncat(page)).toEqual([]);
});

test('tombol Lanjutkan mengirim aksi tanpa gelembung "lanjut" dari warga', async ({ page }) => {
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
        sse(2, { type: 'done', turnId: 't1', status: 'selesai', lanjutkan: true, degraded: true }),
    }),
  );
  const turn: string[] = [];
  await page.route(`**/api/urusan/${id}/turn`, (route) => {
    turn.push(route.request().postData() ?? '');
    return route.fulfill({ status: 202, json: { turnId: 't2' } });
  });
  await page.goto(`/urusan/${id}`);
  const komposer = page.getByLabel('Tulis jawaban atau pertanyaan');
  await komposer.fill('draf saya');
  await page.getByRole('button', { name: 'Lanjutkan' }).click();
  await expect.poll(() => turn.length).toBe(1);
  expect(turn[0]).toContain('lanjut');
  const log = page.getByRole('log', { name: 'Percakapan urusan' });
  await expect(log.locator('p', { hasText: /^\s*lanjut\s*$/ })).toHaveCount(0);
  await expect(komposer).toHaveValue('draf saya');
  const tersimpan = await page.evaluate(() => JSON.stringify(localStorage));
  expect(tersimpan).not.toMatch(/"teks":"lanjut"/);
});

test('Beranda: kartu urusan lama tidak tertahan di "Memuat status…"', async ({ page }) => {
  await page.goto('/masuk');
  await page.waitForLoadState('networkidle');
  await page.locator('form[data-juri] input[name="turnstile"]').evaluate((el: HTMLInputElement) => {
    el.value = 'XXXX.DUMMY.TOKEN.XXXX';
  });
  await page.getByRole('button', { name: 'Masuk sebagai juri' }).click();
  await expect(page).toHaveURL(/\/beranda$/);
  await mulaiWonogiri(page);
  // Pindah lewat navigasi aplikasi (tanpa muat ulang), lalu muat ulang penuh.
  await page.getByRole('link', { name: 'Beranda' }).first().click();
  await expect(page).toHaveURL(/\/beranda$/);
  const kartu = page.getByRole('article').filter({ hasText: 'Akta kelahiran' });
  await expect(kartu).toContainText('Tinjau rencana', { timeout: 10_000 });
  await expect(kartu).not.toContainText('Memuat status');
  await page.reload();
  await expect(kartu).toContainText('Menunggu Anda', { timeout: 10_000 });
  await expect(kartu).not.toContainText('Memuat status');
});
