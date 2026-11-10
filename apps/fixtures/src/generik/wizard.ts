import type { Hono } from 'hono';
import { html, page } from '../layout.js';
import {
  GENERIK,
  injeksi,
  KOLOM,
  nomorPermohonan,
  renderKolom,
  sesiReplika,
  umpan,
  urutkan,
  validasi,
  type Kolom,
  type OpsiGenerik,
} from './umum.js';

/**
 * Replika (c) `wizard`: formulir multi-langkah.
 * - Langkah 1 terdiri dari dua bagian di halaman yang sama: "Lanjut" (type=button, murni sisi klien) membuka
 *   bagian berikutnya; "Simpan dan Lanjutkan" adalah POST ke server yang menyimpan draf.
 * - Halaman pernyataan ("Dengan ini saya menyatakan ...") lalu tombol final "Kirim" (milik warga).
 */
const BAGIAN_A: readonly Kolom[] = [KOLOM.nik, KOLOM.kk, KOLOM.nama];
const BAGIAN_B: readonly Kolom[] = [
  KOLOM.tempatLahir,
  KOLOM.tglLahir,
  KOLOM.hp,
  KOLOM.alamat,
  KOLOM.jenisPermohonan,
  KOLOM.berkasKtp,
];

export const TEKS_PERNYATAAN =
  'Dengan ini saya menyatakan bahwa data yang saya isi adalah benar dan dapat dipertanggungjawabkan.';

const WIZARD_JS = `(() => {
  for (const b of document.querySelectorAll('[data-ke]')) {
    b.addEventListener('click', () => {
      const kini = b.closest('section');
      const ke = document.getElementById(b.dataset.ke);
      if (!kini || !ke) return;
      if (b.dataset.arah !== 'mundur') {
        for (const el of kini.querySelectorAll('[required]')) {
          if (!el.checkValidity()) { el.reportValidity(); return; }
        }
      }
      kini.hidden = true;
      ke.hidden = false;
    });
  }
})();`;

export function registerWizard(app: Hono, o: OpsiGenerik): void {
  app.get(`${GENERIK}/static/wizard.js`, (c) =>
    c.body(WIZARD_JS, 200, { 'Content-Type': 'text/javascript' }),
  );

  for (const v of o.varian) {
    const b = `${GENERIK}/${v}/wizard`;
    const sesi = sesiReplika(`fx_gen_wiz_${v.replace(/-/g, '_')}`, () => ({ draf: false }), o.secure);
    const terkirim: string[] = [];

    app.get(`${b}/`, (c) =>
      c.html(
        page(
          'Permohonan Pindah Datang',
          html`<p>Ajukan permohonan dalam tiga langkah (replika uji).</p>
            <p><a href="${b}/langkah-1">Mulai Permohonan</a></p>`,
        ),
      ),
    );

    const langkah1 = (galat: Record<string, string> = {}) =>
      page(
        'Langkah 1 dari 2: Data Pemohon',
        html`${injeksi(v)}
          ${Object.keys(galat).length ? html`<p class="alert" role="alert">Lengkapi data yang ditandai.</p>` : ''}
          <form method="post" action="${b}/langkah-1" enctype="multipart/form-data">
            <section id="bagian-a">
              <h2>Identitas</h2>
              ${urutkan(BAGIAN_A, v).map((k) => renderKolom(k, v, galat[k.kunci]))}
              <p><button type="button" data-ke="bagian-b" id="btn-lanjut">Lanjut</button></p>
            </section>
            <section id="bagian-b" ${Object.keys(galat).length ? '' : 'hidden'}>
              <h2>Data Kelahiran dan Kontak</h2>
              ${urutkan(BAGIAN_B, v).map((k) => renderKolom(k, v, galat[k.kunci]))} ${umpan(v)}
              <p>
                <button type="button" data-ke="bagian-a" data-arah="mundur" id="btn-kembali">Kembali</button>
                <button type="submit" id="btn-simpan">Simpan dan Lanjutkan</button>
              </p>
            </section>
          </form>
          <script src="${GENERIK}/static/wizard.js"></script>`,
      );

    app.get(`${b}/langkah-1`, (c) => {
      if (!sesi.ambil(c)) sesi.buat(c);
      return c.html(langkah1());
    });

    app.post(`${b}/langkah-1`, async (c) => {
      const s = sesi.ambil(c) ?? sesi.buat(c);
      o.hitung.catat('wizard.simpan');
      o.hitung.catat(`wizard.${v}.simpan`);
      const body = await c.req.parseBody();
      const galat = validasi([...BAGIAN_A, ...BAGIAN_B], v, body);
      if (Object.keys(galat).length) return c.html(langkah1(galat), 422);
      s.draf = true;
      return c.redirect(`${b}/pernyataan`, 303);
    });

    app.get(`${b}/pernyataan`, (c) => {
      if (!sesi.ambil(c)?.draf) return c.redirect(`${b}/langkah-1`, 302);
      return c.html(
        page(
          'Langkah 2 dari 2: Pernyataan',
          html`${injeksi(v)}
            <p>Periksa kembali data Anda. Data langkah 1 sudah tersimpan sebagai draf.</p>
            <form method="post" action="${b}/kirim">
              <label><input type="checkbox" name="setuju" value="1" required /> ${TEKS_PERNYATAAN}</label>
              <p>
                <a href="${b}/langkah-1">Ubah Data</a>
                <button type="submit" id="btn-kirim">Kirim</button>
              </p>
            </form>`,
        ),
      );
    });

    app.post(`${b}/kirim`, async (c) => {
      const s = sesi.ambil(c);
      o.hitung.catat('wizard.percobaan');
      o.hitung.catat(`wizard.${v}.percobaan`);
      const body = await c.req.parseBody();
      if (!s?.draf || body.setuju !== '1') return c.redirect(`${b}/pernyataan`, 303);
      o.hitung.catat('wizard.kirim');
      o.hitung.catat(`wizard.${v}.kirim`);
      s.draf = false;
      terkirim.push(nomorPermohonan('PINDAH', terkirim.length + 1));
      return c.redirect(`${b}/terkirim/${terkirim.length}`, 303);
    });

    app.get(`${b}/terkirim/:n`, (c) => {
      const nomor = terkirim[Number(c.req.param('n')) - 1];
      if (!nomor) return c.redirect(`${b}/`, 302);
      return c.html(
        page(
          'Permohonan Terkirim',
          html`<p class="alert alert-success">Permohonan pindah datang Anda sudah diterima.</p>
            <p>Nomor Permohonan: <strong id="nomor-permohonan">${nomor}</strong></p>`,
        ),
      );
    });
  }
}
