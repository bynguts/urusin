import { expect, test, type Page } from '@playwright/test';
import { daftarAkunUji } from './akun-uji';

// QA produksi: lembar "Izinkan AI mengisi?" muncul saat layar masih "Menyiapkan" (portal belum tampil), menolak
// izin berakhir di layar putih, dan portal yang tidak terjangkau membuat layar putih tanpa pesan. Layanan
// pendamping digantikan tiruan di batas jaringan peramban (POST /pendamping, /tiket, GET status, WebSocket viewer);
// layar, SesiPendampingUi, dan klien viewer adalah kode produksi. Tidak ada situs pemerintah yang dibuka.
const WS_TIRUAN = 'ws://127.0.0.1:9/tiruan-pendamping/ws';
const RUTE = /\/api\/urusan\/u_[0-9a-f]+\/pendamping(\/tiket)?$/;
const DIALOG = { name: 'Izinkan AI mengisi?' } as const;

function sesiTiruan(url: string, executionId: string, extra: Record<string, unknown> = {}) {
  const sekarang = Date.now();
  return {
    sesiId: 'sesi-tiruan-izin',
    urusanId: new URL(url).pathname.split('/')[3],
    executionId,
    status: 'memulai',
    mode: null,
    antrean: null,
    situs: 'https://fixtures.urusinai.web.id',
    replika: true,
    dibuatPada: new Date(sekarang).toISOString(),
    kedaluwarsaPada: new Date(sekarang + 15 * 60_000).toISOString(),
    ...extra,
  };
}

/** Frame layar biner viewer: [u8 versi=1][u32 seq][u16 panjang meta][meta JSON][JPEG]. */
function frameBiner(seq: number, jpeg: Buffer): Buffer {
  const meta = Buffer.from(
    JSON.stringify({ lebar: 390, tinggi: 844, skala: 1, offsetAtas: 0, scrollX: 0, scrollY: 0 }),
  );
  const kepala = Buffer.alloc(7);
  kepala.writeUInt8(1, 0);
  kepala.writeUInt32BE(seq, 1);
  kepala.writeUInt16BE(meta.length, 5);
  return Buffer.concat([kepala, meta, jpeg]);
}

/** Jalur warga yang sama dengan pendamping-gerbang: Wonogiri → rencana → persetujuan → buka situs. */
async function bukaSitus(page: Page) {
  await daftarAkunUji(page);
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
  await setujui.click();
  const buka = page.getByRole('button', { name: 'Setujui dan buka situs' });
  await expect(buka).toBeEnabled({ timeout: 20_000 });
  await buka.click();
}

test('portal tampil dulu, baru lembar izin; "Saya isi sendiri" = portal terbuka untuk warga', async ({
  page,
}) => {
  const dariWarga: string[] = [];
  let sesi: Record<string, unknown> = {};
  await page.route(RUTE, async (route) => {
    const req = route.request();
    if (req.url().endsWith('/tiket'))
      return route.fulfill({ json: { wsUrl: WS_TIRUAN, tiket: 'tiket-tiruan-izin' } });
    if (req.method() !== 'POST') return route.fulfill({ json: sesi });
    sesi = sesiTiruan(req.url(), (req.postDataJSON() as { executionId: string }).executionId);
    return route.fulfill({ status: 201, json: sesi });
  });

  // Worker tiruan dengan urutan worker lama yang bermasalah: izin dikirim begitu viewer tersambung.
  let kirimFrame: (() => void) | undefined;
  const jpeg = await page.screenshot({ type: 'jpeg', clip: { x: 0, y: 0, width: 40, height: 40 } });
  await page.routeWebSocket(WS_TIRUAN, (ws) => {
    kirimFrame = () => ws.send(frameBiner(1, jpeg));
    ws.onMessage((m) => {
      const msg = JSON.parse(String(m)) as { type: string };
      dariWarga.push(msg.type);
      if (msg.type === 'halo') {
        ws.send(JSON.stringify({ type: 'status', sesi: { ...sesi, status: 'menunggu_data' } }));
        ws.send(
          JSON.stringify({
            type: 'butuh_data',
            placeholder: ['{{PEMOHON.HP}}'],
            berkas: ['kk'],
            origin: 'https://fixtures.urusinai.web.id',
          }),
        );
      }
      if (msg.type === 'ambil_alih') {
        ws.send(JSON.stringify({ type: 'mode', mode: 'takeover', pesan: 'Anda memegang kendali.' }));
        ws.send(
          JSON.stringify({
            type: 'event',
            event: { jenis: 'giliran_anda', alasan: 'diminta_warga', pesan: 'Anda memegang kendali.' },
          }),
        );
      }
    });
  });

  await bukaSitus(page);
  await expect.poll(() => dariWarga).toContain('halo');
  // Portal belum tergambar: TIDAK ada lembar izin di atas layar "Menyiapkan".
  await expect(page.getByText('Menyiapkan browser khusus urusan ini…')).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByRole('dialog', DIALOG)).toHaveCount(0);

  // Bingkai portal (replika Mode Uji) tergambar: situs terlihat, baru izin diminta.
  kirimFrame!();
  await expect(page.getByRole('dialog', DIALOG)).toBeVisible();
  await expect(page.getByText('Menyiapkan browser khusus urusan ini…')).toHaveCount(0);
  await expect(page.getByText('Simulasi', { exact: true })).toBeVisible();
  // Menunggu izin: panel tidak mengaku "AI sedang mengisi".
  await expect(page.locator('#panel-konteks')).toContainText('Menunggu izin Anda');
  await expect(page.locator('#panel-konteks')).not.toContainText('AI sedang mengisi');

  // Tolak izin: kendali ke warga di portal yang sudah terbuka (layar siaran, bukan kosong/Menyiapkan).
  await page.getByRole('button', { name: 'Saya isi sendiri' }).click();
  await expect.poll(() => dariWarga).toContain('ambil_alih');
  await expect(page.getByRole('dialog', DIALOG)).toHaveCount(0);
  // Giliran warga di portal yang sama (alasan nyata: isi sendiri), bukan layar galat "AI berhenti".
  await expect(
    page.getByRole('status').filter({ hasText: 'Giliran Anda: isi formulir di layar ini.' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Saya sudah mengirim' })).toBeVisible();
  await expect(page.getByText('Menyiapkan browser khusus urusan ini…')).toHaveCount(0);
});

test('portal tidak terjangkau dari worker: pesan galat dan jalur panduan, bukan layar putih', async ({
  page,
}) => {
  const PESAN =
    'Halaman telunjuksakti.wonogirikab.go.id tidak bisa dibuka: situs tidak menjawab tepat waktu (net::ERR_TIMED_OUT). Lanjutkan lewat panduan.';
  let sesi: Record<string, unknown> = {};
  await page.route(RUTE, async (route) => {
    const req = route.request();
    // Sesi sudah berakhir saat tiket diminta: worker menolak tiket.
    if (req.url().endsWith('/tiket'))
      return route.fulfill({ status: 404, json: { kode: 'SESI_TIDAK_ADA', pesanWarga: 'Sesi tidak ada.' } });
    if (req.method() !== 'POST')
      return route.fulfill({
        json: { ...sesi, status: 'gagal', mode: 'done', hasil: 'gagal', pesan: PESAN },
      });
    sesi = sesiTiruan(req.url(), (req.postDataJSON() as { executionId: string }).executionId, {
      replika: false,
      situs: 'https://telunjuksakti.wonogirikab.go.id',
    });
    return route.fulfill({ status: 201, json: sesi });
  });

  await bukaSitus(page);
  await expect(page.getByText(PESAN).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Menyiapkan browser khusus urusan ini…')).toHaveCount(0);
  await expect(page.getByRole('dialog', DIALOG)).toHaveCount(0);
});
