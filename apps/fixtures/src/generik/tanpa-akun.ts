import type { Hono } from 'hono';
import { html, page } from '../layout.js';
import {
  GENERIK,
  injeksi,
  KOLOM,
  nomorPermohonan,
  renderKolom,
  umpan,
  urutkan,
  validasi,
  type Kolom,
  type OpsiGenerik,
} from './umum.js';

/**
 * Replika (b) `tanpa-akun`: satu halaman formulir pendaftaran tanpa akun (gaya "Cukup Daftar Online" /
 * "Rumah Dukcapil") dengan tombol final "Kirim". Nomor permohonan tampil di halaman sukses.
 */
const KOLOM_TANPA_AKUN: readonly Kolom[] = [
  KOLOM.jenisPermohonan,
  KOLOM.nama,
  KOLOM.nik,
  KOLOM.kk,
  KOLOM.hp,
  KOLOM.email,
  KOLOM.alamat,
  KOLOM.berkasKtp,
];

export function registerTanpaAkun(app: Hono, o: OpsiGenerik): void {
  for (const v of o.varian) {
    const b = `${GENERIK}/${v}/tanpa-akun`;
    const terkirim: string[] = [];

    app.get(`${b}/`, (c) =>
      c.html(
        page(
          'Pendaftaran Layanan Online',
          html`<p>Daftar layanan kependudukan tanpa membuat akun (replika uji).</p>
            <ul>
              <li><a href="${b}/formulir">Mulai Pendaftaran</a></li>
              <li><a href="${b}/cek-status">Pengecekan Status</a></li>
            </ul>`,
        ),
      ),
    );

    app.get(`${b}/cek-status`, (c) =>
      c.html(
        page(
          'Pengecekan Status',
          html`<p>Masukkan nomor permohonan di loket atau hubungi petugas (replika uji).</p>
            <p><a href="${b}/">Kembali</a></p>`,
        ),
      ),
    );

    const formulir = (galat: Record<string, string> = {}) =>
      page(
        'Formulir Pendaftaran',
        html`${injeksi(v)}
          ${Object.keys(galat).length ? html`<p class="alert" role="alert">Data belum lengkap.</p>` : ''}
          <form method="post" action="${b}/formulir" enctype="multipart/form-data">
            ${urutkan(KOLOM_TANPA_AKUN, v).map((k) => renderKolom(k, v, galat[k.kunci]))} ${umpan(v)}
            <p><button type="submit" id="btn-kirim">Kirim</button></p>
          </form>`,
      );

    app.get(`${b}/formulir`, (c) => c.html(formulir()));

    app.post(`${b}/formulir`, async (c) => {
      o.hitung.catat('tanpa-akun.percobaan');
      o.hitung.catat(`tanpa-akun.${v}.percobaan`);
      const body = await c.req.parseBody();
      const galat = validasi(KOLOM_TANPA_AKUN, v, body);
      if (Object.keys(galat).length) return c.html(formulir(galat), 422);
      o.hitung.catat('tanpa-akun.kirim');
      o.hitung.catat(`tanpa-akun.${v}.kirim`);
      terkirim.push(nomorPermohonan('DAFTAR', terkirim.length + 1));
      return c.redirect(`${b}/terkirim/${terkirim.length}`, 303);
    });

    app.get(`${b}/terkirim/:n`, (c) => {
      const nomor = terkirim[Number(c.req.param('n')) - 1];
      if (!nomor) return c.redirect(`${b}/`, 302);
      return c.html(
        page(
          'Pendaftaran Berhasil',
          html`<p class="alert alert-success">Terima kasih, pendaftaran Anda sudah tercatat.</p>
            <p>Nomor Permohonan: <strong id="nomor-permohonan">${nomor}</strong></p>`,
        ),
      );
    });
  }
}
