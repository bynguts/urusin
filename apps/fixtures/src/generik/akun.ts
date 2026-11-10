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
 * Replika (a) `akun`: portal ber-akun. Masuk dengan nama pengguna + kode keamanan (CAPTCHA gambar yang diketik
 * warga; kata sandi hanya di profil local, ADR 0012), lalu dasbor, lalu formulir multi-kolom dengan unggahan
 * dan tombol final "Kirim Permohonan". Pola Laravel/CodeIgniter yang umum di recon nasional.
 */
export const AKUN_PENGGUNA = 'penguji';
export const AKUN_SANDI = 'sandi-uji-fiktif';
export const AKUN_CAPTCHA = 'K7P2Q';

const KOLOM_AKUN: readonly Kolom[] = [
  KOLOM.nik,
  KOLOM.kk,
  KOLOM.nama,
  KOLOM.tempatLahir,
  KOLOM.tglLahir,
  KOLOM.hp,
  KOLOM.email,
  KOLOM.alamat,
  KOLOM.jenisPermohonan,
  KOLOM.alasan,
  KOLOM.catatan,
  KOLOM.berkasKtp,
  KOLOM.berkasKk,
];

export function registerAkun(app: Hono, o: OpsiGenerik): void {
  app.get(`${GENERIK}/captcha-akun.svg`, (c) =>
    c.body(
      '<svg xmlns="http://www.w3.org/2000/svg" width="140" height="44"><rect width="140" height="44" fill="#ddd"/><text x="70" y="29" font-family="monospace" font-size="18" text-anchor="middle" fill="#333">KODE UJI</text></svg>',
      200,
      { 'Content-Type': 'image/svg+xml' },
    ),
  );

  for (const v of o.varian) {
    const b = `${GENERIK}/${v}/akun`;
    const sesi = sesiReplika(`fx_gen_akun_${v.replace(/-/g, '_')}`, () => ({ masuk: true }), o.secure);
    const permohonan: string[] = [];

    app.get(`${b}/`, (c) =>
      c.html(
        page(
          'Layanan Adminduk Daring',
          html`<p>Layanan pendaftaran penduduk dan pencatatan sipil secara daring (replika uji).</p>
            <ul>
              <li><a href="${b}/masuk">Masuk</a></li>
              <li><a href="${b}/persyaratan">Persyaratan Layanan</a></li>
            </ul>`,
        ),
      ),
    );

    app.get(`${b}/persyaratan`, (c) =>
      c.html(
        page(
          'Persyaratan Layanan',
          html`<ol>
              <li>Fotokopi KTP-el (contoh)</li>
              <li>KK lama (contoh)</li>
            </ol>
            <p><a href="${b}/">Kembali ke Beranda</a></p>`,
        ),
      ),
    );

    app.get(`${b}/masuk`, (c) => {
      const sandi = o.local
        ? html`<label for="kata_sandi">Kata Sandi</label>
            <input id="kata_sandi" name="kata_sandi" type="password" autocomplete="off" />`
        : '';
      return c.html(
        page(
          'Masuk',
          html`<div class="note">
              Akun uji (fiktif):
              <code>${AKUN_PENGGUNA}</code>${o.local ? html`, sandi <code>${AKUN_SANDI}</code>` : ''}, kode
              keamanan <code>${AKUN_CAPTCHA}</code>.
            </div>
            <form method="post" action="${b}/masuk">
              <label for="nama_pengguna">NIK atau Nama Pengguna</label>
              <input id="nama_pengguna" name="nama_pengguna" type="text" autocomplete="off" />
              ${sandi}
              <label for="kode_captcha">Kode Keamanan</label>
              <img src="${GENERIK}/captcha-akun.svg" alt="Kode keamanan" width="140" height="44" />
              <input id="kode_captcha" name="kode_captcha" type="text" autocomplete="off" />
              <p><button type="submit" id="btn-masuk">Masuk</button></p>
            </form>`,
        ),
      );
    });

    app.post(`${b}/masuk`, async (c) => {
      const body = await c.req.parseBody();
      const sandiOk = !o.local || body.kata_sandi === AKUN_SANDI;
      if (body.nama_pengguna !== AKUN_PENGGUNA || body.kode_captcha !== AKUN_CAPTCHA || !sandiOk)
        return c.html(
          page(
            'Masuk gagal',
            html`<p class="alert" id="galat-masuk">Nama pengguna atau kode keamanan salah.</p>
              <p><a href="${b}/masuk">Coba lagi</a></p>`,
          ),
          401,
        );
      sesi.buat(c);
      return c.redirect(`${b}/dasbor`, 303);
    });

    app.get(`${b}/keluar`, (c) => {
      sesi.hapus(c);
      return c.redirect(`${b}/masuk`, 303);
    });

    app.get(`${b}/dasbor`, (c) => {
      if (!sesi.ambil(c)) return c.redirect(`${b}/masuk`, 302);
      return c.html(
        page(
          'Dasbor Pemohon',
          html`<p>Selamat datang, Penguji Fiktif.</p>
            <ul>
              <li><a href="${b}/permohonan/kk">Ajukan Permohonan Kartu Keluarga</a></li>
              <li><a href="${b}/riwayat">Riwayat Permohonan</a></li>
            </ul>
            <p><a href="${b}/keluar">Keluar</a></p>`,
        ),
      );
    });

    app.get(`${b}/riwayat`, (c) => {
      if (!sesi.ambil(c)) return c.redirect(`${b}/masuk`, 302);
      return c.html(
        page(
          'Riwayat Permohonan',
          html`<ul id="riwayat">
              ${permohonan.map((n) => html`<li class="nomor">${n}</li>`)}
            </ul>
            <p><a href="${b}/dasbor">Kembali ke Dasbor</a></p>`,
        ),
      );
    });

    const formulir = (galat: Record<string, string> = {}) =>
      page(
        'Formulir Permohonan Kartu Keluarga',
        html`${injeksi(v)}
          ${Object.keys(galat).length ? html`<p class="alert" role="alert">Periksa kembali isian Anda.</p>` : ''}
          <form method="post" action="${b}/permohonan/kk" enctype="multipart/form-data">
            ${urutkan(KOLOM_AKUN, v).map((k) => renderKolom(k, v, galat[k.kunci]))} ${umpan(v)}
            <p><button type="submit" id="btn-kirim">Kirim Permohonan</button></p>
          </form>
          <p><a href="${b}/dasbor">Kembali ke Dasbor</a></p>`,
      );

    app.get(`${b}/permohonan/kk`, (c) => {
      if (!sesi.ambil(c)) return c.redirect(`${b}/masuk`, 302);
      return c.html(formulir());
    });

    app.post(`${b}/permohonan/kk`, async (c) => {
      if (!sesi.ambil(c)) return c.redirect(`${b}/masuk`, 302);
      o.hitung.catat('akun.percobaan');
      o.hitung.catat(`akun.${v}.percobaan`);
      const body = await c.req.parseBody();
      const galat = validasi(KOLOM_AKUN, v, body);
      if (Object.keys(galat).length) return c.html(formulir(galat), 422);
      o.hitung.catat('akun.kirim');
      o.hitung.catat(`akun.${v}.kirim`);
      permohonan.push(nomorPermohonan('AKUN', permohonan.length + 1));
      return c.redirect(`${b}/permohonan/terkirim/${permohonan.length}`, 303);
    });

    app.get(`${b}/permohonan/terkirim/:n`, (c) => {
      const nomor = permohonan[Number(c.req.param('n')) - 1];
      if (!nomor || !sesi.ambil(c)) return c.redirect(`${b}/dasbor`, 302);
      return c.html(
        page(
          'Permohonan Berhasil Dikirim',
          html`<p class="alert alert-success">Permohonan Anda telah kami terima.</p>
            <p>Nomor Permohonan: <strong id="nomor-permohonan">${nomor}</strong></p>
            <p><a href="${b}/riwayat">Lihat Riwayat Permohonan</a></p>`,
        ),
      );
    });
  }
}
