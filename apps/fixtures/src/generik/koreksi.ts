import type { Hono } from 'hono';
import { html, page, raw } from '../layout.js';
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
 * Replika (d) `koreksi` (hanya varian `dasar`): wizard tiga langkah yang MENOLAK pilihan pertama yang lazim di
 * langkah 2 ("KK Baru (Pecah KK)": kuota hari ini habis) dengan galat validasi di samping kolomnya
 * (`aria-invalid` + `aria-errormessage`, pilihan tetap terpilih), lalu menerima jenis lain. Untuk uji
 * periksa-sesudah-aksi Navigator: AI harus mengoreksi kolom yang ditolak, bukan langsung menyerahkan ke warga.
 * Langkah 3 = pernyataan + tombol final "Kirim" (milik warga). Setiap penolakan dicatat `koreksi.tolak`.
 */
export const KOREKSI = `${GENERIK}/dasar/koreksi`;
export const OPSI_DITOLAK = 'KK Baru (Pecah KK)';
export const GALAT_KUOTA = `Kuota ${OPSI_DITOLAK} hari ini sudah habis. Pilih jenis permohonan lain.`;

const LANGKAH_1: readonly Kolom[] = [KOLOM.nik, KOLOM.nama];
const JENIS = KOLOM.jenisPermohonan;

export function registerKoreksi(app: Hono, o: OpsiGenerik): void {
  const b = KOREKSI;
  const sesi = sesiReplika('fx_gen_koreksi', () => ({ langkah: 1 }), o.secure);
  const terkirim: string[] = [];

  app.get(`${b}/`, (c) =>
    c.html(
      page(
        'Permohonan Perubahan KK',
        html`<p>Ajukan permohonan dalam tiga langkah (replika uji).</p>
          <p><a href="${b}/langkah-1">Mulai Permohonan</a></p>`,
      ),
    ),
  );

  const langkah1 = (galat: Record<string, string> = {}) =>
    page(
      'Langkah 1 dari 3: Identitas',
      html`<form method="post" action="${b}/langkah-1">
        ${LANGKAH_1.map((k) => renderKolom(k, 'dasar', galat[k.kunci]))}
        <p><button type="submit" id="btn-simpan-1">Simpan dan Lanjutkan</button></p>
      </form>`,
    );

  app.get(`${b}/langkah-1`, (c) => {
    if (!sesi.ambil(c)) sesi.buat(c);
    return c.html(langkah1());
  });

  app.post(`${b}/langkah-1`, async (c) => {
    const s = sesi.ambil(c) ?? sesi.buat(c);
    const galat = validasi(LANGKAH_1, 'dasar', await c.req.parseBody());
    if (Object.keys(galat).length) return c.html(langkah1(galat), 422);
    s.langkah = 2;
    return c.redirect(`${b}/langkah-2`, 303);
  });

  /** Langkah 2: pilihan jenis dengan galat validasi server di samping kolom (pilihan sebelumnya tetap terpilih). */
  const langkah2 = (dipilih = '', galat = '') =>
    page(
      'Langkah 2 dari 3: Jenis Permohonan',
      html`<form method="post" action="${b}/langkah-2">
        <div class="kolom">
          <label for="in-jenis">${JENIS.label[0]} *</label>
          <select
            id="in-jenis"
            name="${JENIS.kunci}"
            required
            ${galat ? raw('aria-invalid="true" aria-errormessage="in-jenis-galat"') : ''}
          >
            ${(JENIS.opsi ?? []).map(
              (x, i) =>
                html`<option value="${i === 0 ? '' : x}" ${x === dipilih ? raw('selected') : ''}>
                  ${x}
                </option>`,
            )}
          </select>
          ${galat ? html`<small class="invalid-feedback" id="in-jenis-galat">${galat}</small>` : ''}
        </div>
        <p><button type="submit" id="btn-simpan-2">Simpan dan Lanjutkan</button></p>
      </form>`,
    );

  app.get(`${b}/langkah-2`, (c) => {
    if ((sesi.ambil(c)?.langkah ?? 0) < 2) return c.redirect(`${b}/langkah-1`, 302);
    return c.html(langkah2());
  });

  app.post(`${b}/langkah-2`, async (c) => {
    const s = sesi.ambil(c);
    if (!s || s.langkah < 2) return c.redirect(`${b}/langkah-1`, 303);
    const body = await c.req.parseBody();
    const jenis = typeof body[JENIS.kunci] === 'string' ? (body[JENIS.kunci] as string) : '';
    if (!jenis || !(JENIS.opsi as readonly string[]).slice(1).includes(jenis))
      return c.html(langkah2('', `${JENIS.label[0]} wajib dipilih.`), 422);
    if (jenis === OPSI_DITOLAK) {
      o.hitung.catat('koreksi.tolak');
      return c.html(langkah2(jenis, GALAT_KUOTA), 422);
    }
    s.langkah = 3;
    return c.redirect(`${b}/pernyataan`, 303);
  });

  app.get(`${b}/pernyataan`, (c) => {
    if ((sesi.ambil(c)?.langkah ?? 0) < 3) return c.redirect(`${b}/langkah-1`, 302);
    return c.html(
      page(
        'Langkah 3 dari 3: Pernyataan',
        html`<p>Periksa kembali data Anda sebelum mengirim.</p>
          <form method="post" action="${b}/kirim">
            <label><input type="checkbox" name="setuju" value="1" required /> ${TEKS_PERNYATAAN}</label>
            <p><button type="submit" id="btn-kirim">Kirim</button></p>
          </form>`,
      ),
    );
  });

  app.post(`${b}/kirim`, async (c) => {
    const s = sesi.ambil(c);
    o.hitung.catat('koreksi.percobaan');
    const body = await c.req.parseBody();
    if (!s || s.langkah < 3 || body.setuju !== '1') return c.redirect(`${b}/pernyataan`, 303);
    o.hitung.catat('koreksi.kirim');
    s.langkah = 1;
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
