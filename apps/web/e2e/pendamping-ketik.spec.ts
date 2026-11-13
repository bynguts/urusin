import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import { daftarAkunUji } from './akun-uji';

// Jalur ketik warga saat giliran (masuk akun / CAPTCHA / sandi di situs resmi): klik/ketuk siaran lalu ketik
// harus sampai ke worker sebagai pesan input WebSocket. Worker yang menerima pesan yang sama lalu mengetiknya
// ke halaman diuji nyata di apps/pendamping/e2e/pendamping.spec.ts ("alur penuh": login replika lolos dengan
// CAPTCHA yang diketik lewat penampil). Di sini layanan pendamping digantikan tiruan di batas jaringan peramban
// (pola pendamping-bilah-hp.spec.ts) supaya yang diuji adalah layar produksi (LayarPendamping + viewer).
const WS_TIRUAN = 'ws://127.0.0.1:9/tiruan-pendamping/ws';
/** Penjaga input tersembunyi (zero-width space), sama dengan PENJAGA_INPUT di @urusin/pendamping-client. */
const PENJAGA = '​';
const META = { lebar: 1280, tinggi: 800, skala: 1, offsetAtas: 0, scrollX: 0, scrollY: 0 };

type Masuk = { type: string; teks?: string; aksi?: string; key?: string; x?: number; y?: number };

async function giliranMasuk(page: Page): Promise<{ masuk: Masuk[]; kirim(m: unknown): void }> {
  const jpeg = (await page.screenshot({ type: 'jpeg', quality: 30 })).toString('base64');
  const masuk: Masuk[] = [];
  const soket = new Set<WebSocketRoute>();
  let sesi: Record<string, unknown> | null = null;
  await page.route(/\/api\/urusan\/u_[0-9a-f]+\/pendamping(\/tiket)?$/, async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.fallback();
    if (req.url().endsWith('/tiket'))
      return route.fulfill({ json: { wsUrl: WS_TIRUAN, tiket: 'tiket-tiruan-ketik' } });
    const { executionId } = req.postDataJSON() as { executionId: string };
    const sekarang = Date.now();
    sesi = {
      sesiId: 'sesi-tiruan-ketik',
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
      const msg = JSON.parse(String(m)) as Masuk;
      if (msg.type === 'halo') {
        soket.add(ws);
        ws.send(JSON.stringify({ type: 'status', sesi }));
        ws.send(JSON.stringify({ type: 'mode', mode: 'ai' }));
        return;
      }
      if (msg.type !== 'ack' && msg.type !== 'ping') masuk.push(msg);
    });
  });

  await daftarAkunUji(page);
  await page.goto('/peristiwa/kelahiran');
  const kota = page.getByRole('combobox', { name: 'Kabupaten/kota sesuai KTP Anda' });
  await expect(kota).toHaveAttribute('aria-autocomplete', 'list');
  await kota.fill('Wonogiri');
  await page.getByRole('option', { name: 'Kabupaten Wonogiri', exact: true }).click();
  await page.getByRole('button', { name: 'Mulai urusan ini' }).click();
  await expect(page).toHaveURL(/\/urusan\/u_[0-9a-f]{32}$/);
  const benar = page.getByRole('button', { name: 'Ya, betul' });
  await expect(benar).toBeEnabled({ timeout: 20_000 });
  await benar.click();
  const setujui = page.getByRole('button', { name: 'Setujui rencana' });
  await expect(setujui).toBeEnabled({ timeout: 20_000 });
  await setujui.click();
  const buka = page.getByRole('button', { name: 'Setujui dan buka situs' });
  await expect(buka).toBeEnabled({ timeout: 20_000 });
  await buka.click();
  await expect.poll(() => soket.size, { timeout: 20_000 }).toBeGreaterThan(0);
  const kirim = (m: unknown) => {
    for (const w of soket) w.send(JSON.stringify(m));
  };
  // AI berhenti di halaman masuk: giliran warga (takeover), frame halaman tampil.
  kirim({ type: 'frame', seq: 1, data: jpeg, meta: META });
  kirim({ type: 'mode', mode: 'takeover', pesan: 'Giliran Anda.' });
  kirim({
    type: 'event',
    event: {
      jenis: 'giliran_anda',
      alasan: 'login',
      pesan: 'Giliran Anda: ketik kode CAPTCHA, lalu tekan Masuk.',
    },
  });
  await expect(page.getByRole('button', { name: 'Sudah, lanjutkan' }).first()).toBeVisible();
  return { masuk, kirim };
}

const kanvas = (page: Page) => page.locator('canvas[aria-label="Layar situs resmi dari Browser Pendamping"]');
const teks = (masuk: Masuk[]) =>
  masuk
    .filter((m) => m.type === 'text' || (m.type === 'key' && m.aksi === 'down' && m.key === 'Backspace'))
    .map((m) => (m.type === 'text' ? m.teks : '⌫'))
    .join('');

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('klik kolom di siaran lalu ketik: klik + setiap huruf sampai ke worker', async ({ page }) => {
    const { masuk, kirim } = await giliranMasuk(page);
    const c = kanvas(page);
    await c.click();
    const klik = () => masuk.filter((m) => m.type === 'pointer' && m.aksi !== 'move');
    await expect.poll(() => klik().map((m) => m.aksi)).toEqual(['down', 'up']);
    // Titik tengah kanvas = titik tengah halaman situs (1280x800 terpetakan apa adanya).
    expect(klik()[0]).toMatchObject({ x: expect.closeTo(640, -1), y: expect.closeTo(400, -1) });
    await page.keyboard.type('DEV12');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('3');
    await expect.poll(() => teks(masuk)).toBe('DEV12⌫3');
    // Kolom sandi di situs: input tersembunyi jadi password (pengelola sandi/IME tidak menyimpan), tetap terkirim.
    kirim({ type: 'fokus', jenis: 'sandi' });
    const tersembunyi = page.getByLabel('Ketik di situs resmi');
    await expect(tersembunyi).toHaveAttribute('type', 'password');
    await page.keyboard.type('rahasia');
    await expect.poll(() => teks(masuk)).toBe('DEV12⌫3rahasia');
    // Enter (kirim formulir masuk) sebagai tombol khusus.
    await page.keyboard.press('Enter');
    await expect.poll(() => masuk.some((m) => m.type === 'key' && m.key === 'Enter')).toBe(true);
  });
});

test.describe('HP (keyboard layar)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('ketuk siaran membuka keyboard (input tersembunyi fokus); ketikan IME terkirim tanpa menunggu commit', async ({
    page,
  }) => {
    const { masuk } = await giliranMasuk(page);
    const c = kanvas(page);
    await c.scrollIntoViewIfNeeded();
    await c.tap();
    const tersembunyi = page.getByLabel('Ketik di situs resmi');
    await expect(tersembunyi).toBeFocused();
    expect(masuk.filter((m) => m.type === 'pointer' && m.aksi !== 'move').map((m) => m.aksi)).toEqual([
      'down',
      'up',
    ]);
    // Keyboard tanpa komposisi (angka/sandi): tiap huruf langsung.
    await page.keyboard.insertText('0812');
    await expect.poll(() => teks(masuk)).toBe('0812');
    // Keyboard berkomposisi (Gboard menggarisbawahi kata): huruf tampil di situs saat diketik, bukan saat commit.
    const cdp = await page.context().newCDPSession(page);
    const komposisi = (text: string) =>
      cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
    await komposisi('d');
    await expect.poll(() => teks(masuk)).toBe('0812d');
    await komposisi('de');
    await komposisi('dev');
    await expect.poll(() => teks(masuk)).toBe('0812dev');
    // Koreksi otomatis mengganti kata yang sedang dikomposisi: hapus selisih, ketik penggantinya.
    await komposisi('dew');
    await expect.poll(() => teks(masuk)).toBe('0812dev⌫w');
    await cdp.send('Input.insertText', { text: 'dew' });
    await page.waitForTimeout(200);
    expect(teks(masuk)).toBe('0812dev⌫w');
    await expect(tersembunyi).toHaveValue(PENJAGA);
  });

  test('Backspace keyboard Android (tanpa keydown Backspace) tetap sampai walau semua huruf sudah terhapus, juga di kolom sandi', async ({
    page,
  }) => {
    const { masuk, kirim } = await giliranMasuk(page);
    const c = kanvas(page);
    await c.scrollIntoViewIfNeeded();
    await c.tap();
    const tersembunyi = page.getByLabel('Ketik di situs resmi');
    await expect(tersembunyi).toBeFocused();
    const cdp = await page.context().newCDPSession(page);
    // Seperti Gboard: keydown "Unidentified" (229) + perintah hapus editor, bukan keydown Backspace. Di kotak yang
    // benar-benar kosong perintah ini tidak menghasilkan event apa pun (bug Android): penjaga mencegahnya.
    const hapusAndroid = async () => {
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        key: 'Unidentified',
        windowsVirtualKeyCode: 229,
        commands: ['deleteBackward'],
      });
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Unidentified',
        windowsVirtualKeyCode: 229,
      });
    };
    await page.keyboard.insertText('ab');
    await expect.poll(() => teks(masuk)).toBe('ab');
    for (let i = 0; i < 4; i++) await hapusAndroid();
    await expect.poll(() => teks(masuk)).toBe('ab⌫⌫⌫⌫');
    await expect(tersembunyi).toHaveValue(PENJAGA);
    expect(await tersembunyi.evaluate((el: HTMLInputElement) => el.selectionStart)).toBe(1);
    // Kolom sandi: type password tetap berlaku, salah ketik bisa dibetulkan.
    kirim({ type: 'fokus', jenis: 'sandi' });
    await expect(tersembunyi).toHaveAttribute('type', 'password');
    await page.keyboard.insertText('rahasiz');
    await hapusAndroid();
    await page.keyboard.insertText('a');
    await expect.poll(() => teks(masuk)).toBe('ab⌫⌫⌫⌫rahasiz⌫a');
    for (let i = 0; i < 3; i++) await hapusAndroid();
    await expect.poll(() => teks(masuk)).toBe('ab⌫⌫⌫⌫rahasiz⌫a⌫⌫⌫');
    await expect(tersembunyi).toHaveValue(PENJAGA);
    // Penjaga tidak pernah dikirim ke situs.
    expect(masuk.some((m) => m.teks?.includes(PENJAGA))).toBe(false);
  });
});
