import { expect, test } from '@playwright/test';

// Giliran `ketuk_tautan` lewat UI warga (bukan API): layanan pendamping digantikan tiruan di batas jaringan
// peramban (POST /pendamping + /tiket di-route, WebSocket viewer di-routeWebSocket). Layar, SesiPendampingUi
// dan klien viewer adalah kode produksi. Tiruan mengirim giliran "tautan pembuka" seperti worker; warga melihat
// judul "Buka formulir di situs", menekan Lanjutkan, dan viewer mengirim `kembalikan` sehingga AI lanjut.
// Tidak ada situs pemerintah yang dibuka.
const WS_TIRUAN = 'ws://127.0.0.1:9/tiruan-pendamping/ws';
const PESAN_GILIRAN = 'Ketuk tautan yang disorot untuk membuka formulir, lalu tekan Lanjutkan.';

test('giliran ketuk_tautan: warga menekan Lanjutkan di layar, viewer mengirim kembalikan, AI lanjut', async ({
  page,
}) => {
  const dariWarga: { type: string }[] = [];
  let sesi: Record<string, unknown> | null = null;

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
    ws.onMessage((m) => {
      const msg = JSON.parse(String(m)) as { type: string };
      dariWarga.push(msg);
      if (msg.type === 'halo') {
        ws.send(JSON.stringify({ type: 'status', sesi }));
        ws.send(JSON.stringify({ type: 'mode', mode: 'takeover', pesan: PESAN_GILIRAN }));
        ws.send(
          JSON.stringify({
            type: 'event',
            event: { jenis: 'giliran_anda', alasan: 'ketuk_tautan', pesan: PESAN_GILIRAN },
          }),
        );
      }
      if (msg.type === 'kembalikan') ws.send(JSON.stringify({ type: 'mode', mode: 'ai' }));
    });
  });

  // Jalur warga yang sama dengan pendamping-gerbang: Wonogiri → rencana → persetujuan → buka situs.
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

  // Giliran warga: judul khusus + catatan, dan tombol Lanjutkan (bukan jalan buntu).
  const lembar = page.getByRole('status').filter({ hasText: 'Buka formulir di situs' });
  await expect(lembar).toBeVisible({ timeout: 20_000 });
  await expect(lembar).toContainText(PESAN_GILIRAN);
  await expect(lembar).toContainText('AI tidak mengetuk tautan ini; Anda yang membukanya.');
  expect(dariWarga.map((m) => m.type)).not.toContain('kembalikan');

  await lembar.getByRole('button', { name: 'Lanjutkan' }).click();
  await expect.poll(() => dariWarga.filter((m) => m.type === 'kembalikan').length).toBe(1);
  await expect(page.getByText('Buka formulir di situs')).toHaveCount(0);
});
