import type { Context, Hono } from 'hono';
import { html, page } from './layout.js';

/**
 * Replika read-only alur PUBLIK Klampid Surabaya (recon 2026-11-08): landing 3 portal, katalog layanan
 * publik (GraphQL GET `allPublicFrontServices`, wajib header `apollo-require-preflight`), dan pelacakan
 * publik `KitirHistory` dengan captcha matematika. Login/register/pengajuan sengaja TIDAK ditiru.
 * Semua data fiktif; id layanan berawalan `fx-`.
 */

export const SBY = '/sby';
export const SBY_KITIR = 'KITIR-FIXTURE-0001';
const NUM1 = 3;
const NUM2 = 4;

type Guide = { index: number; title: string; description: string; attachmentUrl: string | null };
type FrontService = {
  _id: string;
  name: string;
  description: string;
  category: string;
  iconUrl: string | null;
  visibilityStatus: 'Dipublikasikan';
  availabilityStatus: 'Tersedia';
  specialFunction: string | null;
  lockedAt: string | null;
  guides: Guide[];
};

const svc = (
  id: string,
  name: string,
  category: string,
  description: string,
  guide = false,
): FrontService => ({
  _id: `fx-${id}`,
  name,
  description,
  category,
  iconUrl: null,
  visibilityStatus: 'Dipublikasikan',
  availabilityStatus: 'Tersedia',
  specialFunction: null,
  lockedAt: null,
  guides: guide
    ? [
        {
          index: 1,
          title: 'Panduan (contoh)',
          description: 'Panduan fiktif',
          attachmentUrl: `${SBY}/guide/fx-${id}`,
        },
      ]
    : [],
});

// Mirip katalog asli: kategori sama, ada duplikat per varian dan entri uji.
export const SBY_SERVICES: readonly FrontService[] = [
  svc('0001', 'Pengajuan KTP Elektronik', 'PENDAFTARAN PENDUDUK', 'Pengajuan KTP-el (contoh)', true),
  svc('0002', 'Pindah Datang', 'PENDAFTARAN PENDUDUK', 'Pindah dari luar kota ke kota ini (contoh)'),
  svc('0003', 'Cetak Ulang KK', 'PENDAFTARAN PENDUDUK', 'Cetak ulang Kartu Keluarga (contoh)'),
  svc('0004', 'Akta Kelahiran', 'PENCATATAN SIPIL', 'Akta kelahiran (contoh)', true),
  svc('0005', 'Akta Kelahiran', 'PENCATATAN SIPIL', 'Varian fasilitas kesehatan (contoh)', true),
  svc('0006', 'Buka Blokir', 'PEMUTAKHIRAN DATA PENDUDUK', 'Buka blokir data (contoh)'),
  svc('0007', 'Legalisir', 'PELAYANAN UMUM', 'Legalisir dokumen (contoh)'),
  svc('0008', 'Test', 'PELAYANAN UMUM', 'Entri uji, seperti di katalog asli'),
];

const PROCESS_HISTORY = [
  {
    nameProses: 'Berkas diterima',
    assignedAt: '2026-01-02T08:00:00Z',
    finishedAt: '2026-01-02T09:00:00Z',
    note: 'Data uji',
  },
  {
    nameProses: 'Verifikasi',
    assignedAt: '2026-01-02T09:00:00Z',
    finishedAt: null,
    note: 'Sedang diproses (data uji)',
  },
];

const gqlError = (message: string) => ({ errors: [{ message }] });

export function registerSurabaya(app: Hono): void {
  app.get(`${SBY}/`, (c) =>
    c.html(
      page(
        'Klampid (replika uji)',
        html`<p>Tiga pintu masuk seperti situs asli. Hanya alur publik yang ditiru.</p>
          <ul>
            <li><a id="btn-login-warga" href="${SBY}/app/login">Login Warga</a></li>
            <li><a id="btn-portal-kelurahan" href="${SBY}/app/login">Portal Kelurahan</a></li>
            <li><a id="btn-portal-kecamatan" href="${SBY}/app/login">Portal Kecamatan</a></li>
          </ul>
          <p>
            <a href="${SBY}/app/services">Katalog layanan</a> ·
            <a href="${SBY}/app/tracking">Lacak pengajuan</a>
          </p>`,
      ),
    ),
  );

  app.get(`${SBY}/app/login`, (c) =>
    c.html(
      page(
        'Login Warga',
        html`<p id="login-unavailable">Login tidak ditiru di fixture (alur read-only).</p>`,
      ),
    ),
  );

  app.get(`${SBY}/app/services`, (c) =>
    c.html(
      page(
        'Katalog layanan publik',
        html`<table id="tblServices">
          <thead>
            <tr>
              <th>Layanan</th>
              <th>Kategori</th>
              <th>Status</th>
              <th>Panduan</th>
            </tr>
          </thead>
          <tbody>
            ${SBY_SERVICES.map(
              (s) =>
                html`<tr data-id="${s._id}">
                  <td>${s.name}</td>
                  <td>${s.category}</td>
                  <td>${s.availabilityStatus} / ${s.visibilityStatus}</td>
                  <td>${s.guides.map((g) => html`<a href="${g.attachmentUrl ?? ''}">${g.title}</a>`)}</td>
                </tr>`,
            )}
          </tbody>
        </table>`,
      ),
    ),
  );

  app.get(`${SBY}/guide/:id`, (c) =>
    c.html(page('Panduan (contoh)', html`<p>Isi panduan fiktif untuk ${c.req.param('id')}.</p>`)),
  );

  const lacak = (c: Context) => {
    const q = c.req.query();
    let result = html``;
    if (q.kitir !== undefined) {
      const answerOk = Number(q.captchaAnswer) === NUM1 + NUM2;
      if (!answerOk) result = html`<p id="tracking-error">Jawaban captcha salah.</p>`;
      else if (q.kitir !== SBY_KITIR) result = html`<p id="tracking-empty">Kitir tidak ditemukan.</p>`;
      else {
        result = html`<div id="tracking-result">
          <p>Nomor pengajuan: <span id="submission-number">${SBY_KITIR}</span></p>
          <table id="tblHistory">
            <thead>
              <tr>
                <th>Proses</th>
                <th>Ditugaskan</th>
                <th>Selesai</th>
                <th>Catatan</th>
              </tr>
            </thead>
            <tbody>
              ${PROCESS_HISTORY.map(
                (h) =>
                  html`<tr>
                    <td>${h.nameProses}</td>
                    <td>${h.assignedAt}</td>
                    <td>${h.finishedAt ?? '-'}</td>
                    <td>${h.note}</td>
                  </tr>`,
              )}
            </tbody>
          </table>
        </div>`;
      }
    }
    return c.html(
      page(
        'Lacak pengajuan',
        html`<div class="note">Kitir uji (fiktif): <code>${SBY_KITIR}</code></div>
          <form method="get" action="${SBY}/app/tracking">
            <label for="kitir">Nomor kitir</label>
            <input id="kitir" name="kitir" type="text" autocomplete="off" />
            <label for="captchaAnswer">Berapa ${NUM1} + ${NUM2} ?</label>
            <input id="captchaAnswer" name="captchaAnswer" type="text" autocomplete="off" />
            <input type="hidden" name="num1" value="${NUM1}" />
            <input type="hidden" name="num2" value="${NUM2}" />
            <p><button type="submit" id="btnCari">Cari</button></p>
          </form>
          ${result}`,
      ),
    );
  };
  app.get(`${SBY}/app/tracking`, lacak);
  app.get(`${SBY}/tracking`, lacak); // rute halaman asli /tracking (dipakai adapter lewat override awalan)

  // GraphQL GET same-origin, seperti /new-api asli: wajib header anti-CSRF Apollo.
  app.get(`${SBY}/new-api`, (c) => {
    if (c.req.header('apollo-require-preflight') !== 'true') {
      return c.json(
        gqlError('This operation has been blocked as a potential Cross-Site Request Forgery (CSRF).'),
        400,
      );
    }
    const query = c.req.query('query') ?? '';
    if (query.includes('allPublicFrontServices')) {
      return c.json({ data: { allPublicFrontServices: SBY_SERVICES } });
    }
    if (query.includes('KitirHistory')) {
      let v: { kitir?: string; captchaAnswer?: number; num1?: number; num2?: number } = {};
      try {
        v = JSON.parse(c.req.query('variables') ?? '{}') as typeof v;
      } catch {
        return c.json(gqlError('variables bukan JSON'), 400);
      }
      if (Number(v.captchaAnswer) !== Number(v.num1) + Number(v.num2))
        return c.json(gqlError('Captcha salah'));
      if (v.kitir !== SBY_KITIR) return c.json({ data: { KitirHistory: null } });
      return c.json({
        data: {
          KitirHistory: {
            submissionNumber: SBY_KITIR,
            title: 'Pindah Datang',
            frontService: 'Pindah Datang',
            submittedAt: '2026-01-02T08:00:00Z',
            remarks: 'Data uji',
            processHistory: PROCESS_HISTORY,
          },
        },
      });
    }
    return c.json(gqlError('Unauthenticated: operasi ini tidak tersedia di fixture'), 401);
  });
}
