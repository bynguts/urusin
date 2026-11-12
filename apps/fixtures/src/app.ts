import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { secureHeaders } from 'hono/secure-headers';
import { asalSah, JALUR_LINTAS, JALUR_WIDGET, originLintas, registerUjiCf } from './cf.js';
import type { Config } from './config.js';
import { html, page } from './layout.js';
import { registerGenerik } from './generik/index.js';
import { registerPoisoned } from './poisoned.js';
import { registerSamsatOss } from './samsat-oss.js';
import { registerSemarang } from './semarang.js';
import { registerSimulasi } from './simulasi.js';
import { registerSurabaya } from './surabaya.js';
import { createStore, nomorRegistrasi, SERVICES, type Session } from './store.js';

/**
 * Fixture mimic struktur DOM Telunjuk Sakti (recon read-only): login + CAPTCHA gambar yang diketik warga,
 * syarat, uploadberkas (satu berkas per POST, halaman reload), dan daftar permohonan.
 * Semua data FIKTIF. Tidak menyimpan isi berkas, hanya nama + ukuran di memori.
 */

export const TEST_HP = '08000000001';
export const TEST_CAPTCHA = 'DEV123';
export const MAX_UPLOAD_BYTES = 9 * 1024 * 1024;
export const BASE = '/telunjuksakti/index.php';

/** Rute khusus profil `local` (placeholder; akan diisi fixture phishing/injection/drift). Di `public` = 404. */
export const LOCAL_ONLY_ROUTES = [
  '/__local/phishing-login',
  '/__local/prompt-injection',
  '/__local/drift',
] as const;

export function createApp(config: Config) {
  const app = new Hono();
  const store = createStore();
  const secure = config.publicOrigin?.startsWith('https://') === true;
  const cookieName = secure ? '__Host-fx_session' : 'fx_session';

  const keamanan = (frameAncestors: string[], lintas: string | null = null) =>
    secureHeaders({
      // Widget lintas-origin: X-Frame-Options SAMEORIGIN akan memblokir induk beda origin (frame-ancestors cukup).
      xFrameOptions: !(lintas && frameAncestors.includes(lintas)),
      // same-origin (bukan no-referrer): no-referrer membuat Chrome mengirim "Origin: null" pada POST form.
      referrerPolicy: 'same-origin',
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        formAction: lintas ? ["'self'", lintas] : ["'self'"],
        frameAncestors,
        ...(lintas ? { frameSrc: ["'self'", lintas] } : {}),
      },
    });
  const ketat = keamanan(["'none'"]);
  // Widget tantangan tiruan dimuat dalam iframe halaman fixture sendiri (X-Frame-Options bawaan SAMEORIGIN).
  const widget = keamanan(["'self'"]);
  app.use('*', (c, next) => {
    const host = c.req.header('host');
    if (c.req.path.startsWith(JALUR_WIDGET)) {
      // Widget yang dibingkai induk lintas-origin (pasangan loopback) boleh dibingkai dan mengirim form ke induk.
      const asal = asalSah(c.req.query('asal'), host);
      return asal ? keamanan(["'self'", asal], asal)(c, next) : widget(c, next);
    }
    if (c.req.path === JALUR_LINTAS) {
      const pasangan = originLintas(host);
      if (pasangan) return keamanan(["'none'"], pasangan)(c, next);
    }
    return ketat(c, next);
  });
  app.use('*', async (c, next) => {
    await next();
    c.header('X-Robots-Tag', 'noindex, nofollow');
    c.header('Cache-Control', 'no-store');
  });

  // Anti-CSRF: setiap POST wajib Origin persis (publik) atau sama dengan Host (dev).
  app.use('*', async (c, next) => {
    if (c.req.method !== 'POST') return next();
    const origin = c.req.header('origin');
    const expected = config.publicOrigin ?? `${new URL(c.req.url).protocol}//${c.req.header('host') ?? ''}`;
    if (origin !== expected) return c.text('Origin ditolak', 403);
    return next();
  });

  const session = (c: Parameters<typeof getCookie>[0]): Session | undefined =>
    store.get(getCookie(c, cookieName));

  app.get('/health', (c) => c.json({ ok: true, profile: config.profile }));

  app.get('/', (c) =>
    c.html(
      page(
        'Fixture layanan publik',
        html`<p>Situs tiruan untuk pengujian. Profil: <strong>${config.profile}</strong>.</p>
          <ul>
            <li><a href="${BASE}/users/login">Login</a></li>
            <li><a href="${BASE}/welcome/permohonan">Daftar permohonan</a></li>
            <li><a href="/sby/">Replika Klampid Surabaya (publik)</a></li>
            <li><a href="/smg/">Replika Si D'nOK Semarang (publik)</a></li>
            <li><a href="/uji-cf/">Tiruan halaman tantangan bot (uji verifikasi situs)</a></li>
            <li><a href="/generik/">Replika portal generik (uji Navigator)</a></li>
          </ul>`,
      ),
    ),
  );

  app.get(`${BASE}/users/login`, (c) => {
    const password =
      config.profile === 'local'
        ? html`<label for="password">Password</label><input id="password" name="password" type="password" />`
        : '';
    return c.html(
      page(
        'Masuk',
        html`<div class="note">
            Kredensial uji (publik, fiktif): HP <code>${TEST_HP}</code>, kode CAPTCHA
            <code>${TEST_CAPTCHA}</code>.
          </div>
          <form method="post" action="${BASE}/users/login">
            <label for="hp">Nomor HP</label>
            <input id="hp" name="hp" type="text" autocomplete="off" />
            ${password}
            <label for="captcha">Masukkan kode diatas</label>
            <img id="captcha-img" src="/captcha.svg" alt="CAPTCHA placeholder" width="160" height="48" />
            <input id="captcha" name="captcha" type="text" autocomplete="off" />
            <p><button type="submit" name="loginSubmit" id="loginSubmit">Masuk</button></p>
          </form>`,
      ),
    );
  });

  // Gambar placeholder: tidak memuat jawaban; warga mengetik kode uji yang tercetak di halaman.
  app.get('/captcha.svg', (c) =>
    c.body(
      '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="48"><rect width="160" height="48" fill="#ddd"/><text x="80" y="30" font-family="monospace" font-size="16" text-anchor="middle" fill="#333">CAPTCHA FIXTURE</text></svg>',
      200,
      { 'Content-Type': 'image/svg+xml' },
    ),
  );

  app.post(`${BASE}/users/login`, async (c) => {
    const body = await c.req.parseBody();
    if (body.hp !== TEST_HP || body.captcha !== TEST_CAPTCHA) {
      return c.html(
        page(
          'Masuk gagal',
          html`<p id="login-error">HP atau kode CAPTCHA salah.</p>
            <a href="${BASE}/users/login">Coba lagi</a>`,
        ),
        401,
      );
    }
    const id = store.create();
    setCookie(c, cookieName, id, { path: '/', httpOnly: true, sameSite: 'Lax', secure });
    return c.redirect(`${BASE}/welcome`, 303);
  });

  app.get(`${BASE}/users/logout`, (c) => {
    store.delete(getCookie(c, cookieName));
    deleteCookie(c, cookieName, { path: '/', secure });
    return c.redirect(`${BASE}/users/login`, 303);
  });

  const requireLogin = (c: Parameters<typeof session>[0]) => session(c);

  app.get(`${BASE}/welcome`, (c) => {
    if (!requireLogin(c)) return c.redirect(`${BASE}/users/login`, 302);
    return c.html(
      page(
        'Beranda',
        html`<p>Selamat datang, Penguji Fiktif.</p>
          <ul>
            ${SERVICES.map((s) => html`<li><a href="${BASE}/pendaftaran/syarat/${s.id}">${s.name}</a></li>`)}
          </ul>
          <p>
            <a href="${BASE}/welcome/permohonan">Daftar Permohonan</a> ·
            <a href="${BASE}/users/logout">Keluar</a>
          </p>`,
      ),
    );
  });

  app.get(`${BASE}/pendaftaran/syarat/:id`, (c) => {
    if (!requireLogin(c)) return c.redirect(`${BASE}/users/login`, 302);
    const svc = SERVICES.find((s) => String(s.id) === c.req.param('id'));
    if (!svc) return c.html(page('Tidak ditemukan', html`<p>Layanan tidak ada.</p>`), 404);
    return c.html(
      page(
        `Syarat: ${svc.name}`,
        html`<ol id="syarat">
            ${svc.requirements.map((r) => html`<li>${r}</li>`)}
          </ol>
          <p><a id="btnUpload" href="${BASE}/pendaftaran/uploadberkas/${svc.id}">Upload Berkas</a></p>`,
      ),
    );
  });

  app.get(`${BASE}/pendaftaran/uploadberkas/:id`, (c) => {
    const s = requireLogin(c);
    if (!s) return c.redirect(`${BASE}/users/login`, 302);
    const svc = SERVICES.find((x) => String(x.id) === c.req.param('id'));
    if (!svc) return c.html(page('Tidak ditemukan', html`<p>Layanan tidak ada.</p>`), 404);
    const files = s.uploads.get(svc.id) ?? [];
    return c.html(
      page(
        `Upload Berkas: ${svc.name}`,
        html`<p>
            Upload semua gambar berkas persyaratan satu persatu, jika semua sudah terupload klik tombol
            selesai.
          </p>
          <p>Berkas terunggah: <span id="uploaded-count">${files.length}</span></p>
          <ul id="uploaded-list">
            ${files.map((f) => html`<li class="uploaded-item">${f.name} (${f.size} byte)</li>`)}
          </ul>
          <form method="post" action="${BASE}/pendaftaran/uploadSubmit" enctype="multipart/form-data">
            <input type="hidden" name="id" value="${svc.id}" />
            <label for="uploadImage">Foto berkas (maks 9 MB, gambar)</label>
            <input id="uploadImage" name="uploadImage" type="file" accept="image/*" />
            <p><button type="submit" name="btnSubmit" id="btnSubmit">Upload</button></p>
          </form>
          <p><a id="btnSelesai" href="${BASE}/pendaftaran/selesai/${svc.id}">Selesai</a></p>`,
      ),
    );
  });

  app.post(`${BASE}/pendaftaran/uploadSubmit`, async (c) => {
    const s = requireLogin(c);
    if (!s) return c.redirect(`${BASE}/users/login`, 302);
    const body = await c.req.parseBody();
    const svc = SERVICES.find((x) => String(x.id) === String(body.id));
    const file = body.uploadImage;
    if (!svc) return c.html(page('Tidak ditemukan', html`<p>Layanan tidak ada.</p>`), 404);
    if (!(file instanceof File) || file.size === 0) {
      return c.html(page('Gagal', html`<p id="upload-error">Pilih berkas gambar terlebih dahulu.</p>`), 400);
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return c.html(page('Gagal', html`<p id="upload-error">Berkas melebihi 9 MB.</p>`), 413);
    }
    if (!file.type.startsWith('image/')) {
      return c.html(page('Gagal', html`<p id="upload-error">Hanya berkas gambar.</p>`), 415);
    }
    // Hanya metadata (nama + ukuran) di memori; isi berkas dibuang.
    s.uploads.set(svc.id, [...(s.uploads.get(svc.id) ?? []), { name: file.name, size: file.size }]);
    return c.redirect(`${BASE}/pendaftaran/uploadberkas/${svc.id}`, 303); // halaman reload tiap unggahan
  });

  // "Selesai" = aksi final milik warga (tautan, seperti situs asli).
  app.get(`${BASE}/pendaftaran/selesai/:id`, (c) => {
    const s = requireLogin(c);
    if (!s) return c.redirect(`${BASE}/users/login`, 302);
    const svc = SERVICES.find((x) => String(x.id) === c.req.param('id'));
    if (!svc) return c.html(page('Tidak ditemukan', html`<p>Layanan tidak ada.</p>`), 404);
    s.applications.push({
      no: s.applications.length + 1,
      layanan: svc.name,
      tanggal: '2026-01-03',
      status: 'Baru diajukan (data uji)',
    });
    return c.redirect(`${BASE}/welcome/permohonan`, 303);
  });

  app.get(`${BASE}/welcome/permohonan`, (c) => {
    const s = requireLogin(c);
    if (!s) return c.redirect(`${BASE}/users/login`, 302);
    return c.html(
      page(
        'Daftar Permohonan',
        html`<table id="tblPermohonan">
          <thead>
            <tr>
              <th>No</th>
              <th>No. Registrasi</th>
              <th>Layanan</th>
              <th>Tanggal</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${s.applications.map(
              (a) =>
                html`<tr>
                  <td>${a.no}</td>
                  <td class="no-registrasi">${nomorRegistrasi(a.no)}</td>
                  <td>${a.layanan}</td>
                  <td>${a.tanggal}</td>
                  <td class="status">${a.status}</td>
                </tr>`,
            )}
          </tbody>
        </table>`,
      ),
    );
  });

  // Replika alur publik read-only (jinak, ada di kedua profil).
  registerSurabaya(app);
  registerSemarang(app, { secure });
  registerSamsatOss(app);
  // Formulir simulasi demo juri (sudah "masuk", tanpa dinding login replika) di replika berformulir.
  registerSimulasi(app);
  registerUjiCf(app, { kotak: config.profile === 'local' });
  // Replika portal generik untuk Navigator (ADR 0030); varian injeksi/umpan + halaman racun hanya di local.
  registerGenerik(app, { secure, local: config.profile === 'local' });

  // Rute berbahaya: terdaftar HANYA di profil local (placeholder), tidak ada sama sekali di public (404).
  if (config.profile === 'local') {
    registerPoisoned(app);
    for (const path of LOCAL_ONLY_ROUTES) {
      app.get(path, (c) =>
        c.html(page('Placeholder profil local', html`<p>Belum diimplementasi: ${path}</p>`), 501),
      );
    }
  }

  app.notFound((c) => c.html(page('Tidak ditemukan', html`<p>Halaman tidak ada.</p>`), 404));
  return app;
}
