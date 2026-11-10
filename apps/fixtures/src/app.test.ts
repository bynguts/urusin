import { describe, expect, it } from 'vitest';
import { BASE, createApp, LOCAL_ONLY_ROUTES, MAX_UPLOAD_BYTES, TEST_CAPTCHA, TEST_HP } from './app.js';
import { loadConfig } from './config.js';
import { BANNER_TEXT } from './layout.js';

const ORIGIN = 'http://localhost:4320';
const headers = { host: 'localhost:4320', origin: ORIGIN };

function make(profile: 'public' | 'local' = 'public') {
  return createApp({ profile, port: 4320, publicOrigin: undefined });
}

async function login(app: ReturnType<typeof make>): Promise<string> {
  const res = await app.request(`${ORIGIN}${BASE}/users/login`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ hp: TEST_HP, captcha: TEST_CAPTCHA }),
  });
  expect(res.status).toBe(303);
  const cookie = res.headers.get('set-cookie') ?? '';
  return cookie.split(';')[0] ?? '';
}

function upload(app: ReturnType<typeof make>, cookie: string, file: File, id = '1') {
  const form = new FormData();
  form.set('id', id);
  form.set('uploadImage', file);
  return app.request(`${ORIGIN}${BASE}/pendaftaran/uploadSubmit`, {
    method: 'POST',
    headers: { ...headers, cookie },
    body: form,
  });
}

describe('config', () => {
  it('default: profil public, port 4320', () => {
    expect(loadConfig({})).toEqual({ profile: 'public', port: 4320, publicOrigin: undefined });
  });
  it('membaca FIXTURES_PROFILE dan FIXTURES_PORT, menolak nilai tidak valid', () => {
    expect(loadConfig({ FIXTURES_PROFILE: 'local', FIXTURES_PORT: '4999' }).port).toBe(4999);
    expect(() => loadConfig({ FIXTURES_PROFILE: 'prod' })).toThrow(/FIXTURES_PROFILE/);
    expect(() => loadConfig({ FIXTURES_PORT: 'abc' })).toThrow(/port/);
  });
});

describe('profil', () => {
  it('rute local-only 404 di public dan 501 (placeholder) di local', async () => {
    for (const path of LOCAL_ONLY_ROUTES) {
      expect((await make('public').request(`${ORIGIN}${path}`)).status).toBe(404);
      expect((await make('local').request(`${ORIGIN}${path}`)).status).toBe(501);
    }
  });

  it('public tanpa input password; local boleh punya', async () => {
    const pub = await (await make('public').request(`${ORIGIN}${BASE}/users/login`)).text();
    expect(pub).not.toMatch(/type="password"/);
    const local = await (await make('local').request(`${ORIGIN}${BASE}/users/login`)).text();
    expect(local).toMatch(/type="password"/);
  });
});

describe('semua halaman', () => {
  it('memuat banner FIXTURE, noindex, dan CSP', async () => {
    const app = make();
    const cookie = await login(app);
    for (const path of [
      '/',
      `${BASE}/users/login`,
      `${BASE}/welcome`,
      `${BASE}/pendaftaran/syarat/1`,
      `${BASE}/welcome/permohonan`,
      '/tidak-ada',
    ]) {
      const res = await app.request(`${ORIGIN}${path}`, { headers: { cookie } });
      const text = await res.text();
      expect(text, path).toContain(BANNER_TEXT);
      expect(text, path).toContain('noindex');
      expect(res.headers.get('x-robots-tag')).toContain('noindex');
      // bukan no-referrer: Chrome akan mengirim 'Origin: null' pada POST form dan cek anti-CSRF gagal
      expect(res.headers.get('referrer-policy')).toBe('same-origin');
      expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
    }
  });
});

describe('login', () => {
  it('menolak CAPTCHA salah dan redirect ke login bila belum masuk', async () => {
    const app = make();
    const bad = await app.request(`${ORIGIN}${BASE}/users/login`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ hp: TEST_HP, captcha: 'salah' }),
    });
    expect(bad.status).toBe(401);
    const anon = await app.request(`${ORIGIN}${BASE}/welcome/permohonan`);
    expect(anon.status).toBe(302);
    expect(anon.headers.get('location')).toBe(`${BASE}/users/login`);
  });

  it('menolak POST dengan Origin asing (anti-CSRF)', async () => {
    const res = await make().request(`${ORIGIN}${BASE}/users/login`, {
      method: 'POST',
      headers: {
        host: 'localhost:4320',
        origin: 'https://evil.example',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ hp: TEST_HP, captcha: TEST_CAPTCHA }),
    });
    expect(res.status).toBe(403);
  });

  it('publicOrigin https: cookie __Host- + Secure dan Origin harus persis', async () => {
    const app = createApp({ profile: 'public', port: 4320, publicOrigin: 'https://fx.example.com' });
    const ok = await app.request('https://fx.example.com' + `${BASE}/users/login`, {
      method: 'POST',
      headers: {
        host: 'fx.example.com',
        origin: 'https://fx.example.com',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ hp: TEST_HP, captcha: TEST_CAPTCHA }),
    });
    expect(ok.headers.get('set-cookie')).toMatch(/^__Host-fx_session=.*Secure/);
    const bad = await app.request('https://fx.example.com' + `${BASE}/users/login`, {
      method: 'POST',
      headers: {
        host: 'fx.example.com',
        origin: ORIGIN,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ hp: TEST_HP, captcha: TEST_CAPTCHA }),
    });
    expect(bad.status).toBe(403);
  });
});

describe('upload dan permohonan', () => {
  it('satu berkas per POST, redirect (reload), hitungan bertambah', async () => {
    const app = make();
    const cookie = await login(app);
    const count = async () => {
      const t = await (
        await app.request(`${ORIGIN}${BASE}/pendaftaran/uploadberkas/1`, { headers: { cookie } })
      ).text();
      return Number(/id="uploaded-count">(\d+)</.exec(t)?.[1]);
    };
    expect(await count()).toBe(0);
    const res = await upload(app, cookie, new File(['x'], 'a.png', { type: 'image/png' }));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${BASE}/pendaftaran/uploadberkas/1`);
    expect(await count()).toBe(1);
    await upload(app, cookie, new File(['y'], 'b.png', { type: 'image/png' }));
    expect(await count()).toBe(2);
  });

  it('menolak non-gambar dan berkas > 9 MB', async () => {
    const app = make();
    const cookie = await login(app);
    expect((await upload(app, cookie, new File(['x'], 'a.txt', { type: 'text/plain' }))).status).toBe(415);
    const big = new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], 'big.png', { type: 'image/png' });
    expect((await upload(app, cookie, big)).status).toBe(413);
  });

  it('Selesai menambah baris di Daftar Permohonan; baris awal deterministik', async () => {
    const app = make();
    const cookie = await login(app);
    const read = async () =>
      (await app.request(`${ORIGIN}${BASE}/welcome/permohonan`, { headers: { cookie } })).text();
    expect(await read()).toContain('Diproses (data uji)');
    const done = await app.request(`${ORIGIN}${BASE}/pendaftaran/selesai/2`, { headers: { cookie } });
    expect(done.status).toBe(303);
    expect(await read()).toContain('Baru diajukan (data uji)');
    // Nomor registrasi per baris (dibaca adapter pendamping sebagai bukti).
    expect(await read()).toContain('<td class="no-registrasi">FX-REG-0002</td>');
  });
});

describe('tiruan halaman tantangan bot (uji verifikasi situs)', () => {
  const tekan = (app: ReturnType<typeof make>, kembali: string) =>
    app.request(`${ORIGIN}/cdn-cgi/challenge-platform/uji/`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ kembali }),
    });

  it('tanpa cookie: 403 + cf-mitigated + judul interstitial + iframe widget; widget boleh dibingkai sendiri', async () => {
    const app = make();
    const res = await app.request(`${ORIGIN}/uji-cf/`);
    expect(res.status).toBe(403);
    expect(res.headers.get('cf-mitigated')).toBe('challenge');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    const t = await res.text();
    expect(t).toContain('<title>Just a moment... (fixture)</title>');
    expect(t).toContain('src="/cdn-cgi/challenge-platform/uji/?kembali=%2Fuji-cf%2F"');
    const w = await app.request(`${ORIGIN}/cdn-cgi/challenge-platform/uji/?kembali=%2Fuji-cf%2F`);
    expect(w.status).toBe(200);
    expect(w.headers.get('content-security-policy')).toContain("frame-ancestors 'self'");
    expect(await w.text()).toContain('id="saya-manusia"');
    expect((await app.request(`${ORIGIN}/cdn-cgi/challenge-platform/uji/?kembali=https://x`)).status).toBe(
      400,
    );
  });

  it('ketukan diterima -> cookie lolos -> halaman cek status; varian gagal selalu kembali ke tantangan', async () => {
    const app = make();
    const ok = await tekan(app, '/uji-cf/');
    expect(ok.status).toBe(303);
    expect(ok.headers.get('location')).toBe('/uji-cf/');
    const cookie = (ok.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const lolos = await app.request(`${ORIGIN}/uji-cf/`, { headers: { cookie } });
    expect(lolos.status).toBe(200);
    expect(await lolos.text()).toContain('id="nopol"');

    const gagal = await tekan(app, '/uji-cf/gagal/');
    expect(gagal.headers.get('set-cookie')).toBeNull();
    const lagi = await app.request(`${ORIGIN}/uji-cf/gagal/`, { headers: { cookie } });
    expect(lagi.status).toBe(403);
    expect((await tekan(app, '//evil.example/')).status).toBe(400);
  });

  it('varian lintas: widget dari origin pasangan (127.0.0.1 <-> localhost), kembali lewat jalur lolos induk', async () => {
    const app = make();
    const INDUK = 'http://127.0.0.1:4320';
    const induk = { host: '127.0.0.1:4320', origin: INDUK };
    const res = await app.request(`${INDUK}/uji-cf/lintas/`, { headers: induk });
    expect(res.status).toBe(403);
    expect(res.headers.get('content-security-policy')).toContain(`frame-src 'self' ${ORIGIN}`);
    expect(await res.text()).toContain(
      `src="${ORIGIN}/cdn-cgi/challenge-platform/uji/?kembali=%2Fuji-cf%2Flintas%2F&amp;asal=http%3A%2F%2F127.0.0.1%3A4320"`,
    );
    // Widget di localhost boleh dibingkai induk 127.0.0.1 dan mengirim form ke sana (tanpa X-Frame-Options).
    const w = await app.request(
      `${ORIGIN}/cdn-cgi/challenge-platform/uji/?kembali=%2Fuji-cf%2Flintas%2F&asal=${encodeURIComponent(INDUK)}`,
      { headers },
    );
    const csp = w.headers.get('content-security-policy') ?? '';
    expect(csp).toContain(`frame-ancestors 'self' ${INDUK}`);
    expect(csp).toContain(`form-action 'self' ${INDUK}`);
    expect(w.headers.get('x-frame-options')).toBeNull();
    expect(await w.text()).toContain(`name="asal" value="${INDUK}"`);
    // asal selain pasangan diabaikan: kembali ke kebijakan same-origin.
    const asing = await app.request(
      `${ORIGIN}/cdn-cgi/challenge-platform/uji/?kembali=%2Fuji-cf%2Flintas%2F&asal=https%3A%2F%2Fevil.example`,
      { headers },
    );
    expect(asing.headers.get('content-security-policy')).toMatch(/frame-ancestors 'self'$/);
    // Ketukan di widget -> 303 ke jalur lolos milik induk -> cookie di induk -> halaman lolos.
    const post = await app.request(`${ORIGIN}/cdn-cgi/challenge-platform/uji/`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ kembali: '/uji-cf/lintas/', asal: INDUK }),
    });
    expect(post.headers.get('location')).toBe(`${INDUK}/uji-cf/lintas/lolos`);
    const lolos = await app.request(`${INDUK}/uji-cf/lintas/lolos`, { headers: induk });
    expect(lolos.headers.get('location')).toBe('/uji-cf/lintas/');
    const cookie = (lolos.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const akhir = await app.request(`${INDUK}/uji-cf/lintas/`, { headers: { ...induk, cookie } });
    expect(akhir.status).toBe(200);
    expect(await akhir.text()).toContain('id="nopol"');
    // Host publik (bukan loopback): tidak ada pasangan, widget same-origin.
    const publik = await app.request('https://fixtures.contoh.id/uji-cf/lintas/', {
      headers: { host: 'fixtures.contoh.id' },
    });
    expect(await publik.text()).toContain(
      'src="/cdn-cgi/challenge-platform/uji/?kembali=%2Fuji-cf%2Flintas%2F"',
    );
  });

  it('varian kotak centang hanya di profil local: 200 tanpa cf-mitigated, judul + iframe, tanpa merek', async () => {
    const W = `${ORIGIN}/cdn-cgi/challenge-platform/uji/`;
    const pub = make('public');
    expect((await pub.request(`${ORIGIN}/uji-cf/kotak/`)).status).toBe(404);
    expect((await pub.request(`${W}?kembali=%2Fuji-cf%2Fkotak%2F&jenis=kotak`)).status).toBe(400);
    expect((await tekan(pub, '/uji-cf/kotak/')).status).toBe(400);

    const app = make('local');
    const res = await app.request(`${ORIGIN}/uji-cf/kotak/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cf-mitigated')).toBeNull();
    const t = await res.text();
    expect(t).toContain('<title>Performing security verification (fixture)</title>');
    expect(t).toContain('src="/cdn-cgi/challenge-platform/uji/?kembali=%2Fuji-cf%2Fkotak%2F&jenis=kotak"');
    expect(t).not.toMatch(/cloudflare/i);
    // Widget: kotak centang + skrip eksternal same-origin (CSP tanpa inline script tetap berlaku).
    const w = await app.request(`${W}?kembali=%2Fuji-cf%2Fkotak%2F&jenis=kotak`);
    expect(w.status).toBe(200);
    const wt = await w.text();
    expect(wt).toContain('id="kotak-manusia"');
    expect(wt).toContain('type="checkbox"');
    expect(wt).toContain('<script src="/cdn-cgi/challenge-platform/uji/kotak.js"></script>');
    expect(wt).not.toContain('id="saya-manusia"');
    expect(wt).not.toMatch(/cloudflare/i);
    const js = await app.request(`${W}kotak.js`);
    expect(js.headers.get('content-type')).toContain('text/javascript');
    expect(await js.text()).toContain("getElementById('kotak-manusia')");
    // Centang -> 303 + cookie lolos -> halaman cek status.
    const ok = await tekan(app, '/uji-cf/kotak/');
    expect(ok.status).toBe(303);
    expect(ok.headers.get('location')).toBe('/uji-cf/kotak/');
    const cookie = (ok.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const lolos = await app.request(`${ORIGIN}/uji-cf/kotak/`, { headers: { cookie } });
    expect(lolos.status).toBe(200);
    expect(await lolos.text()).toContain('id="nopol"');
  });
});
