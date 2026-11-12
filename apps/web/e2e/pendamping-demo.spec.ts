import { expect, test } from '@playwright/test';
import { masukJuriUji } from './akun-uji';

// Demo juri membuka situs RESMI asli dalam mode "lihat saja"; replika hanya simulasi yang diminta lewat tombol.
// Layanan pendamping digantikan tiruan di batas jaringan peramban (POST/DELETE /pendamping, /tiket, WebSocket
// viewer) karena CI tidak menjangkau situs pemerintah: tes ini memeriksa KONTRAK permintaan (tanpa `simulasi`,
// lalu `simulasi: true`) dan layar produksi. Pemilihan origin/mode di server diuji di vitest (pendamping.test.ts:
// "demo juri membuka situs resmi asli"), gerbang lihat saja di navigator/worker.
const WS_TIRUAN = 'ws://127.0.0.1:9/tiruan-pendamping/ws';
const RESMI = 'https://telunjuksakti.wonogirikab.go.id';
const REPLIKA = 'https://fixtures.urusinai.web.id';
const PESAN_DEMO = 'Di mode demo, Urusin tidak mengetik data contoh ke sistem pemerintah';

test('juri: situs resmi lihat saja dengan pesan jujur; tombol simulasi membuka replika berlabel Simulasi', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const permintaan: { simulasi?: boolean }[] = [];
  let ditutup = 0;
  let sesi: Record<string, unknown> = {};
  await page.route(/\/api\/urusan\/u_[0-9a-f]+\/pendamping(\/tiket)?$/, async (route) => {
    const req = route.request();
    if (req.method() === 'DELETE') {
      ditutup++;
      return route.fulfill({ json: { ...sesi, status: 'dibatalkan', mode: 'done' } });
    }
    if (req.url().endsWith('/tiket'))
      return route.fulfill({ json: { wsUrl: WS_TIRUAN, tiket: `tiket-demo-${permintaan.length}` } });
    if (req.method() !== 'POST') return route.fulfill({ json: sesi });
    const body = req.postDataJSON() as { executionId: string; simulasi?: boolean };
    permintaan.push(body);
    const simulasi = body.simulasi === true;
    const sekarang = Date.now();
    sesi = {
      sesiId: `sesi-demo-${permintaan.length}`,
      urusanId: new URL(req.url()).pathname.split('/')[3],
      executionId: body.executionId,
      status: 'berjalan',
      mode: simulasi ? 'ai' : 'takeover',
      antrean: null,
      dibuatPada: new Date(sekarang).toISOString(),
      kedaluwarsaPada: new Date(sekarang + 15 * 60_000).toISOString(),
      situs: simulasi ? REPLIKA : RESMI,
      replika: simulasi,
      ...(simulasi ? {} : { lihatSaja: true }),
    };
    return route.fulfill({ status: 201, json: sesi });
  });
  await page.routeWebSocket(WS_TIRUAN, (ws) => {
    ws.onMessage((m) => {
      if ((JSON.parse(String(m)) as { type: string }).type !== 'halo') return;
      ws.send(JSON.stringify({ type: 'status', sesi }));
      if (sesi.replika === true) {
        ws.send(JSON.stringify({ type: 'mode', mode: 'ai', pesan: 'AI sedang membuka situs resmi.' }));
        return;
      }
      const pesan = `Ini situs resmi asli. ${PESAN_DEMO}, jadi AI berhenti di sini tanpa mengisi apa pun.`;
      ws.send(JSON.stringify({ type: 'mode', mode: 'takeover', pesan }));
      ws.send(JSON.stringify({ type: 'event', event: { jenis: 'giliran_anda', alasan: 'berhenti', pesan } }));
    });
  });

  await masukJuriUji(page);
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
  // Kartu izin demo jujur: membuka untuk dilihat, bukan "AI mengisi".
  const kartu = page.getByRole('region', { name: 'Periksa sebelum membuka situs' });
  await expect(kartu).toContainText('mode demo (lihat saja)');
  await expect(kartu).toContainText('Tidak ada kolom yang diisi');
  await expect(kartu).not.toContainText('AI hanya mengisi');
  await buka.click();

  // Permintaan pertama: situs resmi (tanpa `simulasi`); layar jujur "lihat saja", tanpa label Simulasi.
  const browser = page.getByRole('region', { name: 'Browser Pendamping', exact: true });
  await expect(browser.getByText('Mode demo: AI hanya melihat')).toBeVisible({ timeout: 20_000 });
  await expect(browser.getByText(PESAN_DEMO).first()).toBeVisible();
  expect(permintaan).toHaveLength(1);
  expect(permintaan[0]!.simulasi).toBeUndefined();
  await expect(browser.locator('[data-label-simulasi]')).toHaveCount(0);
  await expect(browser).toContainText('telunjuksakti.wonogirikab.go.id');
  const tombol = browser.getByRole('button', { name: 'Lihat contoh pengisian (simulasi)' });
  await expect(tombol).toBeVisible();
  // Lihat saja tidak mengirim apa pun: tidak ada "Saya sudah mengirim".
  await expect(page.getByRole('button', { name: 'Saya sudah mengirim' })).toHaveCount(0);
  // HP 390 px: tidak ada gulir horizontal.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  // Simulasi: sesi asli ditutup dulu, lalu POST dengan `simulasi: true` -> replika berlabel Simulasi.
  await tombol.click();
  await expect.poll(() => permintaan.length).toBe(2);
  expect(ditutup).toBe(1);
  expect(permintaan[1]!.simulasi).toBe(true);
  await expect(browser.locator('[data-label-simulasi]')).toHaveText('Simulasi');
  await expect(browser.getByRole('button', { name: 'Lihat contoh pengisian (simulasi)' })).toHaveCount(0);
});
