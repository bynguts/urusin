import { expect, test } from '@playwright/test';

// N1 lewat UI warga: AI berhenti (serah akhir `berhenti`), warga mengirim sendiri di situs, lalu menekan
// "Saya sudah mengirim". Layanan pendamping digantikan tiruan di batas jaringan peramban seperti
// pendamping-giliran: POST /pendamping, /tiket, dan /terkirim di-route, viewer lewat routeWebSocket. Layar,
// SesiPendampingUi dan klien viewer adalah kode produksi. Route /terkirim -> worker /selesai (tulis warga +
// halaman sukses) diuji di vitest (pendamping.test.ts) dan worker di e2e pendamping (gerbang-poc N1).
// Tiruan pertama menjawab 409 (belum terlihat terkirim), lalu 200 siaga berhasil dengan nomor permohonan.
const WS_TIRUAN = 'ws://127.0.0.1:9/tiruan-pendamping/ws';
const PESAN_BERHENTI = 'AI berhenti di sini. Lanjutkan sendiri dari layar ini.';
const PESAN_BELUM = 'Belum terlihat terkirim. Periksa halaman situsnya, lalu coba lagi.';

test('N1: AI berhenti, warga mengirim sendiri, "Saya sudah mengirim" -> 409 jujur lalu berhasil', async ({
  page,
}) => {
  let sesi: Record<string, unknown> | null = null;
  let terkirim = 0;

  await page.route(/\/api\/urusan\/u_[0-9a-f]+\/pendamping(\/tiket|\/terkirim)?$/, async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.fallback();
    if (req.url().endsWith('/tiket'))
      return route.fulfill({ json: { wsUrl: WS_TIRUAN, tiket: 'tiket-tiruan-e2e' } });
    if (req.url().endsWith('/terkirim')) {
      terkirim++;
      if (terkirim === 1)
        return route.fulfill({ status: 409, json: { kode: 'BELUM_TERKIRIM', pesanWarga: PESAN_BELUM } });
      return route.fulfill({
        json: {
          ...sesi,
          status: 'siaga',
          mode: 'takeover',
          hasil: 'berhasil',
          bukti: { nomor: 'FX-REG-0042' },
        },
      });
    }
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
    ws.onMessage((m) => {
      if ((JSON.parse(String(m)) as { type: string }).type !== 'halo') return;
      ws.send(JSON.stringify({ type: 'status', sesi }));
      ws.send(JSON.stringify({ type: 'mode', mode: 'takeover', pesan: PESAN_BERHENTI }));
      ws.send(
        JSON.stringify({
          type: 'event',
          event: { jenis: 'giliran_anda', alasan: 'berhenti', pesan: PESAN_BERHENTI },
        }),
      );
    });
  });

  // Jalur warga yang sama dengan pendamping-giliran: Wonogiri → rencana → persetujuan → buka situs.
  await page.goto('/peristiwa/kelahiran');
  await page.getByLabel('Kabupaten/kota sesuai KTP Anda').selectOption('3312');
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

  // Serah akhir: "AI berhenti", tanpa Lanjutkan, dengan "Saya sudah mengirim".
  const lembar = page.getByRole('status').filter({ hasText: PESAN_BERHENTI });
  await expect(lembar).toBeVisible({ timeout: 20_000 });
  await expect(lembar.getByRole('button', { name: 'Lanjutkan' })).toHaveCount(0);
  const sudah = lembar.getByRole('button', { name: 'Saya sudah mengirim' });

  // Belum terlihat terkirim (worker 409): pesan jujur, sesi tetap di tangan warga.
  await sudah.click();
  await expect(lembar.getByRole('alert')).toHaveText(PESAN_BELUM);
  expect(terkirim).toBe(1);

  // Sesudah warga benar-benar mengirim: worker menerima, layar siaga dengan nomor permohonan.
  await sudah.click();
  await expect(page.getByText('FX-REG-0042')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Saya sudah mengirim' })).toHaveCount(0);
  expect(terkirim).toBe(2);
});
