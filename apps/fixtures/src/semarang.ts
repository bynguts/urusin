import { getCookie, setCookie } from 'hono/cookie';
import type { Hono } from 'hono';
import { html, page } from './layout.js';

/**
 * Replika read-only alur PUBLIK Si D'nOK Semarang (recon 2026-11-08): /data-dukung (persyaratan statis
 * bertab), /bantuan, dan /cek-status (kode 16 karakter + captcha matematika gambar, POST ajax berisi
 * `_token` CSRF + cookie sesi, respons JSON). Login/daftar sengaja TIDAK ditiru. Data fiktif.
 */

export const SMG = '/smg';
export const SMG_KODE = 'FIXTUREKODE00001'; // 16 karakter
const NUM1 = 3;
const NUM2 = 4;

const DATA_DUKUNG: { id: string; judul: string; syarat: string[] }[] = [
  {
    id: 'akta-lahir',
    judul: 'Akta Kelahiran',
    syarat: ['Surat keterangan lahir (contoh)', 'KK orang tua (contoh)'],
  },
  { id: 'kk', judul: 'Kartu Keluarga', syarat: ['Pengantar RT/RW (contoh)', 'KK lama (contoh)'] },
  {
    id: 'kedatangan',
    judul: 'Kedatangan',
    syarat: [
      'SKPWNI dari daerah asal (contoh)',
      'Surat pernyataan alamat bila menyewa (contoh)',
      'Surat pernyataan tidak keberatan numpang KK (contoh)',
    ],
  },
  {
    id: 'pindah-keluar',
    judul: 'Perpindahan Keluar',
    syarat: ['KK asli (contoh)', 'Pengantar RT/RW (contoh)'],
  },
];

const CHECK_JS = `(() => {
  const form = document.getElementById('form-cek');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = document.getElementById('hasil');
    const res = await fetch(form.action, { method: 'POST', body: new URLSearchParams(new FormData(form)), credentials: 'same-origin' });
    const j = await res.json().catch(() => ({}));
    out.textContent = j.flag_status ? j.nama_pelayanan + ' | ' + j.flag_status + ' | ' + j.sent_at
      : j.captcha ? 'Captcha: ' + j.captcha : j.gagal ? 'Gagal: ' + j.gagal : 'Error ' + res.status;
    out.dataset.state = j.flag_status ? 'ok' : 'error';
  });
})();`;

export function registerSemarang(app: Hono, opts: { secure: boolean }): void {
  const tokens = new Map<string, string>(); // sesi -> token CSRF

  app.get(`${SMG}/`, (c) =>
    c.html(
      page(
        "Si D'nOK (replika uji)",
        html`<ul>
          <li><a href="${SMG}/data-dukung">Data dukung</a></li>
          <li><a href="${SMG}/cek-status">Cek status</a></li>
          <li><a href="${SMG}/bantuan">Bantuan</a></li>
        </ul>`,
      ),
    ),
  );

  app.get(`${SMG}/data-dukung`, (c) =>
    c.html(
      page(
        'Data dukung persyaratan',
        html`<p>Untuk pengajuan online, berkas pindaian harus berasal dari dokumen asli.</p>
          ${DATA_DUKUNG.map(
            (d) =>
              html`<section id="tab-${d.id}" class="tab">
                <h2>${d.judul}</h2>
                <ul class="syarat">
                  ${d.syarat.map((s) => html`<li>${s}</li>`)}
                </ul>
              </section>`,
          )}`,
      ),
    ),
  );

  app.get(`${SMG}/bantuan`, (c) =>
    c.html(
      page(
        'Bantuan',
        html`<p>
          Pendaftaran hanya untuk penduduk yang sudah tercatat di basis data kota, usia 17 tahun ke atas.
        </p>`,
      ),
    ),
  );

  app.get(`${SMG}/captcha/math`, (c) =>
    c.body(
      `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="44"><rect width="140" height="44" fill="#ddd"/><text x="70" y="29" font-family="monospace" font-size="18" text-anchor="middle" fill="#333">${NUM1} + ${NUM2} = ?</text></svg>`,
      200,
      { 'Content-Type': 'image/svg+xml' },
    ),
  );

  app.get(`${SMG}/static/cek-status.js`, (c) => c.body(CHECK_JS, 200, { 'Content-Type': 'text/javascript' }));

  app.get(`${SMG}/cek-status`, (c) => {
    let sid = getCookie(c, 'fx_smg_session');
    let token = sid ? tokens.get(sid) : undefined;
    if (!sid || !token) {
      sid = crypto.randomUUID();
      token = crypto.randomUUID();
      tokens.set(sid, token);
      setCookie(c, 'fx_smg_session', sid, {
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
        secure: opts.secure,
      });
    }
    return c.html(
      page(
        'Cek status pengajuan',
        html`<meta name="csrf-token" content="${token}" />
          <div class="note">Kode uji (fiktif): <code>${SMG_KODE}</code></div>
          <form id="form-cek" method="post" action="${SMG}/cek-status/get-pengajuan">
            <input type="hidden" name="_token" value="${token}" />
            <label for="kode_layanan">Kode Pelayanan (16 karakter)</label>
            <input id="kode_layanan" name="kode_layanan" type="text" maxlength="16" autocomplete="off" />
            <label for="captcha">Pertanyaan Keamanan</label>
            <img
              id="captcha-img"
              src="${SMG}/captcha/math"
              alt="Captcha matematika"
              width="140"
              height="44"
            />
            <input id="captcha" name="captcha" type="text" autocomplete="off" />
            <p><button type="submit" id="btnCek">Cek</button></p>
          </form>
          <p id="hasil" aria-live="polite"></p>
          <script src="${SMG}/static/cek-status.js"></script>`,
      ),
    );
  });

  app.post(`${SMG}/cek-status/get-pengajuan`, async (c) => {
    const sid = getCookie(c, 'fx_smg_session');
    const body = await c.req.parseBody();
    if (!sid || tokens.get(sid) === undefined || body._token !== tokens.get(sid)) {
      return c.json({ message: 'CSRF token mismatch.' }, 419 as 400); // 419 = status Laravel; tipe Hono belum mengenalnya
    }
    const kode = typeof body.kode_layanan === 'string' ? body.kode_layanan : '';
    if (kode.length !== 16) return c.json({ gagal: 'Kode pelayanan harus 16 karakter' });
    if (Number(body.captcha) !== NUM1 + NUM2) return c.json({ captcha: 'Jawaban keamanan salah' });
    if (kode !== SMG_KODE) return c.json({ gagal: 'Data tidak ditemukan' });
    return c.json({
      kode_layanan: SMG_KODE,
      nama_pelayanan: 'Kedatangan (contoh)',
      sent_at: '2026-01-02 08:00:00',
      flag_status: 'Siap Diambil',
    });
  });
}
