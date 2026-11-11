import http from 'node:http';
import type net from 'node:net';
import { expect, test } from '@playwright/test';
import { createBrowserFactory, launchIsolated } from '../src/browser.js';
import { loadConfig } from '../src/config.js';
import { createGerbangTulis, type CatatanBlokir } from '../src/gerbang-tulis.js';
import { ADAPTER_GENERIK, SessionManager, sidHashOf } from '../src/sessions.js';

/**
 * Gerbang tulis Navigator generik terhadap peramban sungguhan (Chromium + proxy egress di dalam proses) dan
 * situs uji lokal yang MENGHITUNG setiap permintaan tulis yang benar-benar sampai. Permintaan yang dibatalkan
 * `route.abort` tidak pernah terkirim: penghitungnya tetap 0. Tidak menyentuh situs asli.
 */

const SID = sidHashOf('g'.repeat(32));
const RESMI = 'https://telunjuksakti.wonogirikab.go.id';

const HALAMAN = `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Uji gerbang</title>
<style>#lanjut{position:fixed;left:0;top:0;width:240px;height:120px}#kirim{position:fixed;left:0;top:200px;width:240px;height:120px}</style>
</head><body>
<button type="button" id="lanjut" onclick="fetch('/simpan',{method:'POST',body:'x'}).catch(()=>{})">Lanjut</button>
<form method="post" action="/kirim"><input name="nama" value="uji"><button type="submit" id="kirim">Kirim</button></form>
<script>if(location.pathname==='/latar-mulai')setTimeout(()=>fetch('/latar',{method:'POST',body:'x'}).catch(()=>{}),1500)</script>
</body></html>`;

async function situsUji() {
  const hitung = new Map<string, number>();
  const server = http.createServer((req, res) => {
    const jalur = new URL(req.url ?? '/', 'http://x').pathname;
    if (req.method !== 'GET') hitung.set(jalur, (hitung.get(jalur) ?? 0) + 1);
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(req.method === 'GET' ? HALAMAN : '<!doctype html><title>terkirim</title>ok');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
  return {
    origin,
    hitung: (jalur: string) => hitung.get(jalur) ?? 0,
    tutup: () => new Promise<void>((r) => server.close(() => r())),
  };
}

test('klik AI sintetis (isolated world): fetch POST dari type=button dan submit form dibatalkan, penghitung 0', async () => {
  const situs = await situsUji();
  const config = loadConfig({ PENDAMPING_FIXTURE_ORIGINS: situs.origin, PENDAMPING_HEADLESS: '1' });
  let warga = false;
  const blokir: CatatanBlokir[] = [];
  const gerbang = createGerbangTulis({ wargaPegang: () => warga, onBlokir: (c) => void blokir.push(c) });
  const iso = await launchIsolated(
    config,
    { lebar: 390, tinggi: 844, dpr: 1, seluler: false },
    [],
    () => {},
    gerbang,
  );
  try {
    const page = iso.context.pages()[0] ?? (await iso.context.newPage());
    // Halaman awal: AI membuka URL persis itu (ai_klik + navKe).
    gerbang.setAi({ jenis: 'ai_klik', navKe: `${situs.origin}/mulai` });
    await page.goto(`${situs.origin}/mulai`);
    gerbang.setAi({ jenis: 'ai_diam' });
    const cdp = await iso.context.newCDPSession(page);
    const { frameTree } = (await cdp.send('Page.getFrameTree')) as { frameTree: { frame: { id: string } } };
    const klikAi = async (id: string) => {
      // Sama dengan runner: el.click() sintetis di dunia terisolasi, bukan main world halaman.
      const { executionContextId } = (await cdp.send('Page.createIsolatedWorld', {
        frameId: frameTree.frame.id,
        worldName: 'urusin-pendamping',
      })) as { executionContextId: number };
      await cdp.send('Runtime.evaluate', {
        expression: `document.getElementById(${JSON.stringify(id)}).click()`,
        contextId: executionContextId,
      });
    };

    gerbang.setAi({ jenis: 'ai_klik' });
    await klikAi('lanjut');
    await klikAi('kirim');
    await page.waitForTimeout(800);
    gerbang.setAi({ jenis: 'ai_diam' });
    // Skrip halaman sendiri saat AI diam (mis. ping/autosave latar): juga dibatalkan.
    await page.evaluate(() => fetch('/latar', { method: 'POST', body: 'x' }).catch(() => {}));
    expect(situs.hitung('/simpan')).toBe(0);
    expect(situs.hitung('/kirim')).toBe(0);
    expect(situs.hitung('/latar')).toBe(0);
    expect(page.url()).toBe(`${situs.origin}/mulai`);
    expect(blokir).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metode: 'POST', jendela: 'ai_klik', dokumen: false }),
        expect.objectContaining({ metode: 'POST', jendela: 'ai_klik', dokumen: true }),
        expect.objectContaining({ metode: 'POST', jendela: 'ai_diam', dokumen: false }),
      ]),
    );
    // Catatan tanpa path mentah.
    expect(JSON.stringify(blokir)).not.toContain('/simpan');

    // Warga memegang kendali: ketukan CDP Input lolos dan permintaan benar-benar sampai.
    warga = true;
    await page.mouse.click(60, 60);
    await expect.poll(() => situs.hitung('/simpan')).toBe(1);
  } finally {
    await iso.close();
    await situs.tutup();
  }
});

test('sesi generik: halaman awal terbuka, POST latar diblokir (dicatat), ketukan warga saat ambil alih lolos', async () => {
  const situs = await situsUji();
  const config = loadConfig({
    PENDAMPING_FIXTURE_ORIGINS: situs.origin,
    PENDAMPING_ORIGIN_OVERRIDES: `${RESMI}=${situs.origin}`,
    PENDAMPING_HEADLESS: '1',
  });
  const manager = new SessionManager(config, createBrowserFactory(config));
  const o = { urusanId: 'u-gerbang', sidHash: SID };
  try {
    // Mode Uji tanpa pemetaan untuk origin ini: 422 sebelum peramban/edge dibuat.
    await expect(
      manager.create({
        ...o,
        urusanId: 'u-tanpa',
        executionId: 'x_tanpa',
        adapterId: ADAPTER_GENERIK,
        flowId: 'navigator',
        origin: 'https://sidnok.semarangkota.go.id',
        params: {},
        modeUji: true,
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(manager.antrean()).toEqual({ aktif: 0, maks: config.maxSessions, menunggu: 0 });

    const sesi = await manager.create({
      ...o,
      executionId: 'x_gerbang',
      adapterId: ADAPTER_GENERIK,
      flowId: 'navigator',
      origin: RESMI,
      params: { jalur: '/latar-mulai' },
      modeUji: true,
    });
    expect(sesi).toMatchObject({ situs: situs.origin, replika: true });
    await expect.poll(() => manager.status(o).status, { timeout: 30_000 }).toBe('berjalan');
    // Fetch latar halaman (ai_diam) dibatalkan dan dicatat tanpa path mentah.
    await expect
      .poll(
        () => manager.kurasJejak(o).catatan.some((c) => c.jenis === 'blokir' && c.jendela === 'ai_diam'),
        {
          timeout: 10_000,
        },
      )
      .toBe(true);
    expect(situs.hitung('/latar')).toBe(0);

    // Warga mengambil alih lalu mengetuk tombol Lanjut (fetch POST): lolos, sampai ke situs.
    manager.serahkan(o);
    expect(manager.status(o).mode).toBe('takeover');
    for (const aksi of ['down', 'up'] as const)
      await manager.handleClient(sesi.sesiId, {
        type: 'pointer',
        aksi,
        x: 60,
        y: 60,
        jenis: 'mouse',
        tombol: 'left',
      });
    await expect.poll(() => situs.hitung('/simpan'), { timeout: 10_000 }).toBe(1);
    // Warga menekan Kirim sendiri (POST dokumen): lolos.
    for (const aksi of ['down', 'up'] as const)
      await manager.handleClient(sesi.sesiId, {
        type: 'pointer',
        aksi,
        x: 60,
        y: 260,
        jenis: 'mouse',
        tombol: 'left',
      });
    await expect.poll(() => situs.hitung('/kirim'), { timeout: 10_000 }).toBe(1);
  } finally {
    await manager.shutdown();
    await situs.tutup();
  }
});
