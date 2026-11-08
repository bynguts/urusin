import { chromium, type Page } from '@playwright/test';
import { css, extract, gate, nav, textIncludes, urlIncludes, waitFor } from '@urusin/core';
import { APP_ORIGIN, CDP_PORT, expect, FIXTURE_ORIGIN, PINNED_EXTENSION_ID, test } from './fixtures';

type Reply = {
  ok: boolean;
  code?: string;
  cursor?: {
    status: string;
    stepIndex: number;
    message?: string;
    results: Record<string, unknown>;
  };
  type?: string;
};

const BASE = '/telunjuksakti/index.php';

/** Kirim pesan dari halaman web app (origin yang cocok externally_connectable) ke ekstensi. */
const send = (page: Page, extensionId: string, msg: object) =>
  page.evaluate(([id, m]) => chrome.runtime.sendMessage(id as string, m), [
    extensionId,
    msg,
  ] as const) as Promise<Reply>;

test('ekstensi: ID dipin, pairing via fragment, ping, dan eksekusi status-read ke fixture', async ({
  context,
  extensionId,
}) => {
  // 1. ID ekstensi identik dengan yang tercatat di .env.example (kunci manifest dipin).
  expect(extensionId).toBe(PINNED_EXTENSION_ID);

  // 2. Popup (user gesture) memulai pairing: membuka ORIGIN/pair#nonce=... pada web app sungguhan,
  //    yang membaca nonce dari fragment, menghapusnya dari URL, lalu pair + ping.
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const [appPage] = await Promise.all([
    context.waitForEvent('page'),
    popup.getByRole('button', { name: `Hubungkan ke ${APP_ORIGIN}` }).click(),
  ]);
  await expect(appPage.locator('[data-status]')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  expect(appPage.url()).toBe(`${APP_ORIGIN}/pair`); // fragment sudah dihapus dari URL
  const nonce = (await appPage.evaluate(() => sessionStorage.getItem('urusin.pair.nonce'))) ?? '';
  expect(nonce).toMatch(/^[0-9a-f]{64}$/);

  const call = (msg: object) => send(appPage, extensionId, msg);
  async function pollStatus(want: string) {
    await expect
      .poll(
        async () => {
          const c = (await call({ type: 'status', nonce })).cursor;
          if (c?.status === 'error') throw new Error('eksekusi error: ' + JSON.stringify(c));
          return c?.status;
        },
        { timeout: 30_000 },
      )
      .toBe(want);
  }

  // 3. Nonce sekali pakai; ping hanya dari origin ter-pairing dengan nonce yang cocok.
  expect(await call({ type: 'pair', nonce })).toMatchObject({ ok: false });
  expect(await call({ type: 'ping', nonce })).toMatchObject({ ok: true, type: 'pong', origin: APP_ORIGIN });
  expect(await call({ type: 'ping', nonce: 'salah' })).toMatchObject({
    ok: false,
    code: 'NONCE_MISMATCH',
  });

  // 4. ExecutionRequest status-read: login oleh warga (gate.human), lalu baca Daftar Permohonan.
  const request = {
    executionId: 'e2e-status-1',
    origin: FIXTURE_ORIGIN,
    steps: [
      nav(`${BASE}/users/login`),
      gate.human('Login sendiri (HP + CAPTCHA), lalu tekan Masuk', { until: urlIncludes('/welcome') }),
      nav(`${BASE}/welcome/permohonan`),
      waitFor(textIncludes('Daftar Permohonan')),
      extract('table', css('#tblPermohonan'), 'permohonan'),
    ],
  };

  // Mode Uji mati: origin fixture ditolak (domain allowlist).
  expect(await call({ type: 'execute', nonce, request })).toMatchObject({
    ok: false,
    code: 'DOMAIN_NOT_ALLOWED',
  });

  // Mode Uji dinyalakan HANYA dari popup.
  const popup2 = await context.newPage(); // popup pertama menutup dirinya setelah memulai pairing
  await popup2.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup2.getByLabel('Mode Uji').check();
  await expect(popup2.locator('#banner')).toBeVisible();

  const [govPage] = await Promise.all([
    context.waitForEvent('page'),
    call({ type: 'execute', nonce, request }).then((r) => expect(r.ok).toBe(true)),
  ]);

  // 5. Berhenti di gate: warga mengetik HP + CAPTCHA sendiri (kode uji tercetak di halaman) dan menekan Masuk.
  await expect(govPage.locator('#hp')).toBeVisible({ timeout: 15_000 });
  await pollStatus('waiting_gate');
  expect((await call({ type: 'status', nonce })).cursor?.message).toContain('Login sendiri');

  // Service worker dimatikan di tengah gate: event navigasi berikutnya membangunkannya dan eksekusi lanjut dari cursor.
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  const cdp = await browser.newBrowserCDPSession();
  const workers = async () =>
    (await cdp.send('Target.getTargets')).targetInfos.filter(
      (t) => t.type === 'service_worker' && t.url.includes(extensionId),
    );
  const [worker] = await workers();
  expect(worker).toBeDefined();
  await cdp.send('Target.closeTarget', { targetId: worker!.targetId });
  await expect.poll(async () => (await workers()).length).toBe(0);

  const [hp, captcha] = await govPage.locator('.note code').allTextContents();
  await govPage.fill('#hp', hp!);
  await govPage.fill('#captcha', captcha!);
  await govPage.click('#loginSubmit');

  // 6. Gate terpenuhi -> nav permohonan -> extract; hasil sampai ke web app. Bukti: SW yang tadi mati
  //    sudah dibangunkan event navigasi.
  await pollStatus('done');
  await expect.poll(async () => (await workers()).length).toBe(1);
  await browser.close();

  const final = await call({ type: 'status', nonce });
  expect(final.cursor?.results.permohonan).toEqual({
    headers: ['No', 'Layanan', 'Tanggal', 'Status'],
    rows: [['1', 'Layanan Contoh A', '2026-01-02', 'Diproses (data uji)']],
  });
  expect(govPage.url()).toBe(`${FIXTURE_ORIGIN}${BASE}/welcome/permohonan`);
});
