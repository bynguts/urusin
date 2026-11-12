import type { Hono } from 'hono';
import { html, page } from './layout.js';

/**
 * Formulir SIMULASI demo juri (Browser Pendamping "Lihat contoh pengisian (simulasi)"), di setiap replika yang
 * punya alur pengajuan: Telunjuk Sakti (akar), Klampid (`/sby`), Si D'nOK (`/smg`). Halaman ini sudah dalam
 * keadaan "masuk" (tanpa dinding login replika) supaya juri langsung melihat AI mengisi Data Diri contoh.
 * Tidak menyimpan isian apa pun; Kirim hanya membuka halaman "terkirim (simulasi)". Hanya ada di replika:
 * portal resmi tidak punya jalur ini, dan worker menolak alur simulasi di luar Mode Uji.
 */
export const JALUR_SIMULASI = '/simulasi/formulir';
export const REPLIKA_SIMULASI = [
  { awalan: '', nama: 'Telunjuk Sakti (replika)' },
  { awalan: '/sby', nama: 'Klampid (replika)' },
  { awalan: '/smg', nama: "Si D'nOK (replika)" },
] as const;

const KOLOM = [
  { id: 'nama', label: 'Nama lengkap' },
  { id: 'nik', label: 'NIK' },
  { id: 'tempat_lahir', label: 'Tempat lahir' },
  { id: 'tanggal_lahir', label: 'Tanggal lahir' },
  { id: 'alamat', label: 'Alamat' },
  { id: 'hp', label: 'Nomor HP' },
] as const;

export function registerSimulasi(app: Hono): void {
  for (const { awalan, nama } of REPLIKA_SIMULASI) {
    // Untuk uji: berapa kolom terisi pada kiriman simulasi terakhir (hitungan saja, tanpa nilai).
    let terisi = 0;
    app.get(`${awalan}/simulasi/_terisi`, (c) => c.json({ terisi }));
    app.get(`${awalan}${JALUR_SIMULASI}`, (c) =>
      c.html(
        page(
          'Formulir pengajuan (simulasi)',
          html`<div class="note" id="simulasi-catatan">
              ${nama}: formulir contoh untuk simulasi Urusin. Sudah masuk sebagai Penguji Fiktif. Data contoh
              saja; tidak ada yang dikirim ke pemerintah.
            </div>
            <form method="post" action="${awalan}/simulasi/kirim" id="form-simulasi">
              ${KOLOM.map(
                (k) =>
                  html`<label for="${k.id}">${k.label}</label>
                    <input id="${k.id}" name="${k.id}" type="text" autocomplete="off" />`,
              )}
              <p><button type="submit" id="kirim">Kirim (simulasi)</button></p>
            </form>`,
        ),
      ),
    );
    // Isian dibuang (hanya dihitung): simulasi tidak menyimpan nilai apa pun.
    app.post(`${awalan}/simulasi/kirim`, async (c) => {
      const body = await c.req.parseBody();
      terisi = KOLOM.filter((k) => typeof body[k.id] === 'string' && body[k.id] !== '').length;
      return c.redirect(`${awalan}/simulasi/terkirim`, 303);
    });
    app.get(`${awalan}/simulasi/terkirim`, (c) =>
      c.html(
        page(
          'Simulasi selesai',
          html`<p id="simulasi-terkirim">
            Simulasi selesai. Di portal resmi, langkah ini mengirim pengajuan Anda. Di sini tidak ada yang
            dikirim.
          </p>`,
        ),
      ),
    );
  }
}
