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
  });
});
