import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { BANNER_TEXT } from './layout.js';
import { SBY_KITIR, SBY_SERVICES } from './surabaya.js';
import { SMG_KODE } from './semarang.js';
import { OSS_NIB, SAMSAT_NB, SAMSAT_NC } from './samsat-oss.js';

const O = 'http://localhost:4320';
const H = { host: 'localhost:4320', origin: O };
const profiles = ['public', 'local'] as const;
const mk = (profile: (typeof profiles)[number]) =>
  createApp({ profile, port: 4320, publicOrigin: undefined });

const gql = (app: ReturnType<typeof mk>, query: string, variables?: object, preflight = true) =>
  app.request(
    `${O}/sby/new-api?query=${encodeURIComponent(query)}${variables ? `&variables=${encodeURIComponent(JSON.stringify(variables))}` : ''}`,
    { headers: preflight ? { 'apollo-require-preflight': 'true' } : {} },
  );

describe.each(profiles)('replika Surabaya (%s)', (profile) => {
  const app = mk(profile);

  it('semua halaman: banner + noindex', async () => {
    for (const p of [
      '/sby/',
      '/sby/app/login',
      '/sby/app/services',
      '/sby/app/tracking',
      '/sby/guide/fx-0001',
    ]) {
      const res = await app.request(`${O}${p}`);
      const text = await res.text();
      expect(res.status, p).toBe(200);
      expect(text, p).toContain(BANNER_TEXT);
      expect(text, p).toContain('noindex');
      expect(res.headers.get('x-robots-tag')).toContain('noindex');
    }
  });

  it('landing punya tiga pintu portal; katalog memuat kolom dan duplikat/entri uji seperti asli', async () => {
    const landing = await (await app.request(`${O}/sby/`)).text();
    for (const id of ['btn-login-warga', 'btn-portal-kelurahan', 'btn-portal-kecamatan'])
      expect(landing).toContain(id);
    const cat = await (await app.request(`${O}/sby/app/services`)).text();
    expect(cat).toContain('id="tblServices"');
    expect(cat.match(/data-id="fx-/g)).toHaveLength(SBY_SERVICES.length);
    expect(SBY_SERVICES.filter((s) => s.name === 'Akta Kelahiran').length).toBeGreaterThan(1);
  });

  it('GraphQL GET: wajib apollo-require-preflight, katalog JSON berbentuk asli', async () => {
    expect((await gql(app, '{ allPublicFrontServices { _id } }', undefined, false)).status).toBe(400);
    const res = await gql(app, '{ allPublicFrontServices { _id name } }');
    const rows = ((await res.json()) as { data: { allPublicFrontServices: Record<string, unknown>[] } }).data
      .allPublicFrontServices;
    expect(rows).toHaveLength(SBY_SERVICES.length);
    expect(Object.keys(rows[0]!)).toEqual(
      expect.arrayContaining(['_id', 'name', 'category', 'visibilityStatus', 'availabilityStatus', 'guides']),
    );
    expect((await gql(app, 'mutation { logInAsEndUser }')).status).toBe(401);
  });

  it('pelacakan publik: captcha matematika, kitir salah, kitir benar', async () => {
    const q = async (kitir: string, ans: string) =>
      (await app.request(`${O}/sby/app/tracking?kitir=${kitir}&captchaAnswer=${ans}&num1=3&num2=4`)).text();
    expect(await q(SBY_KITIR, '9')).toContain('tracking-error');
    expect(await q('SALAH', '7')).toContain('tracking-empty');
    const ok = await q(SBY_KITIR, '7');
    expect(ok).toContain('id="tracking-result"');
    // Rute halaman asli /tracking (alias) menyajikan halaman yang sama.
    const alias = await app.request(`${O}/sby/tracking?kitir=${SBY_KITIR}&captchaAnswer=7&num1=3&num2=4`);
    expect(await alias.text()).toContain('id="tracking-result"');
    expect(ok).toContain('Verifikasi');

    const viaGql = await gql(app, 'query { KitirHistory { submissionNumber } }', {
      kitir: SBY_KITIR,
      captchaAnswer: 7,
      num1: 3,
      num2: 4,
    });
    expect(
      ((await viaGql.json()) as { data: { KitirHistory: { submissionNumber: string } } }).data.KitirHistory
        .submissionNumber,
    ).toBe(SBY_KITIR);
    const bad = await gql(app, 'query { KitirHistory { submissionNumber } }', {
      kitir: SBY_KITIR,
      captchaAnswer: 1,
      num1: 3,
      num2: 4,
    });
    expect(JSON.stringify(await bad.json())).toContain('Captcha salah');
  });

  it('alur login/pengajuan tidak ditiru (read-only)', async () => {
    expect((await app.request(`${O}/sby/app/submissions`)).status).toBe(404);
    expect(await (await app.request(`${O}/sby/app/login`)).text()).toContain('login-unavailable');
  });
});

describe.each(profiles)('replika Semarang (%s)', (profile) => {
  const app = mk(profile);

  it('semua halaman: banner + noindex', async () => {
    for (const p of ['/smg/', '/smg/data-dukung', '/smg/bantuan', '/smg/cek-status']) {
      const res = await app.request(`${O}${p}`);
      const text = await res.text();
      expect(res.status, p).toBe(200);
      expect(text, p).toContain(BANNER_TEXT);
      expect(text, p).toContain('noindex');
      expect(res.headers.get('x-robots-tag')).toContain('noindex');
    }
  });

  it('/data-dukung: persyaratan statis per layanan, tanpa JS', async () => {
    const text = await (await app.request(`${O}/smg/data-dukung`)).text();
    for (const id of ['akta-lahir', 'kk', 'kedatangan', 'pindah-keluar'])
      expect(text).toContain(`id="tab-${id}"`);
    expect(text).toContain('SKPWNI');
    expect(text).not.toContain('<script');
  });

  async function session() {
    const page = await app.request(`${O}/smg/cek-status`);
    const cookie = (page.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const html = await page.text();
    const token = /name="_token" value="([^"]+)"/.exec(html)?.[1] ?? '';
    expect(html).toContain(`<meta name="csrf-token" content="${token}"`);
    return { cookie, token };
  }
  const post = (cookie: string, fields: Record<string, string>) =>
    app.request(`${O}/smg/cek-status/get-pengajuan`, {
      method: 'POST',
      headers: { ...H, cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields),
    });

  it('cek-status: 419 tanpa token/cookie, galat kode, galat captcha, tidak ditemukan, sukses', async () => {
    const { cookie, token } = await session();
    expect((await post('', { _token: token, kode_layanan: SMG_KODE, captcha: '7' })).status).toBe(419);
    expect((await post(cookie, { _token: 'salah', kode_layanan: SMG_KODE, captcha: '7' })).status).toBe(419);
    expect(
      await (await post(cookie, { _token: token, kode_layanan: 'PENDEK', captcha: '7' })).json(),
    ).toHaveProperty('gagal');
    expect(
      await (await post(cookie, { _token: token, kode_layanan: SMG_KODE, captcha: '1' })).json(),
    ).toHaveProperty('captcha');
    expect(
      await (await post(cookie, { _token: token, kode_layanan: 'X'.repeat(16), captcha: '7' })).json(),
    ).toEqual({
      gagal: 'Data tidak ditemukan',
    });
    expect(
      await (await post(cookie, { _token: token, kode_layanan: SMG_KODE, captcha: '7' })).json(),
    ).toMatchObject({
      kode_layanan: SMG_KODE,
      flag_status: 'Siap Diambil',
    });
  });

  it('captcha berupa gambar SVG; skrip ajax disajikan dari origin sendiri (patuh CSP)', async () => {
    const img = await app.request(`${O}/smg/captcha/math`);
    expect(img.headers.get('content-type')).toContain('image/svg+xml');
    const js = await app.request(`${O}/smg/static/cek-status.js`);
    expect(js.headers.get('content-type')).toContain('javascript');
    expect(await (await app.request(`${O}/smg/cek-status`)).text()).toContain(
      'src="/smg/static/cek-status.js"',
    );
  });

  it('login dan daftar tidak ditiru; POST dari Origin asing ditolak', async () => {
    expect((await app.request(`${O}/smg/pelapor/login`)).status).toBe(404);
    const { cookie, token } = await session();
    const res = await app.request(`${O}/smg/cek-status/get-pengajuan`, {
      method: 'POST',
      headers: {
        host: 'localhost:4320',
        origin: 'https://evil.example',
        cookie,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ _token: token, kode_layanan: SMG_KODE, captcha: '7' }),
    });
    expect(res.status).toBe(403);
  });
});

describe.each(profiles)('replika Samsat + OSS (%s)', (profile) => {
  const app = mk(profile);

  it('semua halaman: banner + noindex; skrip OSS dari origin sendiri', async () => {
    for (const p of ['/samsat/', '/oss/id']) {
      const res = await app.request(`${O}${p}`);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain(BANNER_TEXT);
      expect(body).toContain('noindex');
    }
    expect(await (await app.request(`${O}/oss/id`)).text()).toContain('src="/oss/static/nib.js"');
    const js = await app.request(`${O}/oss/static/nib.js`);
    expect(js.headers.get('content-type')).toContain('javascript');
  });

  it('Samsat: form FINPPKB + wadah verifikasi tanpa token asli; POST cocok/tidak; terakhir tercatat', async () => {
    const form = await (await app.request(`${O}/samsat/`)).text();
    for (const s of ['name="FINPPKB"', 'name="nb"', 'name="nc"', 'class="cf-turnstile', 'name="BTNSUB"'])
      expect(form).toContain(s);
    expect(form).toContain('value="replika-bukan-token"');
    const kirim = (nb: string, nc: string) =>
      app.request(`${O}/samsat/`, {
        method: 'POST',
        headers: { ...H, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ nb, nc, flag: '2' }),
      });
    const ok = await (await kirim(SAMSAT_NB, SAMSAT_NC.toLowerCase())).text();
    expect(ok).toContain('id="content_pkb"');
    expect(ok).toContain(`B ${SAMSAT_NB} ${SAMSAT_NC}`);
    expect(await (await app.request(`${O}/samsat/uji/terakhir`)).json()).toEqual({
      terakhir: { nb: SAMSAT_NB, nc: SAMSAT_NC },
    });
    expect(await (await kirim('9999', 'X')).text()).toContain('id="pkb-kosong"');
    const asing = await app.request(`${O}/samsat/`, {
      method: 'POST',
      headers: { host: 'localhost:4320', origin: 'https://evil.example' },
      body: new URLSearchParams({ nb: SAMSAT_NB }),
    });
    expect(asing.status).toBe(403);
  });

  it('OSS: API NIB JSON (ditemukan / tidak); terakhir tercatat', async () => {
    const cari = (nib: string) =>
      app.request(`${O}/oss/v1/reg/public/nib`, {
        method: 'POST',
        headers: { ...H, 'content-type': 'application/json' },
        body: JSON.stringify({ dataNib: { nib } }),
      });
    expect(await (await cari(OSS_NIB)).json()).toMatchObject({ kode: 200, data: { nib: OSS_NIB } });
    expect(await (await app.request(`${O}/oss/uji/terakhir`)).json()).toEqual({ terakhir: { nib: OSS_NIB } });
    expect(await (await cari('1')).json()).toEqual({ kode: 404, data: null });
    const rusak = await app.request(`${O}/oss/v1/reg/public/nib`, { method: 'POST', headers: H, body: 'x' });
    expect(await rusak.json()).toEqual({ kode: 404, data: null });
  });
});
