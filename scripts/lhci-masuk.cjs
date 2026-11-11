// @ts-check
'use strict';
/**
 * puppeteerScript Lighthouse CI (lighthouserc.cjs): dipanggil sekali sebelum run setiap URL, di peramban
 * yang sama dengan yang diukur Lighthouse.
 *
 * - Rute di RUTE_MASUK (perf-routes.cjs) diukur sebagai warga yang sudah masuk: akun demo dibuat SEKALI per
 *   autorun lewat endpoint publik "Masuk sebagai juri" (POST /api/akun/juri) di server preview CI, lalu
 *   cookie sesinya dipakai ulang. Tanpa secret apa pun: Turnstile tidak dikonfigurasi di server CI, dan
 *   basis datanya sekali pakai.
 * - Rute lain diukur sebagai tamu: cookie sesi akun dilepas dulu (sesi di server tidak dicabut, jadi URL
 *   berikutnya yang butuh masuk cukup memasang cookie itu lagi).
 *
 * Lighthouse membersihkan cache dan storage origin di awal setiap run, tetapi tidak cookie, jadi keadaan
 * masuk/tamu bertahan untuk semua run URL itu.
 */
// lhci memuat puppeteerScript dengan require(), jadi berkas ini CommonJS seperti perf-routes.cjs.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { RUTE_MASUK } = require('../perf-routes.cjs');

const AKUN_COOKIE = '__Host-urusin_akun'; // apps/web/src/lib/server/akun.ts

/** @type {import('puppeteer-core').CookieData | null} */
let sesi = null;

/** @param {import('puppeteer-core').Browser} browser @param {{ url: string }} ctx */
module.exports = async (browser, { url }) => {
  const u = new URL(url);
  const konteks = browser.defaultBrowserContext();
  const ada = (await konteks.cookies()).filter((c) => c.name === AKUN_COOKIE);

  if (!RUTE_MASUK.includes(u.pathname)) {
    if (ada.length > 0) await konteks.deleteCookie(...ada);
    return;
  }
  if (ada.length > 0) return;
  if (sesi) {
    await konteks.setCookie(sesi);
    return;
  }

  const page = await browser.newPage();
  try {
    // Halaman JSON ringan di origin yang sama: fetch login membawa Origin + Sec-Fetch-Site yang diperiksa server.
    await page.goto(`${u.origin}/api/health`);
    const hasil = await page.evaluate(async () => {
      const r = await fetch('/api/akun/juri', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      return `${r.status} ${await r.text()}`;
    });
    if (!hasil.startsWith('200 ')) throw new Error(`lhci-masuk: login akun demo gagal: ${hasil}`);
  } finally {
    await page.close();
  }

  const c = (await konteks.cookies()).find((k) => k.name === AKUN_COOKIE);
  if (!c) throw new Error(`lhci-masuk: cookie ${AKUN_COOKIE} tidak terpasang setelah login`);
  sesi = {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expires: c.expires,
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite: c.sameSite,
  };
  process.stdout.write(`lhci-masuk: masuk sebagai akun demo (mulai ${u.pathname})\n`);
};
