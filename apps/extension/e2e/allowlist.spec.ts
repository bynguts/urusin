import { css, extract, nav, textIncludes, waitFor } from '@urusin/core';
import { expect, FIXTURE_ORIGIN, pairExtension, setTestMode, test } from './fixtures';

const AT = '@';
// Tidak ada satu pun origin di sini yang benar-benar dihubungi: ekstensi harus menolak SEBELUM membuka tab.
const REFUSED_ORIGINS = [
  'https://telunjuksakti.wonogirikab.go.id.evil.example', // sufiks jebakan
  'https://t\u0435lunjuksakti.wonogirikab.go.id', // homoglyph Cyrillic
  'http://telunjuksakti.wonogirikab.go.id', // bukan https
  'https://telunjuksakti.wonogirikab.go.id:8443', // port non-standar
  `https://user${AT}telunjuksakti.wonogirikab.go.id`, // userinfo
  'https://collector.invalid',
  'http://localhost:4321', // localhost, tetapi bukan origin fixture
  `${FIXTURE_ORIGIN}${AT}collector.invalid`, // fixture sebagai userinfo
];

const readCatalog = (origin: string) => ({
  executionId: 'e2e-allowlist',
  origin,
  steps: [
    nav('/sby/app/services'),
    waitFor(textIncludes('Katalog layanan publik')),
    extract('table', css('#tblServices'), 'katalog'),
  ],
});

test('ekstensi menolak origin di luar allowlist, juga saat Mode Uji menyala, tanpa membuka tab', async ({
  context,
  extensionId,
}) => {
  const { call } = await pairExtension(context, extensionId);
  await setTestMode(context, extensionId, true);

  const pagesBefore = context.pages().length;
  for (const origin of REFUSED_ORIGINS) {
    expect(await call({ type: 'execute', request: readCatalog(origin) }), origin).toMatchObject({
      ok: false,
      code: expect.stringMatching(/^(DOMAIN_NOT_ALLOWED|ORIGIN_INVALID)$/) as unknown as string,
    });
  }
  expect(context.pages().length).toBe(pagesBefore);
  expect((await call({ type: 'status' })).cursor).toBeNull();
});

test('Mode Uji hanya mengaktifkan origin fixture: mati = fixture ditolak, nyala = fixture jalan, lalu mati lagi', async ({
  context,
  extensionId,
}) => {
  const { call } = await pairExtension(context, extensionId);
  const request = readCatalog(FIXTURE_ORIGIN);

  // Mode Uji mati (default): origin fixture ditolak.
  expect(await call({ type: 'execute', request })).toMatchObject({ ok: false, code: 'DOMAIN_NOT_ALLOWED' });

  // Mode Uji nyala: fixture diterima dan replika Surabaya terbaca.
  await setTestMode(context, extensionId, true);
  const [govPage] = await Promise.all([
    context.waitForEvent('page'),
    call({ type: 'execute', request }).then((r) => expect(r.ok).toBe(true)),
  ]);
  await expect
    .poll(async () => (await call({ type: 'status' })).cursor?.status, { timeout: 30_000 })
    .toBe('done');
  const rows = ((await call({ type: 'status' })).cursor?.results.katalog as { rows: string[][] }).rows;
  expect(rows).toHaveLength(8);
  expect(rows.map((r) => r[0])).toContain('Pindah Datang');
  expect(govPage.url()).toBe(`${FIXTURE_ORIGIN}/sby/app/services`);

  // Mode Uji dimatikan lagi: fixture kembali ditolak.
  await setTestMode(context, extensionId, false);
  expect(
    await call({ type: 'execute', request: { ...request, executionId: 'e2e-allowlist-2' } }),
  ).toMatchObject({
    ok: false,
    code: 'DOMAIN_NOT_ALLOWED',
  });
});
