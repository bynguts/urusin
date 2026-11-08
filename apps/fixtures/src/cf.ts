import type { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { html, page } from './layout.js';

/**
 * Tiruan halaman antara tantangan bot (gaya Cloudflare "Just a moment") untuk menguji takeover
 * `verifikasi_situs` Browser Pendamping. BUKAN Cloudflare dan tidak meniru mekanismenya: hanya bentuk luarnya
 * (status 403, header `cf-mitigated: challenge`, judul, iframe di jalur challenge-platform) dan sebuah tombol
 * yang harus diketuk manusia.
 * - `/uji-cf/`: ketukan diterima -> cookie lolos -> halaman cek status (ada kolom `#nopol`).
 * - `/uji-cf/gagal/`: ketukan tidak pernah diterima -> tantangan dimuat ulang (loop).
 */
export const JALUR_WIDGET = '/cdn-cgi/challenge-platform/uji/';
const COOKIE = 'uji_cf';
const KEMBALI = ['/uji-cf/', '/uji-cf/gagal/'] as const;

export function registerUjiCf(app: Hono): void {
  for (const jalur of KEMBALI) {
    app.get(jalur, (c) => {
      if (jalur === '/uji-cf/' && getCookie(c, COOKIE) === 'lolos')
        return c.html(
          page(
            'Cek status kendaraan (uji)',
            html`<h1>Cek status kendaraan</h1>
              <p id="lolos">Verifikasi situs selesai.</p>
              <label for="nopol">Nomor polisi</label>
              <input id="nopol" name="nopol" autocomplete="off" />`,
          ),
        );
      c.header('cf-mitigated', 'challenge');
      return c.html(
        page(
          'Just a moment...',
          html`<p>Memeriksa bahwa Anda manusia (tiruan halaman tantangan).</p>
            <iframe
              title="Verifikasi"
              src="${JALUR_WIDGET}?kembali=${encodeURIComponent(jalur)}"
              width="300"
              height="90"
              style="border:1px solid #888"
            ></iframe>`,
        ),
        403,
      );
    });
  }

  app.get(JALUR_WIDGET, (c) => {
    const kembali = c.req.query('kembali') ?? '';
    if (!(KEMBALI as readonly string[]).includes(kembali)) return c.text('kembali tidak sah', 400);
    return c.html(
      html`<!doctype html>
        <html lang="id">
          <head>
            <meta charset="utf-8" />
            <title>Widget verifikasi (fixture)</title>
          </head>
          <body style="margin:0;font-family:system-ui,sans-serif">
            <form method="post" action="${JALUR_WIDGET}" target="_top" style="margin:0">
              <input type="hidden" name="kembali" value="${kembali}" />
              <button id="saya-manusia" type="submit" style="width:300px;height:90px;font-size:18px">
                Saya manusia
              </button>
            </form>
          </body>
        </html>`,
    );
  });

  app.post(JALUR_WIDGET, async (c) => {
    const form = await c.req.parseBody();
    const kembali = String(form.kembali ?? '');
    if (!(KEMBALI as readonly string[]).includes(kembali)) return c.text('kembali tidak sah', 400);
    if (kembali === '/uji-cf/') setCookie(c, COOKIE, 'lolos', { path: '/', httpOnly: true, sameSite: 'Lax' });
    return c.redirect(kembali, 303);
  });
}
