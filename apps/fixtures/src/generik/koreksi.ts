import type { Hono } from 'hono';
import { html, page } from '../layout.js';
import {
  GENERIK,
  KOLOM,
  nomorPermohonan,
  renderKolom,
  sesiReplika,
  validasi,
  type Kolom,
  type OpsiGenerik,
} from './umum.js';
import { TEKS_PERNYATAAN } from './wizard.js';

/**
 * Replika (d) `koreksi` (hanya varian `dasar`): wizard tiga langkah di SATU halaman (langkah dibuka "Lanjut"
 * type=button, murni sisi klien, seperti portal SPA). Langkah 2 MENOLAK pilihan pertama yang lazim ("KK Baru
 * (Pecah KK)": kuota hari ini habis) dengan galat validasi di samping kolomnya (`aria-invalid` +
 * `aria-errormessage`, pilihan tetap terpilih) dan tidak maju; jenis lain diterima. Untuk uji periksa-sesudah-aksi
 * Navigator: AI harus mengoreksi kolom yang ditolak, bukan langsung menyerahkan ke warga. Langkah 3 = pernyataan +
 * tombol final "Kirim" (POST, milik warga); server memvalidasi ulang dan mencatat `koreksi.percobaan`/`kirim`.
 */
export const KOREKSI = `${GENERIK}/dasar/koreksi`;
export const OPSI_DITOLAK = 'KK Baru (Pecah KK)';
export const GALAT_KUOTA = `Kuota ${OPSI_DITOLAK} hari ini sudah habis. Pilih jenis permohonan lain.`;

const LANGKAH_1: readonly Kolom[] = [KOLOM.nik, KOLOM.nama];
const JENIS = KOLOM.jenisPermohonan;

const KOREKSI_JS = `(() => {
  const DITOLAK = ${JSON.stringify(OPSI_DITOLAK)};
  const GALAT = ${JSON.stringify(GALAT_KUOTA)};
  for (const b of document.querySelectorAll('[data-ke]')) {
    b.addEventListener('click', () => {
      const kini = b.closest('section');
      const ke = document.getElementById(b.dataset.ke);
      if (!kini || !ke) return;
      for (const el of kini.querySelectorAll('[required]')) {
        if (!el.checkValidity()) { el.reportValidity(); return; }
      }
      const jenis = kini.querySelector('#in-jenis');
      const galat = document.getElementById('in-jenis-galat');
      if (jenis && galat) {
        if (jenis.value === DITOLAK) {
          galat.textContent = GALAT;
          galat.hidden = false;
          jenis.setAttribute('aria-invalid', 'true');
          jenis.setAttribute('aria-errormessage', 'in-jenis-galat');
          return;
        }
        galat.hidden = true;
        galat.textContent = '';
        jenis.removeAttribute('aria-invalid');
        jenis.removeAttribute('aria-errormessage');
      }
      kini.hidden = true;
      ke.hidden = false;
    });
  }
})();`;

export function registerKoreksi(app: Hono, o: OpsiGenerik): void {
  const b = KOREKSI;
  const sesi = sesiReplika('fx_gen_koreksi', () => ({ buka: true }), o.secure);
  const terkirim: string[] = [];

  app.get(`${b}/static/koreksi.js`, (c) => c.body(KOREKSI_JS, 200, { 'Content-Type': 'text/javascript' }));

  app.get(`${b}/`, (c) =>
    c.html(
      page(
        'Permohonan Perubahan KK',
        html`<p>Ajukan permohonan dalam tiga langkah (replika uji).</p>
          <p><a href="${b}/formulir">Mulai Permohonan</a></p>`,
      ),
    ),
  );

  /** Dirender ulang server dengan galat (Kirim warga ditolak): semua langkah terbuka, galat di kolomnya. */
  const formulir = (galat: Record<string, string> = {}) => {
    const tersembunyi = Object.keys(galat).length ? '' : 'hidden';
    return page(
      'Permohonan Perubahan KK',
      html`${
          Object.keys(galat).length
            ? html`<p class="alert" role="alert">Lengkapi data yang ditandai.</p>`
            : ''
        }
        <form method="post" action="${b}/kirim">
          <section id="langkah-1">
            <h2>Langkah 1 dari 3: Identitas</h2>
            ${LANGKAH_1.map((k) => renderKolom(k, 'dasar', galat[k.kunci]))}
            <p><button type="button" data-ke="langkah-2" id="btn-lanjut-1">Lanjut</button></p>
          </section>
          <section id="langkah-2" ${tersembunyi}>
            <h2>Langkah 2 dari 3: Jenis Permohonan</h2>
            <div class="kolom">
              <label for="in-jenis">${JENIS.label[0]} *</label>
              <select id="in-jenis" name="${JENIS.kunci}" required>
                ${(JENIS.opsi ?? []).map((x, i) => html`<option value="${i === 0 ? '' : x}">${x}</option>`)}
              </select>
              ${
                galat[JENIS.kunci]
                  ? html`<small class="invalid-feedback" id="in-jenis-galat">${galat[JENIS.kunci]}</small>`
                  : html`<small class="invalid-feedback" id="in-jenis-galat" hidden></small>`
              }
            </div>
            <p><button type="button" data-ke="langkah-3" id="btn-lanjut-2">Lanjut</button></p>
          </section>
          <section id="langkah-3" ${tersembunyi}>
            <h2>Langkah 3 dari 3: Pernyataan</h2>
            <label><input type="checkbox" name="setuju" value="1" required /> ${TEKS_PERNYATAAN}</label>
            <p><button type="submit" id="btn-kirim">Kirim</button></p>
          </section>
        </form>
        <script src="${b}/static/koreksi.js"></script>`,
    );
  };

  app.get(`${b}/formulir`, (c) => {
    if (!sesi.ambil(c)) sesi.buat(c);
    return c.html(formulir());
  });

  app.post(`${b}/kirim`, async (c) => {
    o.hitung.catat('koreksi.percobaan');
    const body = await c.req.parseBody();
    const galat = validasi(LANGKAH_1, 'dasar', body);
    const jenis = typeof body[JENIS.kunci] === 'string' ? (body[JENIS.kunci] as string) : '';
    // Server memvalidasi ulang: pilihan yang ditolak di sisi klien juga ditolak di sini.
    if (!(JENIS.opsi as readonly string[]).slice(1).includes(jenis) || jenis === OPSI_DITOLAK)
      galat[JENIS.kunci] = GALAT_KUOTA;
    if (!sesi.ambil(c) || body.setuju !== '1' || Object.keys(galat).length)
      return c.html(formulir(galat), 422);
    o.hitung.catat('koreksi.kirim');
    terkirim.push(nomorPermohonan('KOREKSI', terkirim.length + 1));
    return c.redirect(`${b}/terkirim/${terkirim.length}`, 303);
  });

  app.get(`${b}/terkirim/:n`, (c) => {
    const nomor = terkirim[Number(c.req.param('n')) - 1];
    if (!nomor) return c.redirect(`${b}/`, 302);
    return c.html(
      page(
        'Permohonan Terkirim',
        html`<p class="alert alert-success">Permohonan Anda sudah diterima.</p>
          <p>Nomor Permohonan: <strong id="nomor-permohonan">${nomor}</strong></p>`,
      ),
    );
  });
}
