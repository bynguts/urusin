import type { Hono } from 'hono';
import { html, page } from './layout.js';

/**
 * Replika read-only dua pencarian publik (recon rea-samsat-oss 2026-11-08), untuk menguji alur baca-saja
 * Browser Pendamping `samsat-dki/cek_pkb` dan `oss-nib/cari_nib` tanpa menyentuh situs asli. Data fiktif.
 *
 * - Samsat: form `FINPPKB` (`nb` 4 digit, `nc` huruf akhiran, `nik` opsional), POST ke URL yang sama, hasil
 *   dirender ulang sebagai HTML (`#print-content` > `#content_pkb`). Struktur hasil situs asli belum teramati;
 *   isi hasil di sini hanya contoh.
 * - OSS: widget "Pencarian NIB" (kolom `Masukkan NIB`, tombol `Cari NIB`) memanggil API JSON lalu merender hasil.
 *
 * Verifikasi situs (Turnstile) TIDAK ditiru: Samsat hanya punya wadah statis dengan input tersembunyi bernilai
 * penanda uji (bukan token), karena adapter menunggu wadah itu ada. Takeover verifikasi diuji di /uji-cf/.
 * `GET .../uji/terakhir` mengembalikan pencarian terakhir (hanya untuk tes e2e; replika, bukan situs nyata).
 */

export const SAMSAT = '/samsat';
export const OSS = '/oss';
export const SAMSAT_NB = '1234';
export const SAMSAT_NC = 'UJI';
export const OSS_NIB = '9999000000001';

const NIB_JS = `(() => {
  const input = document.getElementById('nib');
  const tombol = document.getElementById('cari-nib');
  const hasil = document.getElementById('hasil-nib');
  tombol.addEventListener('click', async () => {
    hasil.replaceChildren();
    const res = await fetch('${OSS}/v1/reg/public/nib', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataNib: { nib: input.value.trim() } }),
      credentials: 'same-origin',
    });
    const j = await res.json().catch(() => ({}));
    const p = document.createElement('p');
    if (j.kode === 200) {
      p.id = 'nib-ditemukan';
      p.textContent = j.data.nama + ' | ' + j.data.status_aktif + ' | ' + j.data.skala_usaha;
    } else {
      p.id = 'nib-kosong';
      p.textContent = 'Data NIB tidak ditemukan';
    }
    hasil.append(p);
  });
})();`;

export function registerSamsatOss(app: Hono): void {
  let terakhirSamsat: { nb: string; nc: string } | null = null;
  let terakhirOss: { nib: string } | null = null;

  const formSamsat = () =>
    html`<form id="PKB-FORM" name="FINPPKB" method="post">
      <label for="validationTooltipNopol">Nomor polisi: B</label>
      <input
        id="validationTooltipNopol"
        name="nb"
        pattern="\\d{4}"
        maxlength="4"
        required
        autocomplete="off"
      />
      <label for="nc">Huruf akhiran</label>
      <input id="nc" name="nc" maxlength="3" autocomplete="off" />
      <label for="nik">NIK (opsional)</label>
      <input id="nik" name="nik" maxlength="16" autocomplete="off" />
      <input type="hidden" name="flag" value="2" />
      <div class="cf-turnstile note">
        Wadah widget verifikasi (replika: tidak ada verifikasi sungguhan).
        <input type="hidden" name="cf-turnstile-response" value="replika-bukan-token" />
      </div>
      <p><button type="submit" id="submit" name="BTNSUB">Cek</button></p>
    </form>`;

  app.get(`${SAMSAT}/`, (c) =>
    c.html(
      page(
        'Info PKB (replika uji)',
        html`<div class="note">Nomor uji (fiktif): B ${SAMSAT_NB} ${SAMSAT_NC}</div>
          ${formSamsat()}`,
      ),
    ),
  );

  app.post(`${SAMSAT}/`, async (c) => {
    const body = await c.req.parseBody();
    const nb = typeof body.nb === 'string' ? body.nb : '';
    const nc = typeof body.nc === 'string' ? body.nc.toUpperCase() : '';
    terakhirSamsat = { nb, nc };
    const cocok = nb === SAMSAT_NB && nc === SAMSAT_NC;
    return c.html(
      page(
        'Info PKB (replika uji)',
        html`<div id="print-content">
          <div id="content_pkb">
            ${
              cocok
                ? html`<table>
                    <tr>
                      <th>Nomor polisi</th>
                      <td>B ${SAMSAT_NB} ${SAMSAT_NC}</td>
                    </tr>
                    <tr>
                      <th>Merek (contoh)</th>
                      <td>KENDARAAN UJI</td>
                    </tr>
                    <tr>
                      <th>PKB (contoh)</th>
                      <td>Rp 0</td>
                    </tr>
                    <tr>
                      <th>Status (contoh)</th>
                      <td>Contoh, bukan data nyata</td>
                    </tr>
                  </table>`
                : html`<p id="pkb-kosong">Data kendaraan tidak ditemukan.</p>`
            }
          </div>
        </div>`,
      ),
    );
  });

  app.get(`${SAMSAT}/uji/terakhir`, (c) => c.json({ terakhir: terakhirSamsat }));

  app.get(`${OSS}/id`, (c) =>
    c.html(
      page(
        'Pencarian NIB (replika uji)',
        html`<div class="note">NIB uji (fiktif): <code>${OSS_NIB}</code></div>
          <label for="nib">NIB</label>
          <input id="nib" placeholder="Masukkan NIB" inputmode="numeric" autocomplete="off" />
          <p><button type="button" id="cari-nib" aria-label="Cari NIB">Cari NIB</button></p>
          <div id="hasil-nib" aria-live="polite"></div>
          <script src="${OSS}/static/nib.js"></script>`,
      ),
    ),
  );

  app.get(`${OSS}/static/nib.js`, (c) => c.body(NIB_JS, 200, { 'Content-Type': 'text/javascript' }));

  app.post(`${OSS}/v1/reg/public/nib`, async (c) => {
    const j = (await c.req.json().catch(() => ({}))) as { dataNib?: { nib?: unknown } };
    const nib = typeof j.dataNib?.nib === 'string' ? j.dataNib.nib : '';
    terakhirOss = { nib };
    if (nib !== OSS_NIB) return c.json({ kode: 404, data: null });
    return c.json({
      kode: 200,
      data: {
        nib: OSS_NIB,
        titleNama: 'Nama usaha',
        nama: 'USAHA UJI (CONTOH)',
        status_aktif: 'Aktif (contoh)',
        status_migrasi: '-',
        status_penanaman_modal: 'PMDN (contoh)',
        skala_usaha: 'Mikro (contoh)',
      },
    });
  });

  app.get(`${OSS}/uji/terakhir`, (c) => c.json({ terakhir: terakhirOss }));
}
