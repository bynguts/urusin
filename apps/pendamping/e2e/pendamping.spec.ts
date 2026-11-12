import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';
import type net from 'node:net';
import { expect, test, type Page } from '@playwright/test';
import { WebSocketServer } from 'ws';
import { byRole, click, css } from '@urusin/core';
import type { PendampingEvent, SesiPendamping, TiketPendampingResponse } from '@urusin/contracts';
import { createBrowserFactory, launchIsolated, PESAN_MEMORI } from '../src/browser.js';
import { loadConfig } from '../src/config.js';
import { runnerExpression } from '../src/runner-script.js';
import { SessionManager, sidHashOf } from '../src/sessions.js';
import { headerTanda } from '../src/tanda.js';
import { FIXTURE_ORIGIN, INTERNAL_TOKEN, PENDAMPING_ORIGIN } from '../playwright.config.js';

/**
 * Alur nyata terhadap replika Telunjuk Sakti (apps/fixtures, data fiktif):
 * AI mengisi -> CAPTCHA wajib takeover -> AI mengunggah -> runner menolak final -> warga mengetuk Selesai
 * -> sesi dihancurkan. Plus SSRF dari dalam peramban pendamping.
 */

const TEST_HP = '08000000001'; // HP uji fiktif yang tercetak di halaman fixture
const SID_MENTAH = 'e2e'.padEnd(32, '0');
const SID = sidHashOf(SID_MENTAH);
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function internal<T>(path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const isi = body === undefined ? '' : JSON.stringify(body);
  const metode = body === undefined ? 'GET' : 'POST';
  const waktu = String(Date.now());
  const res = await fetch(`${PENDAMPING_ORIGIN}${path}`, {
    method: metode,
    headers: {
      ...headerTanda(INTERNAL_TOKEN, metode, path, isi, Number(waktu)),
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: isi }),
  });
  return { status: res.status, data: (await res.json()) as T };
}

const owner = (urusanId: string) => ({ urusanId, sidHash: SID });

function mulai(urusanId: string) {
  return internal<SesiPendamping>('/internal/sesi', {
    ...owner(urusanId),
    executionId: `x_${urusanId}`,
    adapterId: 'telunjuk-sakti-wonogiri',
    flowId: 'ajukan',
    origin: 'https://telunjuksakti.wonogirikab.go.id',
    params: { layanan_id: 1, berkas: 'ktp,kk' },
  });
}

/** Buka halaman penampil DEV (perangkat warga) yang mengambil tiket baru lewat API internal. */
async function bukaPenampil(page: Page, urusanId: string, sesiId: string) {
  await page.exposeFunction('__ambilTiket', async () => {
    const r = await internal<TiketPendampingResponse>('/internal/sesi/tiket', owner(urusanId));
    return r.data.tiket;
  });
  await page.goto(
    `${PENDAMPING_ORIGIN}/dev?ws=${encodeURIComponent(`ws://127.0.0.1:${new URL(PENDAMPING_ORIGIN).port}/ws/${sesiId}`)}`,
  );
}

const peristiwa = (page: Page) =>
  page.evaluate(() => (window as unknown as { peristiwa: PendampingEvent[] }).peristiwa);

async function tungguGiliran(page: Page, alasan: 'login' | 'final' | 'berkas_kurang') {
  await expect
    .poll(
      async () => (await peristiwa(page)).find((e) => e.jenis === 'giliran_anda' && e.alasan === alasan),
      {
        timeout: 60_000,
      },
    )
    .toBeTruthy();
  const e = (await peristiwa(page)).find((x) => x.jenis === 'giliran_anda' && x.alasan === alasan);
  return e as Extract<PendampingEvent, { jenis: 'giliran_anda' }>;
}

test.describe.configure({ mode: 'serial' });

test('alur penuh: AI mengisi, CAPTCHA oleh warga, final oleh warga, sesi dihancurkan', async ({
  browser,
}) => {
  // Perangkat warga: ponsel dengan layar sentuh.
  const device = await browser.newContext({ viewport: { width: 480, height: 1000 }, hasTouch: true });
  // Cookie sesi pemilik (di produksi: cookie web app di domain yang sama dengan /pendamping/ws).
  // `__Host-` = Secure + Path=/ tanpa Domain; 127.0.0.1 adalah konteks tepercaya bagi Chromium.
  await device.addCookies([
    { name: '__Host-urusin_sid', value: SID_MENTAH, domain: '127.0.0.1', path: '/', secure: true },
  ]);
  const page = await device.newPage();

  const created = await mulai('u-e2e-1');
  expect(created.status).toBe(201);
  const sesiId = created.data.sesiId;

  // Sesi kedua mengantre (PENDAMPING_MAX_SESSIONS=1): posisi terlihat oleh UI.
  const queued = await mulai('u-e2e-antre');
  expect(queued.data).toMatchObject({ status: 'antre', antrean: { posisi: 1 } });
  expect((await internal('/internal/antrean')).data).toEqual({ aktif: 1, maks: 1, menunggu: 1 });

  // Semua frame teks WS perangkat (dua arah) direkam: nilai vault tidak boleh pernah lewat sini (A-M1).
  const frameWs: string[] = [];
  page.on('websocket', (ws) => {
    const catat = (f: { payload: string | Buffer }) => {
      if (typeof f.payload === 'string') frameWs.push(f.payload);
    };
    ws.on('framesent', catat);
    ws.on('framereceived', catat);
  });
  await bukaPenampil(page, 'u-e2e-1', sesiId);
  await expect(page.locator('#koneksi')).toHaveText('tersambung');
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { butuh?: unknown }).butuh))
    .toEqual({
      placeholder: ['{{PEMOHON.HP}}'],
      berkas: ['ktp', 'kk'],
      origin: FIXTURE_ORIGIN,
    });

  // "Izinkan isi" -> jalur isi server (A-M1), urutan yang sama dengan controller web (isiSesiDariVault): tanya
  // pemegang sesi apa yang dibutuhkan + origin yang diisi, lalu kirim berkas lalu nilai (terakhir) lewat kanal
  // internal bertanda HMAC. Perangkat tidak punya jalur nilai vault (placeholder di-resolve di batas eksekutor).
  // Akun warga baru punya KTP: KK diminta nanti di langkah unggahnya (giliran berkas_kurang).
  const butuh = await internal<{ placeholder: string[]; berkas: string[]; origin: string }>(
    '/internal/sesi/butuh',
    owner('u-e2e-1'),
  );
  expect(butuh.data).toEqual({
    placeholder: ['{{PEMOHON.HP}}'],
    berkas: ['ktp', 'kk'],
    origin: FIXTURE_ORIGIN,
  });
  const kirimBerkas = async (nama: string) =>
    (
      await internal('/internal/sesi/berkas', {
        ...owner('u-e2e-1'),
        nama,
        namaBerkas: `${nama}.png`,
        mime: 'image/png',
        dataBase64: PNG.toString('base64'),
      })
    ).status;
  expect(await kirimBerkas('ktp')).toBe(200);
  expect(
    (await internal('/internal/sesi/isi', { ...owner('u-e2e-1'), isian: { '{{PEMOHON.HP}}': TEST_HP } }))
      .status,
  ).toBe(200);

  // AI mengisi HP lalu berhenti di CAPTCHA: wajib takeover.
  const login = await tungguGiliran(page, 'login');
  await expect(page.locator('#mode')).toHaveText('takeover');
  expect(login.sorot).toBeDefined();
  // Replika publik hanya punya HP + CAPTCHA: teks giliran tidak menyuruh mengetik sandi.
  expect(login.pesan).toBe('Giliran Anda: ketik kode CAPTCHA, lalu tekan Masuk.');
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { frameTerakhir?: unknown }).frameTerakhir))
    .toBeTruthy();
  // Frame biner + ack: penampil terus menerima frame baru (aliran tidak macet setelah 2 frame).
  const seqAwal = await page.evaluate(() => (window as unknown as { jumlahFrame: number }).jumlahFrame);
  await page.waitForTimeout(1500);
  expect(
    await page.evaluate(() => (window as unknown as { jumlahFrame: number }).jumlahFrame),
  ).toBeGreaterThan(seqAwal);

  // Warga: Tab dari kolom HP (fokus terakhir AI) ke kolom CAPTCHA, ketik lewat keyboard virtual, tekan Masuk.
  await page.locator('#layar').focus();
  await page.keyboard.press('Tab');
  // Fokus berpindah ke kolom CAPTCHA (teks): ponsel diberi tahu jenisnya, tanpa nilai.
  await expect.poll(() => page.evaluate(() => (window as unknown as { fokus?: string }).fokus)).toBe('teks');
  await page.locator('#ketik').pressSequentially('DEV123');
  const s = login.sorot!;
  await page.locator('#layar').click({ position: { x: s.x + s.lebar / 2, y: s.y + s.tinggi / 2 } });

  // Login sukses membuktikan HP diisi AI dengan benar (fixture memeriksa HP + CAPTCHA). AI lanjut mengunggah.
  // KTP terunggah; KK belum ada di akun: giliran berkas_kurang (nama + origin untuk persetujuan baru).
  const kurang = await tungguGiliran(page, 'berkas_kurang');
  expect(kurang.pesan).toBe('Dokumen KK belum ada. Tambahkan di Dokumen, lalu tekan Lanjutkan.');
  expect(kurang.berkas).toEqual({ nama: 'kk', origin: FIXTURE_ORIGIN });
  await expect(page.locator('#mode')).toHaveText('takeover');
  // Lanjutkan tanpa menambah berkas: langkah unggah diulang dan giliran yang sama muncul lagi.
  const jumlahKurang = async () =>
    (await peristiwa(page)).filter((e) => e.jenis === 'giliran_anda' && e.alasan === 'berkas_kurang').length;
  await page.locator('#kembali').click();
  await expect.poll(jumlahKurang, { timeout: 30_000 }).toBe(2);
  // Warga menambah KK di Dokumen, Lanjutkan = "Izinkan isi" baru untuk KK saja: butuh -> berkas -> isi.
  const butuhKk = await internal<{ placeholder: string[]; berkas: string[] }>(
    '/internal/sesi/butuh',
    owner('u-e2e-1'),
  );
  expect(butuhKk.data).toMatchObject({ placeholder: [], berkas: ['kk'] });
  expect(await kirimBerkas('kk')).toBe(200);
  expect((await internal('/internal/sesi/isi', { ...owner('u-e2e-1'), isian: {} })).status).toBe(200);
  await page.locator('#kembali').click();

  // Sampai di giliran final = kedua unggahan lolos pascakondisi adapter (jumlah .uploaded-item bertambah).
  const final = await tungguGiliran(page, 'final');
  // Teks giliran menyebut tombol yang benar-benar ada di halaman (tautan "Selesai"), dari adapter dan halaman.
  expect(final.pesan).toBe('Semua berkas terunggah. Periksa, lalu tekan Selesai sendiri untuk mengirim.');
  expect(final.tombol).toBe('Selesai');
  // Langkah unggah selesai: jalur isi tertutup lagi.
  expect((await internal('/internal/sesi/butuh', owner('u-e2e-1'))).status).toBe(409);
  expect((await internal('/internal/sesi/teks', owner('u-e2e-1'))).status).toBe(404);
  const langkah = (await peristiwa(page)).filter((e) => e.jenis === 'langkah');
  expect(langkah.map((e) => (e as { label: string }).label)).toContain('Mengunggah berkas');
  expect(JSON.stringify(await peristiwa(page))).not.toContain(TEST_HP);
  // Nilai HP dan isi berkas tidak pernah ada di frame WS perangkat, ke arah mana pun.
  expect(frameWs.length).toBeGreaterThan(5);
  for (const f of frameWs) {
    expect(f).not.toContain(TEST_HP);
    expect(f).not.toContain(PNG.toString('base64'));
    expect(f).not.toMatch(/"type":"(vault|berkas|berkas_potong)"/);
  }

  // Warga mengetuk "Selesai" (sentuh) di area sorotan: satu-satunya jalan pengiriman akhir.
  const sebelumKirim = frameWs.length;
  const f = final.sorot!;
  await page.touchscreen.tap(
    (await page.locator('#layar').boundingBox())!.x + f.x + f.lebar / 2,
    (await page.locator('#layar').boundingBox())!.y + f.y + f.tinggi / 2,
  );

  // Pengajuan terkirim: sesi langsung selesai berhasil dengan bukti dari tabel permohonan; peramban dan data
  // dihancurkan saat itu juga (tanpa siaga, tanpa jeda, tanpa kembali ke "AI mengisi").
  await expect
    .poll(
      async () => (await internal<SesiPendamping>('/internal/sesi/status', owner('u-e2e-1'))).data.status,
      {
        timeout: 30_000,
      },
    )
    .toBe('selesai');
  const akhir = await internal<SesiPendamping>('/internal/sesi/status', owner('u-e2e-1'));
  expect(akhir.data).toMatchObject({
    status: 'selesai',
    hasil: 'berhasil',
    mode: 'done',
    bukti: { nomor: 'FX-REG-0002', status: 'Baru diajukan (data uji)' },
  });
  await expect(page.locator('#mode')).toHaveText('done', { timeout: 30_000 });
  await expect(page.locator('#koneksi')).toHaveText('selesai');
  const selesai = (await peristiwa(page)).find((e) => e.jenis === 'selesai');
  expect(selesai).toMatchObject({
    hasil: 'berhasil',
    bukti: { nomor: 'FX-REG-0002', status: 'Baru diajukan (data uji)' },
  });
  const modeSesudahKirim = frameWs
    .slice(sebelumKirim)
    .map((x) => /"type":"mode","mode":"([a-z]+)"/.exec(x)?.[1])
    .filter(Boolean);
  expect(modeSesudahKirim).toEqual(['done']);

  // Sesi dihancurkan: slot dipakai sesi antrean berikutnya; tiket untuk sesi lama tidak bisa dibuat.
  await expect
    .poll(
      async () => (await internal<SesiPendamping>('/internal/sesi/status', owner('u-e2e-antre'))).data.status,
    )
    .not.toBe('antre');
  expect((await internal('/internal/sesi/tiket', owner('u-e2e-1'))).status).toBe(404);
  await internal('/internal/sesi/akhiri', owner('u-e2e-antre'));
  await expect
    .poll(async () => (await internal('/internal/antrean')).data)
    .toEqual({ aktif: 0, maks: 1, menunggu: 0 });
  await device.close();
});

test('runner menolak menekan tombol final (Selesai) walau langkah adapter memintanya', async ({
  browser,
}) => {
  // Halaman fixture nyata, runner yang sama (isolated world CDP) seperti di sesi pendamping.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${FIXTURE_ORIGIN}/telunjuksakti/index.php/users/login`);
  await page.fill('#hp', TEST_HP);
  await page.fill('#captcha', 'DEV123');
  await page.click('#loginSubmit');
  await page.goto(`${FIXTURE_ORIGIN}/telunjuksakti/index.php/pendaftaran/uploadberkas/1`);
  const cdp = await ctx.newCDPSession(page);
  const { frameTree } = await cdp.send('Page.getFrameTree');
  const { executionContextId } = await cdp.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id });
  const run = async (op: unknown) =>
    (
      await cdp.send('Runtime.evaluate', {
        expression: runnerExpression(op),
        contextId: executionContextId,
        awaitPromise: true,
        returnByValue: true,
      })
    ).result.value as { ok: boolean; code?: string };
  const finalTargets = [[css('#btnSelesai'), byRole('link', 'Selesai')]];
  for (const target of [[css('#btnSelesai')], [byRole('link', 'Selesai')]]) {
    expect(await run({ kind: 'step', step: click(target, { effect: 'read' }), finalTargets })).toMatchObject({
      ok: false,
      code: 'FINAL_NOT_AUTOMATABLE',
    });
  }
  expect(
    await run({ kind: 'step', step: { op: 'click', target: [css('#btnSelesai')], effect: 'final' } }),
  ).toMatchObject({
    code: 'FINAL_NOT_AUTOMATABLE',
  });
  await page.waitForTimeout(500);
  expect(page.url()).toContain('/pendaftaran/uploadberkas/1');
  await page.goto(`${FIXTURE_ORIGIN}/telunjuksakti/index.php/welcome/permohonan`);
  await expect(page.locator('#tblPermohonan tbody tr')).toHaveCount(1); // hanya baris awal, tidak ada pengajuan baru
  await ctx.close();
});

test('SSRF: dari dalam peramban pendamping, 127.0.0.1:2019 dan 169.254.169.254 tidak terjangkau', async () => {
  let hits = 0;
  const canary = http.createServer((_req, res) => {
    hits++;
    res.end('bocor');
  });
  const listening = await new Promise<boolean>((resolve) => {
    canary.once('error', () => resolve(false));
    canary.listen(2019, '127.0.0.1', () => resolve(true));
  });
  const blocked: string[] = [];
  const config = { ...loadConfig({ PENDAMPING_FIXTURE_ORIGINS: FIXTURE_ORIGIN, PENDAMPING_HEADLESS: '1' }) };
  const iso = await launchIsolated(
    config,
    { lebar: 390, tinggi: 844, dpr: 1, seluler: true },
    ['telunjuksakti.wonogirikab.go.id'],
    (h) => blocked.push(h),
  );
  try {
    const page = await iso.context.newPage();
    await page.goto(`${FIXTURE_ORIGIN}/`);
    expect(await page.title()).toContain('fixture');
    const hasil = await page.evaluate(async () => {
      const coba = async (u: string) => {
        try {
          const r = await fetch(u, { mode: 'no-cors', cache: 'no-store' });
          return `terjangkau:${r.type}`;
        } catch {
          return 'gagal';
        }
      };
      return {
        caddy: await coba('http://127.0.0.1:2019/config/'),
        metadata: await coba('http://169.254.169.254/latest/meta-data/'),
        localhost: await coba('http://localhost:2019/'),
        mapped: await coba('http://[::ffff:7f00:1]:2019/'),
      };
    });
    expect(hasil).toEqual({ caddy: 'gagal', metadata: 'gagal', localhost: 'gagal', mapped: 'gagal' });
    for (const u of ['http://127.0.0.1:2019/', 'http://169.254.169.254/latest/meta-data/']) {
      const nav = await page.goto(u).catch((e: Error) => e);
      expect(nav instanceof Error || (nav?.status() ?? 0) >= 400).toBe(true);
    }
    // Lapis proxy sendiri (tanpa lapis route): CONNECT/GET langsung ke proxy sesi juga ditolak.
    const viaProxy = await new Promise<number>((resolve) => {
      const req = http.request(
        { host: '127.0.0.1', port: iso.proxy!.port, path: 'http://169.254.169.254/latest/meta-data/' },
        (res) => resolve(res.statusCode ?? 0),
      );
      req.on('error', () => resolve(0));
      req.end();
    });
    expect(viaProxy).toBe(403);
    expect(await iso.proxy!.decide('127.0.0.1', 2019)).toMatchObject({ ok: false });
    if (listening) expect(hits).toBe(0);
  } finally {
    await iso.close();
    canary.close();
  }
  expect((canary.address() as net.AddressInfo | null) ?? null).toBeNull();
});

test('probe gel4 3310: XHR/fetch GET ke host aset pemda .go.id lolos rute; tulis dan CDN umum tidak', async () => {
  // Proxy hulu tiruan: setiap CONNECT dicatat lalu ditolak 502, jadi permintaan yang lolos rute peramban tidak
  // pernah sampai ke situs asli (lapis yang diuji di sini hanya `context.route`/izinRute).
  const connect: string[] = [];
  const hulu = http.createServer();
  hulu.on('connect', (req, socket) => {
    connect.push(req.url ?? '');
    socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
  });
  await new Promise<void>((ok) => hulu.listen(0, '127.0.0.1', ok));
  const config = loadConfig({
    PENDAMPING_FIXTURE_ORIGINS: FIXTURE_ORIGIN,
    PENDAMPING_HEADLESS: '1',
    PENDAMPING_UPSTREAM_PROXY: `http://127.0.0.1:${(hulu.address() as net.AddressInfo).port}`,
  });
  const ASET = 'https://api.diskominfo.klaten.go.id';
  const iso = await launchIsolated(config, { lebar: 390, tinggi: 844, dpr: 1, seluler: true }, [
    'api.diskominfo.klaten.go.id',
    'unpkg.com',
  ]);
  const gagal = new Map<string, string>();
  iso.context.on('requestfailed', (r) =>
    gagal.set(`${r.method()} ${r.url()}`, r.failure()?.errorText ?? '?'),
  );
  try {
    // Halaman kosong tanpa CSP (halaman fixture membatasi connect-src): yang diuji hanya rute peramban.
    const page = await iso.context.newPage();
    await page.evaluate(
      async ({ aset }) => {
        const coba = (u: string, init?: RequestInit) =>
          fetch(u, { mode: 'no-cors', cache: 'no-store', ...init }).catch(() => undefined);
        await coba(`${aset}/v1/statistik.json`);
        await coba(`${aset}/v1/kirim`, { method: 'POST', body: 'x' });
        await coba('https://unpkg.com/paket@1.0.0/data.json');
        await new Promise<void>((ok) => {
          const x = new XMLHttpRequest();
          x.open('GET', `${aset}/v1/xhr.json`);
          x.onloadend = () => ok();
          x.send();
        });
      },
      { aset: ASET },
    );
    await expect.poll(() => gagal.size, { timeout: 10_000 }).toBeGreaterThanOrEqual(4);
    // GET (fetch + XHR) ke host aset pemda: lolos rute (gagal hanya karena proxy hulu tiruan).
    for (const u of [`GET ${ASET}/v1/statistik.json`, `GET ${ASET}/v1/xhr.json`]) {
      expect(gagal.get(u), u).toBeDefined();
      expect(gagal.get(u), u).not.toMatch(/ERR_BLOCKED_BY_CLIENT/);
    }
    // Tulis ke host aset dan XHR/fetch ke CDN umum: dibatalkan di peramban, tidak pernah terkirim.
    expect(gagal.get(`POST ${ASET}/v1/kirim`)).toMatch(/^net::ERR_BLOCKED_BY_CLIENT/);
    expect(gagal.get('GET https://unpkg.com/paket@1.0.0/data.json')).toMatch(/^net::ERR_BLOCKED_BY_CLIENT/);
    expect(connect.every((c) => c === 'api.diskominfo.klaten.go.id:443')).toBe(true);
  } finally {
    await iso.close();
    hulu.close();
  }
});

test('probe gel5 3310: gambar/style dari subdomain pemda yang sama lolos rute + proxy; jenis lain dan pemda lain tidak', async () => {
  // Proxy hulu tiruan: CONNECT yang sampai = lolos rute peramban DAN proxy egress sesi (lalu ditolak 502).
  const connect: string[] = [];
  const hulu = http.createServer();
  hulu.on('connect', (req, socket) => {
    connect.push(req.url ?? '');
    socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
  });
  await new Promise<void>((ok) => hulu.listen(0, '127.0.0.1', ok));
  const config = loadConfig({
    PENDAMPING_FIXTURE_ORIGINS: FIXTURE_ORIGIN,
    PENDAMPING_HEADLESS: '1',
    PENDAMPING_UPSTREAM_PROXY: `http://127.0.0.1:${(hulu.address() as net.AddressInfo).port}`,
  });
  const iso = await launchIsolated(config, { lebar: 390, tinggi: 844, dpr: 1, seluler: true }, [
    'sakura.dukcapil.klaten.go.id',
    'unpkg.com',
  ]);
  const gagal = new Map<string, string>();
  iso.context.on('requestfailed', (r) => gagal.set(r.url(), r.failure()?.errorText ?? '?'));
  const GAMBAR = 'https://cdn.klaten.go.id/logo.png';
  const STYLE = 'https://cdn.dukcapil.klaten.go.id/tema.css';
  const LAIN = 'https://cdn.slemankab.go.id/logo.png';
  const SKRIP = 'https://cdn.klaten.go.id/app.js';
  const DATA = 'https://cdn.klaten.go.id/data.json';
  try {
    const page = await iso.context.newPage();
    await page.evaluate(
      async (u) => {
        const img = (src: string) => Object.assign(document.createElement('img'), { src });
        document.body.append(img(u.GAMBAR), img(u.LAIN));
        document.head.append(
          Object.assign(document.createElement('link'), { rel: 'stylesheet', href: u.STYLE }),
        );
        document.head.append(Object.assign(document.createElement('script'), { src: u.SKRIP }));
        await fetch(u.DATA, { mode: 'no-cors', cache: 'no-store' }).catch(() => undefined);
      },
      { GAMBAR, STYLE, LAIN, SKRIP, DATA },
    );
    await expect.poll(() => gagal.size, { timeout: 10_000 }).toBeGreaterThanOrEqual(5);
    // Gambar/style subdomain pemda sesi: lolos rute dan proxy (gagal hanya karena proxy hulu tiruan).
    for (const u of [GAMBAR, STYLE]) expect(gagal.get(u), u).not.toMatch(/ERR_BLOCKED_BY_CLIENT/);
    expect(connect).toContain('cdn.klaten.go.id:443');
    expect(connect).toContain('cdn.dukcapil.klaten.go.id:443');
    // Pemda lain, skrip, dan fetch ke subdomain yang sama: dibatalkan di peramban.
    for (const u of [LAIN, SKRIP, DATA]) expect(gagal.get(u), u).toMatch(/^net::ERR_BLOCKED_BY_CLIENT/);
    expect(connect.some((c) => c.startsWith('cdn.slemankab.go.id'))).toBe(false);
  } finally {
    await iso.close();
    hulu.close();
  }
});

/** Server http lokal (origin fixture terdaftar) dengan rute tetap + WebSocket; `hit` per jalur. */
async function serverLokal(rute: Record<string, (res: http.ServerResponse) => void>) {
  const hit = new Map<string, number>();
  const s = http.createServer((req, res) => {
    const jalur = new URL(req.url ?? '/', 'http://x').pathname;
    hit.set(jalur, (hit.get(jalur) ?? 0) + 1);
    req.resume();
    req.on('end', () => {
      const f = rute[jalur];
      if (f) return f(res);
      res.writeHead(404).end();
    });
  });
  const wss = new WebSocketServer({ noServer: true });
  let ws = 0;
  s.on('upgrade', (req, socket, head) => {
    ws++;
    wss.handleUpgrade(req, socket, head, (c) => c.send('halo'));
  });
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok));
  return {
    origin: `http://127.0.0.1:${(s.address() as net.AddressInfo).port}`,
    hit: (j: string) => hit.get(j) ?? 0,
    ws: () => ws,
    tutup: () => {
      wss.close();
      s.closeAllConnections();
      s.close();
    },
  };
}

/** Proxy hulu tiruan: setiap CONNECT dicatat lalu ditolak 502 (tidak pernah sampai ke situs asli). */
async function huluTiruan() {
  const connect: string[] = [];
  const hulu = http.createServer();
  hulu.on('connect', (req, socket) => {
    connect.push(req.url ?? '');
    socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
  });
  await new Promise<void>((ok) => hulu.listen(0, '127.0.0.1', ok));
  return {
    url: `http://127.0.0.1:${(hulu.address() as net.AddressInfo).port}`,
    connect,
    tutup: () => hulu.close(),
  };
}

test('review gel5 3310: hop redirect 302/307 (skrip, dokumen, POST, apex) ke host saudara pemda tidak pernah lolos proxy', async () => {
  const alih =
    (lokasi: string, status = 302) =>
    (res: http.ServerResponse) =>
      void res.writeHead(status, { location: lokasi, 'cache-control': 'no-store' }).end();
  const lokal = await serverLokal({
    '/awal': (res) =>
      void res
        .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        .end(
          '<!doctype html><title>Awal</title><img src="https://cdn.klaten.go.id/logo.png">' +
            '<script src="/alih-skrip"></script><script src="/alih-apex"></script>',
        ),
    '/alih-skrip': alih('https://x.klaten.go.id/app.js'),
    '/alih-apex': alih('https://klaten.go.id/app.js'),
    '/alih-dok': alih('https://x.klaten.go.id/'),
    '/alih-post': alih('https://x.klaten.go.id/terima', 307),
  });
  const hulu = await huluTiruan();
  const config = loadConfig({
    PENDAMPING_FIXTURE_ORIGINS: `${FIXTURE_ORIGIN},${lokal.origin}`,
    PENDAMPING_HEADLESS: '1',
    PENDAMPING_UPSTREAM_PROXY: hulu.url,
  });
  const iso = await launchIsolated(config, { lebar: 390, tinggi: 844, dpr: 1, seluler: true }, [
    'sakura.dukcapil.klaten.go.id',
  ]);
  try {
    const page = await iso.context.newPage();
    await page.goto(`${lokal.origin}/awal`);
    await page.evaluate(
      (u) => fetch(u, { method: 'POST', body: 'x', mode: 'no-cors' }).catch(() => undefined),
      `${lokal.origin}/alih-post`,
    );
    await page.goto(`${lokal.origin}/alih-dok`).catch(() => undefined);
    // Gambar subdomain pemda: disetujui rute, lalu lolos proxy (sampai hulu tiruan).
    await expect.poll(() => hulu.connect, { timeout: 10_000 }).toContain('cdn.klaten.go.id:443');
    for (const j of ['/alih-skrip', '/alih-apex', '/alih-dok', '/alih-post']) expect(lokal.hit(j), j).toBe(1);
    // Hop redirect tidak melewati rute: host saudara yang belum disetujui dan apex pemda ditolak proxy.
    await new Promise((ok) => setTimeout(ok, 1_000));
    expect(hulu.connect.filter((c) => c !== 'cdn.klaten.go.id:443')).toEqual([]);
  } finally {
    await iso.close();
    hulu.tutup();
    lokal.tutup();
  }
});

test('review gel5: WebSocket sesi adapter hanya ke host:port allowlist sesi, selebihnya ditutup (termasuk host aset pemda)', async () => {
  const lokal = await serverLokal({
    '/awal': (res) =>
      void res
        .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        .end('<!doctype html><title>WS</title><img src="https://cdn.klaten.go.id/logo.png">'),
  });
  const lain = await serverLokal({});
  const hulu = await huluTiruan();
  const config = loadConfig({
    PENDAMPING_FIXTURE_ORIGINS: `${FIXTURE_ORIGIN},${lokal.origin}`,
    PENDAMPING_HEADLESS: '1',
    PENDAMPING_UPSTREAM_PROXY: hulu.url,
  });
  const iso = await launchIsolated(config, { lebar: 390, tinggi: 844, dpr: 1, seluler: true }, [
    'sakura.dukcapil.klaten.go.id',
  ]);
  try {
    const page = await iso.context.newPage();
    await page.goto(`${lokal.origin}/awal`);
    // Host aset pemda sudah disetujui (gambar): lolos proxy, tetapi BUKAN allowlist sesi untuk WebSocket.
    await expect.poll(() => hulu.connect, { timeout: 10_000 }).toContain('cdn.klaten.go.id:443');
    await new Promise((ok) => setTimeout(ok, 500));
    const sebelum = hulu.connect.length;
    const hasil = await page.evaluate(
      (urls) =>
        Promise.all(
          urls.map(
            (u) =>
              new Promise<string>((ok) => {
                const w = new WebSocket(u);
                w.onmessage = (e) => ok(`pesan:${String(e.data)}`);
                w.onclose = () => ok('tutup');
                setTimeout(() => ok('waktu-habis'), 8_000);
              }),
          ),
        ),
      [
        lokal.origin.replace('http:', 'ws:') + '/ws',
        lain.origin.replace('http:', 'ws:') + '/ws',
        'wss://cdn.klaten.go.id/ws',
      ],
    );
    expect(hasil).toEqual(['pesan:halo', 'tutup', 'tutup']);
    expect(lokal.ws()).toBe(1);
    expect(lain.ws()).toBe(0);
    await new Promise((ok) => setTimeout(ok, 1_000));
    // WebSocket ke host aset pemda ditutup di peramban: tidak ada CONNECT baru ke proxy.
    expect(hulu.connect.length).toBe(sebelum);
  } finally {
    await iso.close();
    hulu.tutup();
    lokal.tutup();
    lain.tutup();
  }
});

test('residu: profil sesi (cookie, Login Data) terhapus total setelah ditutup; pengelola sandi mati', async () => {
  const config = loadConfig({ PENDAMPING_FIXTURE_ORIGINS: FIXTURE_ORIGIN, PENDAMPING_HEADLESS: '1' });
  const iso = await launchIsolated(config, { lebar: 390, tinggi: 844, dpr: 1, seluler: true }, [
    'telunjuksakti.wonogirikab.go.id',
  ]);
  const dir = iso.userDataDir;
  try {
    const page = iso.context.pages()[0] ?? (await iso.context.newPage());
    await page.goto(`${FIXTURE_ORIGIN}/telunjuksakti/index.php/users/login`);
    await page.fill('#hp', TEST_HP);
    await page.fill('#captcha', 'DEV123');
    await page.click('#loginSubmit');
    await expect(page).toHaveURL(/\/welcome$/);
    expect((await iso.context.cookies()).length).toBeGreaterThan(0);
    expect(existsSync(dir)).toBe(true);
    const prefs = JSON.parse(readFileSync(join(dir, 'Default', 'Preferences'), 'utf8')) as {
      credentials_enable_service?: boolean;
      profile?: { password_manager_enabled?: boolean };
    };
    expect(prefs.credentials_enable_service).toBe(false);
    expect(prefs.profile?.password_manager_enabled).toBe(false);
  } finally {
    await iso.close();
  }
  expect(existsSync(join(dir, 'Default', 'Login Data'))).toBe(false);
  expect(existsSync(dir)).toBe(false);
});

test('pengawas memori: sesi di atas anggaran dihentikan, warga diarahkan ke panduan, slot dibebaskan', async () => {
  const config = {
    ...loadConfig({
      PENDAMPING_FIXTURE_ORIGINS: FIXTURE_ORIGIN,
      PENDAMPING_ORIGIN_OVERRIDES: `https://telunjuksakti.wonogirikab.go.id=${FIXTURE_ORIGIN}`,
      PENDAMPING_HEADLESS: '1',
    }),
    sessionMemMb: 0,
    memCheckMs: 300,
  };
  const manager = new SessionManager(config, createBrowserFactory(config));
  const o = { urusanId: 'u-mem', sidHash: SID };
  await manager.create({
    ...o,
    executionId: 'x_mem',
    adapterId: 'telunjuk-sakti-wonogiri',
    flowId: 'ajukan',
    origin: 'https://telunjuksakti.wonogirikab.go.id',
    params: { layanan_id: 1 },
  });
  await expect.poll(() => manager.status(o).status, { timeout: 30_000 }).toBe('dipandu');
  expect(manager.status(o).hasil).toBe('drift');
  // Pesan warga jelas dan menuju panduan; angka MB hanya di log operator.
  expect(manager.status(o).pesan).toBe(PESAN_MEMORI);
  expect(manager.status(o).pesan).not.toMatch(/\d+ MB/);
  // Slot dibebaskan setelah Chromium (dengan sandbox: lebih banyak proses) selesai ditutup.
  await expect.poll(() => manager.antrean(), { timeout: 10_000 }).toEqual({ aktif: 0, maks: 2, menunggu: 0 });
  await manager.shutdown();
});

/** Jumlah piksel gelap (teks/kendali) di frame JPEG: halaman about:blank = 0. */
async function pikselGelap(page: Page, jpeg: Uint8Array): Promise<number> {
  await page.setContent('<canvas id="c"></canvas>');
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/jpeg;base64,${b64}`;
    await img.decode();
    const c = document.getElementById('c') as HTMLCanvasElement;
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i]! + d[i + 1]! + d[i + 2]! < 300) n++;
    return n;
  }, Buffer.from(jpeg).toString('base64'));
}

test('portal tampil SEBELUM izin isi; menolak izin = warga memegang portal yang sudah terbuka', async ({
  page,
}) => {
  const config = loadConfig({
    PENDAMPING_FIXTURE_ORIGINS: FIXTURE_ORIGIN,
    PENDAMPING_ORIGIN_OVERRIDES: `https://telunjuksakti.wonogirikab.go.id=${FIXTURE_ORIGIN}`,
    PENDAMPING_HEADLESS: '1',
  });
  const manager = new SessionManager(config, createBrowserFactory(config));
  const o = { urusanId: 'u-portal-dulu', sidHash: SID };
  try {
    const s = await manager.create({
      ...o,
      executionId: 'x_portal_dulu',
      adapterId: 'telunjuk-sakti-wonogiri',
      flowId: 'ajukan',
      origin: 'https://telunjuksakti.wonogirikab.go.id',
      params: { layanan_id: 11 },
      modeUji: true,
    });
    await expect.poll(() => manager.status(o).status, { timeout: 30_000 }).toBe('menunggu_data');
    const pesan: { type: string }[] = [];
    const frame: Uint8Array[] = [];
    const viewer = {
      send: (m: { type: string }) => void pesan.push(m),
      frame: (f: { jpeg: Uint8Array }) => void frame.push(f.jpeg),
      ack: () => {},
      close: () => {},
    };
    await manager.attach(s.sesiId, viewer as never);
    // Izin diminta, dan yang tampil di layar warga sudah halaman portal (bukan about:blank putih).
    expect(pesan.map((m) => m.type)).toContain('butuh_data');
    await expect.poll(() => frame.length, { timeout: 15_000 }).toBeGreaterThan(0);
    expect(await pikselGelap(page, frame.at(-1)!)).toBeGreaterThan(50);
    // "Saya isi sendiri": kendali ke warga, sesi tetap hidup di portal yang sama.
    await manager.handleClient(s.sesiId, { type: 'ambil_alih' });
    expect(manager.status(o)).toMatchObject({ mode: 'takeover' });
    expect(['menunggu_data', 'berjalan']).toContain(manager.status(o).status);
  } finally {
    await manager.shutdown();
  }
});

test('langkah 0 tak bisa membuka situs (CONNECT ditolak) -> gagal dengan alasan jaringan yang jelas', async () => {
  // Replika https di port tertutup: proxy egress menjawab CONNECT dengan 502, Chromium menampilkan halaman
  // galat (net::ERR_TUNNEL_CONNECTION_FAILED), persis pola produksi bila edge tidak bisa tersambung.
  const kosong = http.createServer();
  await new Promise<void>((ok) => kosong.listen(0, '127.0.0.1', ok));
  const port = (kosong.address() as net.AddressInfo).port;
  await new Promise<void>((ok) => kosong.close(() => ok()));
  const tutup = `https://127.0.0.1:${port}`;
  const config = loadConfig({
    PENDAMPING_FIXTURE_ORIGINS: tutup,
    PENDAMPING_ORIGIN_OVERRIDES: `https://telunjuksakti.wonogirikab.go.id=${tutup}`,
    PENDAMPING_HEADLESS: '1',
  });
  const manager = new SessionManager(config, createBrowserFactory(config));
  const o = { urusanId: 'u-nav-gagal', sidHash: SID };
  await manager.create({
    ...o,
    executionId: 'x_nav',
    adapterId: 'telunjuk-sakti-wonogiri',
    flowId: 'ajukan',
    origin: 'https://telunjuksakti.wonogirikab.go.id',
    params: { layanan_id: 1 },
    modeUji: true,
  });
  // Halaman awal dibuka SEBELUM izin isi: situs tidak terjangkau = sesi berakhir jujur, tanpa lembar izin dan
  // tanpa kanvas putih.
  await expect.poll(() => manager.status(o).status, { timeout: 30_000 }).toBe('gagal');
  const pesan = manager.status(o).pesan ?? '';
  expect(pesan).toContain(`Halaman 127.0.0.1:${port} tidak bisa dibuka`);
  expect(pesan).toMatch(/net::ERR_[A-Z_]+/);
  expect(pesan).not.toContain('berhenti dengan aman');
  await manager.shutdown();
});
