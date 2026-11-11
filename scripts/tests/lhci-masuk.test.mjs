import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const masuk = require('../lhci-masuk.cjs');
const { ROUTES, RUTE_MASUK } = require('../../perf-routes.cjs');

const AKUN = '__Host-urusin_akun';
const ASAL = 'http://127.0.0.1:4173';

/** Peramban palsu: satu jar cookie, halaman yang `fetch`-nya mencatat panggilan dan memasang cookie akun. */
function peramban({ status = 200 } = {}) {
  const jar = [{ name: '__Host-urusin_sid', value: 'sid', domain: '127.0.0.1', path: '/' }];
  const log = [];
  const konteks = {
    cookies: async () => jar.map((c) => ({ ...c })),
    setCookie: async (...cs) => {
      log.push(['set', ...cs.map((c) => c.name)]);
      for (const c of cs) jar.push({ ...c });
    },
    deleteCookie: async (...cs) => {
      log.push(['hapus', ...cs.map((c) => c.name)]);
      for (const c of cs)
        jar.splice(
          jar.findIndex((k) => k.name === c.name),
          1,
        );
    },
  };
  let token = 0;
  const browser = {
    defaultBrowserContext: () => konteks,
    newPage: async () => ({
      goto: async (url) => log.push(['goto', url]),
      evaluate: async () => {
        log.push(['login']);
        if (status === 200)
          jar.push({
            name: AKUN,
            value: `t${++token}`,
            domain: '127.0.0.1',
            path: '/',
            secure: true,
            httpOnly: true,
          });
        return `${status} {}`;
      },
      close: async () => log.push(['tutup']),
    }),
  };
  return { browser, jar, log };
}

describe('perf-routes RUTE_MASUK', () => {
  it('setiap rute masuk juga diukur (ada di ROUTES) dan /beranda termasuk', () => {
    for (const r of RUTE_MASUK) assert.ok(ROUTES.includes(r), r);
    assert.ok(RUTE_MASUK.includes('/beranda'));
    assert.ok(!RUTE_MASUK.includes('/masuk') && !RUTE_MASUK.includes('/'));
  });
});

describe('lhci-masuk (puppeteerScript)', () => {
  it('rute tamu tanpa cookie akun: tidak login, tidak menyentuh cookie', async () => {
    const { browser, log } = peramban();
    await masuk(browser, { url: `${ASAL}/` });
    assert.deepEqual(log, []);
  });

  it('login akun demo sekali lewat endpoint juri, lalu tamu melepas cookie dan rute dasbor memakainya lagi', async () => {
    const { browser, jar, log } = peramban();
    await masuk(browser, { url: `${ASAL}/beranda` });
    assert.deepEqual(log, [['goto', `${ASAL}/api/health`], ['login'], ['tutup']]);
    assert.equal(jar.find((c) => c.name === AKUN)?.value, 't1');

    await masuk(browser, { url: `${ASAL}/urusanku` });
    assert.equal(log.length, 3, 'cookie masih ada: tidak login ulang');

    await masuk(browser, { url: `${ASAL}/masuk` });
    assert.deepEqual(log.at(-1), ['hapus', AKUN]);
    assert.ok(!jar.some((c) => c.name === AKUN), 'halaman tamu diukur tanpa sesi akun');
    assert.ok(
      jar.some((c) => c.name === '__Host-urusin_sid'),
      'cookie lain tidak disentuh',
    );

    await masuk(browser, { url: `${ASAL}/data-diri` });
    assert.deepEqual(log.at(-1), ['set', AKUN]);
    assert.equal(
      jar.find((c) => c.name === AKUN)?.value,
      't1',
      'sesi yang sama dipakai ulang, tanpa akun demo baru',
    );
    assert.equal(log.filter(([k]) => k === 'login').length, 1);
  });
});

describe('lhci-masuk gagal keras', () => {
  it('login ditolak server -> galat (bukan diam-diam mengukur /masuk)', async () => {
    // Modul baru (cache require dihapus) supaya sesi dari tes sebelumnya tidak dipakai.
    delete require.cache[require.resolve('../lhci-masuk.cjs')];
    const segar = require('../lhci-masuk.cjs');
    const { browser } = peramban({ status: 403 });
    await assert.rejects(segar(browser, { url: `${ASAL}/beranda` }), /login akun demo gagal: 403/);
  });
});
