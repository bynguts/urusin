import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';

// Layar Browser Pendamping di HP 390x844 (QA Padang, Kota Tangerang, Banjarmasin): kartu giliran di atas siaran bisa
// tergulir keluar layar, jadi bilah bawah yang lengket WAJIB memuat instruksi "Giliran Anda" DAN tombol aksi
// giliran itu di semua jenis giliran. Sesi yang hilang tanpa pesan akhir (worker restart) bukan jalan buntu.
// Layanan pendamping digantikan tiruan di batas jaringan peramban (pola pendamping-giliran.spec.ts).
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const WS_TIRUAN = 'ws://127.0.0.1:9/tiruan-pendamping/ws';

/** Viewer tiruan: pesan dikirim ke SEMUA soket yang sudah menyapa (viewer lama yang ditutup ikut keluar dari set). */
type Tiruan = { send(m: unknown): void; close(o: { code: number; reason: string }): Promise<void> };

async function bukaPendamping(page: Page): Promise<Tiruan> {
  let sesi: Record<string, unknown> | null = null;
  const soket = new Set<WebSocketRoute>();
  await page.route(/\/api\/urusan\/u_[0-9a-f]+\/pendamping(\/tiket)?$/, async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.fallback();
    if (req.url().endsWith('/tiket'))
      return route.fulfill({ json: { wsUrl: WS_TIRUAN, tiket: 'tiket-tiruan-e2e' } });
    const { executionId } = req.postDataJSON() as { executionId: string };
    const sekarang = Date.now();
    sesi = {
      sesiId: 'sesi-tiruan-e2e',
      urusanId: new URL(req.url()).pathname.split('/')[3],
      executionId,
      status: 'berjalan',
      mode: 'ai',
      antrean: null,
      dibuatPada: new Date(sekarang).toISOString(),
      kedaluwarsaPada: new Date(sekarang + 15 * 60_000).toISOString(),
    };
    return route.fulfill({ status: 201, json: sesi });
  });
  await page.routeWebSocket(WS_TIRUAN, (ws) => {
    ws.onClose(() => void soket.delete(ws));
    ws.onMessage((m) => {
      const msg = JSON.parse(String(m)) as { type: string };
      if (msg.type === 'halo') {
        soket.add(ws);
        ws.send(JSON.stringify({ type: 'status', sesi }));
        ws.send(JSON.stringify({ type: 'mode', mode: 'ai' }));
      }
    });
  });

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
  const setujuiRencana = page.getByRole('button', { name: 'Setujui rencana' });
  await expect(setujuiRencana).toBeEnabled({ timeout: 20_000 });
  await setujuiRencana.click();
  const buka = page.getByRole('button', { name: 'Setujui dan buka situs' });
  await expect(buka).toBeEnabled({ timeout: 20_000 });
  await buka.click();
  await expect(page.locator('[data-bilah-bawah]')).toBeVisible({ timeout: 20_000 });
  // Status POST sudah membuat layar 'ai'; tunggu viewer menyapa lewat WebSocket.
  await expect.poll(() => soket.size, { timeout: 20_000 }).toBeGreaterThan(0);
  return {
    send: (m) => {
      for (const w of soket) w.send(JSON.stringify(m));
    },
    close: async (o) => {
      for (const w of [...soket]) await w.close(o);
    },
  };
}

/** Gulir ke tengah siaran (warga sedang melihat situs): kartu giliran di atas sudah keluar layar. */
async function gulirKeSiaran(page: Page) {
  await page
    .getByRole('img', { name: 'Layar situs resmi dari Browser Pendamping' })
    .or(page.locator('canvas[aria-label="Layar situs resmi dari Browser Pendamping"]'))
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      window.scrollBy(0, r.top + r.height / 2 - window.innerHeight / 2);
    });
}

const GILIRAN: { alasan: string; tombol: RegExp; instruksi: RegExp; extra?: Record<string, unknown> }[] = [
  {
    alasan: 'masuk_akun',
    tombol: /^Sudah, lanjutkan$/,
    instruksi: /ketuk “Masuk” di situs/,
    extra: { kendali: 'Masuk' },
  },
  { alasan: 'login', tombol: /^Sudah, lanjutkan$/, instruksi: /masuk akun, kode, atau CAPTCHA/ },
  { alasan: 'periksa', tombol: /^Lanjutkan$/, instruksi: /periksa halaman/ },
  { alasan: 'isi_sendiri', tombol: /^Lanjutkan$/, instruksi: /isi kolom di situs/ },
  { alasan: 'berkas_kurang', tombol: /^Buka Dokumen$/, instruksi: /tambahkan dokumen/ },
  { alasan: 'berhenti', tombol: /^Saya sudah mengirim$/, instruksi: /lanjutkan sendiri/ },
  {
    alasan: 'final',
    tombol: /^Hentikan$/,
    instruksi: /periksa isian, lalu tekan “Kirim”/,
    extra: { tombol: 'Kirim' },
  },
  { alasan: 'verifikasi_situs', tombol: /^Hentikan$/, instruksi: /pemeriksaan keamanan/ },
];

test('HP 390: bilah giliran lengket berisi instruksi + tombol aksi untuk setiap jenis giliran', async ({
  page,
}) => {
  const ws = await bukaPendamping(page);
  const bilah = page.locator('[data-bilah-giliran]');
  for (const g of GILIRAN) {
    ws.send({ type: 'mode', mode: 'takeover', pesan: 'Giliran Anda.' });
    ws.send({
      type: 'event',
      event: { jenis: 'giliran_anda', alasan: g.alasan, pesan: 'Giliran Anda.', ...g.extra },
    });
    await expect(bilah.locator('[data-instruksi-giliran]'), g.alasan).toContainText(g.instruksi);
    await gulirKeSiaran(page);
    await expect(bilah, g.alasan).toBeInViewport();
    const tombol = bilah.getByRole(g.alasan === 'berkas_kurang' ? 'link' : 'button', { name: g.tombol });
    await expect(tombol, g.alasan).toBeInViewport();
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  // Ambil alih (dijeda): status ringkas + "Minta AI bantu mengisi" + "Saya sudah mengirim"; Batalkan di menu ⋯.
  ws.send({ type: 'event', event: { jenis: 'giliran_anda', alasan: 'diminta_warga', pesan: 'x' } });
  const bawah = page.locator('[data-bilah-bawah]');
  await expect(bawah).toContainText('Giliran Anda: isi formulir di layar ini.');
  await gulirKeSiaran(page);
  await expect(bawah.getByRole('button', { name: 'Minta AI bantu mengisi' })).toBeInViewport();
  await expect(bawah.getByRole('button', { name: 'Saya sudah mengirim' })).toBeInViewport();
  await expect(bawah.getByRole('button', { name: 'Batalkan' })).toBeHidden();
  await bawah.getByLabel('Pilihan lain').click();
  await expect(bawah.getByRole('button', { name: 'Batalkan' })).toBeVisible();
});

test('HP 390: koneksi ditutup tanpa pesan akhir = sesi berakhir dengan alasan + Buka lagi + Buka panduan', async ({
  page,
}) => {
  const ws = await bukaPendamping(page);
  // Worker restart: sesi tidak dikenal lagi (kode tanpa-ulang), tidak ada mode `done` dari server.
  await ws.close({ code: 4404, reason: 'sesi tidak ada' });
  await expect(page.getByText('Koneksi ke peramban pendamping terputus.')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Buka lagi situsnya' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Buka panduan' })).toBeVisible();
});
