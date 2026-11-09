import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';
import type net from 'node:net';
import { expect, test, type Page } from '@playwright/test';
import { byRole, click, css } from '@urusin/core';
import type { PendampingEvent, SesiPendamping, TiketPendampingResponse } from '@urusin/contracts';
import { createBrowserFactory, launchIsolated } from '../src/browser.js';
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

async function tungguGiliran(page: Page, alasan: 'login' | 'final') {
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
  await device.addCookies([{ name: 'urusin_sid', value: SID_MENTAH, url: PENDAMPING_ORIGIN }]);
  const page = await device.newPage();

  const created = await mulai('u-e2e-1');
  expect(created.status).toBe(201);
  const sesiId = created.data.sesiId;

  // Sesi kedua mengantre (PENDAMPING_MAX_SESSIONS=1): posisi terlihat oleh UI.
  const queued = await mulai('u-e2e-antre');
  expect(queued.data).toMatchObject({ status: 'antre', antrean: { posisi: 1 } });
  expect((await internal('/internal/antrean')).data).toEqual({ aktif: 1, maks: 1, menunggu: 1 });

  await bukaPenampil(page, 'u-e2e-1', sesiId);
  await expect(page.locator('#koneksi')).toHaveText('tersambung');
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { butuh?: unknown }).butuh))
    .toEqual({
      placeholder: ['{{PEMOHON.HP}}'],
      berkas: ['ktp', 'kk'],
    });

  // Vault perangkat -> memori sesi (placeholder di-resolve di batas eksekutor, bukan oleh LLM).
  await page.evaluate(
    async ([hp, png]) => {
      const v = (
        window as unknown as {
          viewer: { kirimVault(x: object): void; kirimBerkas(n: string, b: Blob, f: string): Promise<void> };
        }
      ).viewer;
      v.kirimVault({ '{{PEMOHON.HP}}': hp });
      const blob = new Blob([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], { type: 'image/png' });
      await v.kirimBerkas('ktp', blob, 'ktp.png');
      await v.kirimBerkas('kk', blob, 'kk.png');
    },
    [TEST_HP, PNG.toString('base64')] as const,
  );

  // AI mengisi HP lalu berhenti di CAPTCHA: wajib takeover.
  const login = await tungguGiliran(page, 'login');
  await expect(page.locator('#mode')).toHaveText('takeover');
  expect(login.sorot).toBeDefined();
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
  // Sampai di giliran final = kedua unggahan lolos pascakondisi adapter (jumlah .uploaded-item bertambah).
  const final = await tungguGiliran(page, 'final');
  expect((await internal('/internal/sesi/teks', owner('u-e2e-1'))).status).toBe(404);
  const langkah = (await peristiwa(page)).filter((e) => e.jenis === 'langkah');
  expect(langkah.map((e) => (e as { label: string }).label)).toContain('Mengunggah berkas');
  expect(JSON.stringify(await peristiwa(page))).not.toContain(TEST_HP);

  // Warga mengetuk "Selesai" (sentuh) di area sorotan: satu-satunya jalan pengiriman akhir.
  const f = final.sorot!;
  await page.touchscreen.tap(
    (await page.locator('#layar').boundingBox())!.x + f.x + f.lebar / 2,
    (await page.locator('#layar').boundingBox())!.y + f.y + f.tinggi / 2,
  );

  // Execution selesai: sesi siaga (peramban tetap hidup, warga membaca halaman), bukti dari tabel permohonan.
  await expect
    .poll(
      async () => (await internal<SesiPendamping>('/internal/sesi/status', owner('u-e2e-1'))).data.status,
      {
        timeout: 30_000,
      },
    )
    .toBe('siaga');
  const selesai = (await peristiwa(page)).find((e) => e.jenis === 'selesai');
  expect(selesai).toMatchObject({
    hasil: 'berhasil',
    bukti: { nomor: 'FX-REG-0002', status: 'Baru diajukan (data uji)' },
  });
  const siaga = await internal<SesiPendamping>('/internal/sesi/status', owner('u-e2e-1'));
  expect(siaga.data).toMatchObject({ status: 'siaga', hasil: 'berhasil', mode: 'takeover' });
  await expect(page.locator('#mode')).toHaveText('takeover');
  await expect(page.locator('#koneksi')).toHaveText('tersambung');

  // Warga menutup sesi: execution tetap berhasil; peramban dan data dihancurkan.
  await internal('/internal/sesi/akhiri', owner('u-e2e-1'));
  await expect(page.locator('#mode')).toHaveText('done', { timeout: 30_000 });
  await expect(page.locator('#koneksi')).toHaveText('selesai');
  const akhir = await internal<SesiPendamping>('/internal/sesi/status', owner('u-e2e-1'));
  expect(akhir.data).toMatchObject({ status: 'selesai', hasil: 'berhasil', mode: 'done' });

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

test('pengawas memori: sesi di atas anggaran dihentikan (gagal) dan slot dibebaskan', async () => {
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
  await expect.poll(() => manager.status(o).status, { timeout: 30_000 }).toBe('gagal');
  expect(manager.status(o).pesan).toContain('terlalu berat');
  expect(manager.antrean()).toEqual({ aktif: 0, maks: 2, menunggu: 0 });
  await manager.shutdown();
});
