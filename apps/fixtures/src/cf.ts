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
 * - `/uji-cf/lintas/`: seperti `/uji-cf/`, tetapi widget dimuat dari origin LAIN (127.0.0.1:P <-> localhost:P,
 *   beda situs -> iframe lintas-proses, seperti challenges.cloudflare.com di situs asli). Membuktikan klik warga
 *   yang diteruskan lewat CDP sampai ke iframe lintas-origin. Di luar loopback jatuh ke widget same-origin.
 */
export const JALUR_WIDGET = '/cdn-cgi/challenge-platform/uji/';
export const JALUR_LINTAS = '/uji-cf/lintas/';
/**
 * Varian kotak centang (HANYA profil local/e2e): halaman antara "Performing security verification" berstatus 200
 * TANPA header cf-mitigated (deteksi lewat judul + iframe saja), widget berisi kotak centang yang mengirim form
 * saat dicentang manusia (skrip eksternal same-origin, bukan otomatis). Tanpa logo/merek pihak ketiga.
 */
export const JALUR_KOTAK = '/uji-cf/kotak/';
const JALUR_KOTAK_JS = `${JALUR_WIDGET}kotak.js`;
const COOKIE = 'uji_cf';
const KEMBALI_DASAR = ['/uji-cf/', '/uji-cf/gagal/', JALUR_LINTAS] as const;

/** Origin pasangan lintas-situs untuk Host loopback: 127.0.0.1:P <-> localhost:P; null bila bukan loopback. */
export function originLintas(host: string | undefined): string | null {
  const m = /^(127\.0\.0\.1|localhost):(\d{2,5})$/.exec(host ?? '');
  if (!m) return null;
  return `http://${m[1] === 'localhost' ? '127.0.0.1' : 'localhost'}:${m[2]}`;
}

/** `asal` (origin halaman induk) sah hanya bila persis pasangan lintas Host ini. */
export function asalSah(asal: string | undefined, host: string | undefined): string | null {
  const pasangan = originLintas(host);
  return pasangan && asal === pasangan ? pasangan : null;
}

const halamanLolos = () =>
  page(
    'Cek status kendaraan (uji)',
    html`<h1>Cek status kendaraan</h1>
      <p id="lolos">Verifikasi situs selesai.</p>
      <label for="nopol">Nomor polisi</label>
      <input id="nopol" name="nopol" autocomplete="off" />`,
  );

/** `kotak`: daftarkan varian kotak centang (profil local saja). */
export function registerUjiCf(app: Hono, { kotak = false }: { kotak?: boolean } = {}): void {
  const KEMBALI: readonly string[] = kotak ? [...KEMBALI_DASAR, JALUR_KOTAK] : KEMBALI_DASAR;
  if (kotak) {
    app.get(JALUR_KOTAK, (c) => {
      if (getCookie(c, COOKIE) === 'lolos') return c.html(halamanLolos());
      return c.html(
        page(
          'Performing security verification',
          html`<h1>Verifikasi keamanan</h1>
            <p>Halaman tiruan untuk pengujian (bukan layanan pihak ketiga). Centang kotak di bawah.</p>
            <iframe
              title="Verifikasi"
              src="${JALUR_WIDGET}?kembali=${encodeURIComponent(JALUR_KOTAK)}&jenis=kotak"
              width="300"
              height="70"
              style="border:1px solid #888"
            ></iframe>`,
        ),
      );
    });
    app.get(JALUR_KOTAK_JS, (c) =>
      c.body(
        "document.getElementById('kotak-manusia').addEventListener('change', (e) => e.target.form.submit());\n",
        200,
        { 'content-type': 'text/javascript; charset=utf-8' },
      ),
    );
  }

  for (const jalur of KEMBALI_DASAR) {
    app.get(jalur, (c) => {
      if (jalur !== '/uji-cf/gagal/' && getCookie(c, COOKIE) === 'lolos') return c.html(halamanLolos());
      c.header('cf-mitigated', 'challenge');
      const host = c.req.header('host');
      const lintas = jalur === JALUR_LINTAS ? originLintas(host) : null;
      const src = lintas
        ? `${lintas}${JALUR_WIDGET}?kembali=${encodeURIComponent(jalur)}&asal=${encodeURIComponent(`http://${host}`)}`
        : `${JALUR_WIDGET}?kembali=${encodeURIComponent(jalur)}`;
      return c.html(
        page(
          'Just a moment...',
          html`<p>Memeriksa bahwa Anda manusia (tiruan halaman tantangan).</p>
            <iframe
              title="Verifikasi"
              src="${src}"
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
    if (!KEMBALI.includes(kembali)) return c.text('kembali tidak sah', 400);
    const asal = asalSah(c.req.query('asal'), c.req.header('host'));
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
              ${asal ? html`<input type="hidden" name="asal" value="${asal}" />` : ''}
              ${
                kembali === JALUR_KOTAK
                  ? html`<label
                      style="display:flex;align-items:center;gap:12px;height:70px;padding:0 16px;font-size:16px"
                    >
                      <input id="kotak-manusia" type="checkbox" style="width:28px;height:28px" />
                      Verify you are human
                    </label>`
                  : html`<button
                      id="saya-manusia"
                      type="submit"
                      style="width:300px;height:90px;font-size:18px"
                    >
                      Saya manusia
                    </button>`
              }
            </form>
            ${kembali === JALUR_KOTAK ? html`<script src="${JALUR_KOTAK_JS}"></script>` : ''}
          </body>
        </html>`,
    );
  });

  app.post(JALUR_WIDGET, async (c) => {
    const form = await c.req.parseBody();
    const kembali = String(form.kembali ?? '');
    if (!KEMBALI.includes(kembali)) return c.text('kembali tidak sah', 400);
    // Widget lintas-origin tidak bisa memasang cookie untuk origin induk: kembali lewat jalur lolos milik induk.
    const asal = asalSah(String(form.asal ?? ''), c.req.header('host'));
    if (kembali === JALUR_LINTAS && asal) return c.redirect(`${asal}${JALUR_LINTAS}lolos`, 303);
    if (kembali !== '/uji-cf/gagal/')
      setCookie(c, COOKIE, 'lolos', { path: '/', httpOnly: true, sameSite: 'Lax' });
    return c.redirect(kembali, 303);
  });

  app.get(`${JALUR_LINTAS}lolos`, (c) => {
    setCookie(c, COOKIE, 'lolos', { path: '/', httpOnly: true, sameSite: 'Lax' });
    return c.redirect(JALUR_LINTAS, 303);
  });
}
