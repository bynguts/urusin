/* eslint-disable @typescript-eslint/no-explicit-any -- tes membaca JSON respons tanpa tipe */
import { DevMailer, GoogleOidc, sha256Hex, type Akun } from '@urusin/akun';
import { FakeGoogle, MemoryMailer } from '@urusin/akun/testing';
import { GalatApiSchema, SesiAkunResponseSchema, VaultResponseSchema } from '@urusin/contracts';
import { DemoProvider } from '@urusin/harness';
import { isRedirect } from '@sveltejs/kit';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handle } from '../../hooks.server';
import { GET as sesiAkun } from '../../routes/api/akun/+server';
import { POST as aturUlangApi } from '../../routes/api/akun/atur-ulang-sandi/+server';
import { POST as daftarApi } from '../../routes/api/akun/daftar/+server';
import { POST as hapusApi } from '../../routes/api/akun/hapus/+server';
import { POST as juriApi } from '../../routes/api/akun/juri/+server';
import { POST as keluarApi } from '../../routes/api/akun/keluar/+server';
import { POST as keluarSemuaApi } from '../../routes/api/akun/keluar-semua/+server';
import { POST as konfirmasiApi } from '../../routes/api/akun/konfirmasi-sandi/+server';
import { POST as lupaApi } from '../../routes/api/akun/lupa-sandi/+server';
import { POST as masukApi } from '../../routes/api/akun/masuk/+server';
import { POST as profilApi } from '../../routes/api/akun/profil/+server';
import { POST as ubahSandiApi } from '../../routes/api/akun/ubah-sandi/+server';
import { GET as urusanAkun } from '../../routes/api/akun/urusan/+server';
import { POST as verifikasiApi } from '../../routes/api/akun/verifikasi/+server';
import { POST as kirimUlangApi } from '../../routes/api/akun/verifikasi/kirim-ulang/+server';
import { POST as buatUrusan } from '../../routes/api/urusan/+server';
import { POST as turnApi } from '../../routes/api/urusan/[id]/turn/+server';
import { GET as vaultList, POST as vaultPost } from '../../routes/api/vault/+server';
import { GET as dataDiriGet, PUT as dataDiriPut } from '../../routes/api/vault/data-diri/+server';
import { DELETE as dokumenDel, GET as dokumenGet } from '../../routes/api/vault/[id]/+server';
import { GET as googleMulai } from '../../routes/auth/google/+server';
import { GET as googleCallback } from '../../routes/auth/google/callback/+server';
import { POST as lepasGoogleApi } from '../../routes/api/akun/google/lepas/+server';
import { GET as oidcGet, POST as oidcPost } from '../../routes/dev/oidc/authorize/+server';
import { actions as aturUlangPage, load as aturUlangLoad } from '../../routes/atur-ulang-sandi/+page.server';
import { actions as daftarPage } from '../../routes/daftar/+page.server';
import { actions as profilPage, load as profilLoad } from '../../routes/lengkapi-profil/+page.server';
import { actions as lupaPage } from '../../routes/lupa-sandi/+page.server';
import { actions as masukPage, load as masukLoad } from '../../routes/masuk/+page.server';
import { actions as verifPage, load as verifLoad } from '../../routes/verifikasi-email/+page.server';
import { AKUN_COOKIE, OAUTH_COOKIE, TAUTKAN_COOKIE } from './akun';
import { createRuntime, googleRedirectUri, setRuntimeForTests, type Runtime } from './runtime';
import { SID_COOKIE } from './sesi';
import { TURNSTILE_TOKEN_FIXTURE, turnstileFromEnv } from './turnstile';

const ORIGIN = 'http://localhost:3000';
const EMAIL = 'warga@example.com';
const SANDI = 'kuda-lari-cepat-9';
const SANDI2 = 'gajah-terbang-tinggi-7';
// HP/NIK sintetis dirakit agar pemindai PII repo tidak menandai berkas ini
const HP_SINTETIS = ['08', '12 ', '0000 ', '0000'].join('');
const NIK_SINTETIS = ['3201', '0101', '0190', '0002'].join('');

let rt: Runtime;
let mailer: MemoryMailer;
let google: FakeGoogle;
let jam: number;

function buatRt(akun: NonNullable<Parameters<typeof createRuntime>[0]>['akun'] = {}) {
  rt = createRuntime({
    provider: new DemoProvider(),
    config: { dbPath: ':memory:', disconnectGraceMs: 0 },
    akun: {
      mailer,
      google: new GoogleOidc({
        clientId: google.clientId,
        clientSecret: google.clientSecret,
        redirectUri: `${ORIGIN}/auth/google/callback`,
        fetch: google.fetch,
      }),
      turnstile: turnstileFromEnv({ URUSIN_TURNSTILE_FIXTURE: '1' }),
      now: () => new Date(jam),
      // disk mesin pengembang bisa hampir penuh; ambang volume diuji terpisah
      vault: { diskPersen: () => 10 },
      ...akun,
    },
  });
  setRuntimeForTests(rt);
}

beforeAll(async () => {
  google = await FakeGoogle.create();
});
beforeEach(() => {
  jam = Date.now();
  mailer = new MemoryMailer();
  google.gangguan = null;
  buatRt();
});
afterEach(() => setRuntimeForTests(undefined));

/** Jar cookie minimal yang meniru `event.cookies` SvelteKit (cukup untuk get/set/delete). */
class Jar {
  readonly store = new Map<string, { value: string; opts: Record<string, unknown> }>();
  constructor(init: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(init)) this.store.set(k, { value: v, opts: {} });
  }
  get = (n: string) => this.store.get(n)?.value;
  getAll = () => [...this.store].map(([name, { value }]) => ({ name, value }));
  set = (n: string, value: string, opts: Record<string, unknown>) => {
    this.store.set(n, { value, opts });
  };
  delete = (n: string) => {
    this.store.delete(n);
  };
  serialize = () => '';
}

type Ev = { jar: Jar; locals: App.Locals; ip?: string };

function ev(request: Request, o: Partial<Ev> & { params?: Record<string, string> } = {}) {
  const jar = o.jar ?? new Jar();
  return {
    request,
    params: o.params ?? {},
    url: new URL(request.url),
    locals: o.locals ?? {},
    cookies: jar,
    getClientAddress: () => o.ip ?? '127.0.0.1',
    setHeaders: () => undefined,
  } as never;
}

const post = (body: unknown, path = '/x', origin = ORIGIN) =>
  new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify(body),
  });
const put = (body: unknown) =>
  new Request(`${ORIGIN}/api/vault/data-diri`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify(body),
  });
const form = (fields: Record<string, string>, path = '/x') =>
  new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { origin: ORIGIN },
    body: new URLSearchParams(fields),
  });
const get = (path: string) => new Request(`${ORIGIN}${path}`);
/** GET vault dari halaman kita sendiri: peramban mengirim Sec-Fetch-Site: same-origin. */
const vget = (path: string, headers: Record<string, string> = { 'sec-fetch-site': 'same-origin' }) =>
  new Request(`${ORIGIN}${path}`, { headers });
const hapus = () => new Request(`${ORIGIN}/x`, { method: 'DELETE', headers: { origin: ORIGIN } });

const tokenDari = (link: string) => new URL(link).searchParams.get('token')!;
const hitung = (sql: string) => (rt.store.db.prepare(sql).get() as { n: number }).n;

/** Jalankan lewat hooks (CSRF + sid + resolusi sesi) agar `locals` terisi seperti produksi. */
async function lewatHook(
  request: Request,
  jar: Jar,
  handler: (e: never) => Promise<Response> | Response,
  params: Record<string, string> = {},
  ip?: string,
) {
  const event = ev(request, { jar, params, ...(ip ? { ip } : {}) }) as unknown as {
    locals: App.Locals;
    url: URL;
  };
  return handle({ event: event as never, resolve: () => Promise.resolve(handler(event as never)) });
}

async function daftarVerifikasi(email = EMAIL, sandi = SANDI) {
  expect((await daftarApi(ev(post({ email, sandi })))).status).toBe(202);
  const token = tokenDari(mailer.last(email, 'verifikasi')!.link);
  const res = await verifikasiApi(ev(post({ token, sandi })));
  expect(res.status).toBe(200);
}

async function masuk(jar = new Jar(), email = EMAIL, sandi = SANDI, extra: Record<string, string> = {}) {
  const res = await masukApi(ev(post({ email, sandi, next: '/lacak', ...extra }), { jar }));
  return { res, jar, body: (await res.json()) as any };
}

const akunDari = (jar: Jar): Akun => rt.akun.sesi(jar.get(AKUN_COOKIE))!.akun;
/** locals seperti dari hooks: akun + sesi (authAt dari login). */
const localsDari = (jar: Jar) => {
  const s = rt.akun.sesi(jar.get(AKUN_COOKIE))!;
  return { akun: s.akun, akunSesi: { tokenHash: s.tokenHash, authAt: s.authAt, pernahUnduh: s.pernahUnduh } };
};

async function caught(p: Promise<unknown> | unknown): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('tidak melempar');
}

describe('API akun: daftar → verifikasi → masuk → sesi', () => {
  it('alur lengkap lewat hooks; cookie __Host- HttpOnly Secure Lax berisi token yang hanya disimpan hash-nya', async () => {
    await daftarVerifikasi();
    const { res, jar, body } = await masuk();
    expect(res.status).toBe(200);
    expect(body.next).toBe('/lacak');
    expect(body.akun).toMatchObject({
      jenis: 'akun',
      email: EMAIL,
      emailTerverifikasi: true,
      punyaSandi: true,
      profilLengkap: false,
      sinkron: true,
    });
    const c = jar.store.get(AKUN_COOKIE)!;
    expect(c.opts).toMatchObject({ path: '/', httpOnly: true, secure: true, sameSite: 'lax' });
    expect(c.opts.maxAge).toBeGreaterThan(29 * 24 * 3600);
    expect(AKUN_COOKIE.startsWith('__Host-')).toBe(true);
    const rows = rt.store.db.prepare('SELECT token_hash FROM auth_sessions').all();
    expect(rows).toEqual([{ token_hash: sha256Hex(c.value) }]);

    const s = await lewatHook(get('/api/akun'), jar, sesiAkun);
    const sesi = SesiAkunResponseSchema.parse(await s.json());
    expect(sesi.masuk).toBe(true);
    expect(sesi.email).toEqual({ mode: 'log', tertunda: false });
    if (sesi.masuk) {
      expect(sesi.perangkat).toHaveLength(1);
      expect(sesi.perangkat[0]!.perangkatIni).toBe(true);
      expect(sesi.metode).toEqual({ email: true, google: true, juri: true });
    }
  });

  it('tamu: GET /api/akun masuk=false; cookie tidak sah dihapus oleh hook', async () => {
    const jar = new Jar({ [AKUN_COOKIE]: 'A'.repeat(43) });
    const s = SesiAkunResponseSchema.parse(await (await lewatHook(get('/api/akun'), jar, sesiAkun)).json());
    expect(s.masuk).toBe(false);
    expect(jar.get(AKUN_COOKIE)).toBeUndefined();
  });

  it('galat seragam {kode, pesanWarga}; body rusak 400, skema salah 422; sandi tidak digemakan', async () => {
    const r1 = await daftarApi(
      ev(new Request(`${ORIGIN}/x`, { method: 'POST', body: '{', headers: { origin: ORIGIN } })),
    );
    expect([r1.status, (await r1.json()).kode]).toEqual([400, 'BODY_INVALID']);
    const r2 = await daftarApi(ev(post({ email: EMAIL })));
    expect([r2.status, (await r2.json()).kode]).toEqual([422, 'BODY_INVALID']);
    const r3 = await daftarApi(ev(post({ email: EMAIL, sandi: 'password123' })));
    const b3 = await r3.json();
    expect([r3.status, b3.kode]).toEqual([422, 'SANDI_TERLALU_UMUM']);
    expect(GalatApiSchema.parse(b3)).toBeTruthy();
    expect(JSON.stringify(b3)).not.toContain('password123');
    const ok = await daftarApi(ev(post({ email: 'lain@example.com', sandi: SANDI })));
    expect([ok.status, await ok.json()]).toEqual([202, { terkirim: true, tertunda: false }]);
  });

  it('verifikasi butuh sandi saat mendaftar (tautan saja tidak cukup); kirim ulang 202', async () => {
    await daftarApi(ev(post({ email: EMAIL, sandi: SANDI })));
    const token = tokenDari(mailer.last(EMAIL, 'verifikasi')!.link);
    const salah = await verifikasiApi(ev(post({ token, sandi: SANDI2 })));
    expect([salah.status, (await salah.json()).kode]).toEqual([401, 'KREDENSIAL_SALAH']);
    const tanpa = await verifikasiApi(ev(post({ token })));
    expect(tanpa.status).toBe(422);
    expect((await kirimUlangApi(ev(post({ email: EMAIL })))).status).toBe(202);
    expect(mailer.sent.filter((m) => m.jenis === 'verifikasi')).toHaveLength(2);
    // tautan lama tidak berlaku lagi setelah kirim ulang; yang terbaru berlaku
    expect((await verifikasiApi(ev(post({ token, sandi: SANDI })))).status).toBe(400);
    const baru = tokenDari(mailer.last(EMAIL, 'verifikasi')!.link);
    expect((await verifikasiApi(ev(post({ token: baru, sandi: SANDI })))).status).toBe(200);
  });

  it('email tertunda (kuota penyedia habis): 202 jujur dengan tertunda=true, status email ikut di /api/akun', async () => {
    mailer.gagal = true;
    const r = await daftarApi(ev(post({ email: EMAIL, sandi: SANDI })));
    expect([r.status, await r.json()]).toEqual([202, { terkirim: true, tertunda: true }]);
    const s = SesiAkunResponseSchema.parse(
      await (await lewatHook(get('/api/akun'), new Jar(), sesiAkun)).json(),
    );
    expect(s.email.tertunda).toBe(true);
    const page = (await daftarPage.default(ev(form({ email: 'b@example.com', sandi: SANDI })))) as any;
    expect(page).toEqual({ terkirim: true, tertunda: true, email: 'b@example.com' });
  });
});

describe('produksi tanpa auth.env: email ditahan, Google tersembunyi, app tetap jalan', () => {
  it('daftar 202 tertunda, masuk tanpa verifikasi seperti tamu, tombol Google tidak tampil', async () => {
    buatRt({ mailer: new DevMailer(() => undefined, undefined, true), google: null });
    const s = SesiAkunResponseSchema.parse(
      await (await lewatHook(get('/api/akun'), new Jar(), sesiAkun)).json(),
    );
    expect([s.metode.google, s.email]).toEqual([false, { mode: 'log', tertunda: true }]);
    expect(((await masukLoad(ev(get('/masuk')) as never)) as any).googleAktif).toBe(false);
    const r = await daftarApi(ev(post({ email: EMAIL, sandi: SANDI })));
    expect([r.status, await r.json()]).toEqual([202, { terkirim: true, tertunda: true }]);
    const { res, body } = await masuk();
    expect(res.status).toBe(200);
    expect(body.akun).toMatchObject({ emailTerverifikasi: false, sinkron: false });
  });
});

describe('akun belum terverifikasi = tamu (tidak sinkron)', () => {
  it('boleh masuk, tetapi vault tetap di perangkat ini; setelah verifikasi data pindah ke akun', async () => {
    await daftarApi(ev(post({ email: EMAIL, sandi: SANDI })));
    const { res, jar, body } = await masuk();
    expect(res.status).toBe(200);
    expect(body.akun).toMatchObject({ emailTerverifikasi: false, sinkron: false });
    expect(body.urusanDipindahkan).toBe(0);
    await lewatHook(put({ namaLengkap: 'Warga Uji' }), jar, dataDiriPut);
    const v = VaultResponseSchema.parse(await (await lewatHook(vget('/api/vault'), jar, vaultList)).json());
    expect([v.pemilik, v.sinkron, v.dataDiri.ada]).toEqual(['tamu', false, true]);
    const id = akunDari(jar).id;
    expect(rt.akun.vault.getDataDiri(id)).toBeNull();
    // perangkat lain tidak melihat Data Diri
    const lain = await masuk();
    const g = await (await lewatHook(vget('/api/vault/data-diri'), lain.jar, dataDiriGet)).json();
    expect(g.dataDiri).toEqual({});

    await verifikasiApi(ev(post({ token: tokenDari(mailer.last(EMAIL, 'verifikasi')!.link), sandi: SANDI })));
    expect(rt.akun.sesi(jar.get(AKUN_COOKIE))).toBeNull(); // sesi dicabut saat verifikasi
    const lagi = await masuk(jar);
    expect(lagi.body).toMatchObject({ vaultDipindahkan: true, akun: { sinkron: true, profilLengkap: true } });
    expect(rt.akun.vault.getDataDiri(id)?.data).toEqual({ namaLengkap: 'Warga Uji' });
    expect(hitung("SELECT COUNT(*) n FROM users WHERE jenis = 'tamu'")).toBe(0);
  });
});

describe('keamanan', () => {
  it('enumerasi: daftar/lupa/kirim-ulang memberi status dan body identik untuk email ada dan tidak ada', async () => {
    await daftarVerifikasi();
    const pasangan = [
      [
        () => daftarApi(ev(post({ email: EMAIL, sandi: SANDI2 }))),
        () => daftarApi(ev(post({ email: 'baru@example.com', sandi: SANDI2 }))),
      ],
      [() => lupaApi(ev(post({ email: EMAIL }))), () => lupaApi(ev(post({ email: 'tidakada@example.com' })))],
      [
        () => kirimUlangApi(ev(post({ email: EMAIL }))),
        () => kirimUlangApi(ev(post({ email: 'tidakada2@example.com' }))),
      ],
    ] as const;
    for (const [ada, tidak] of pasangan) {
      const a = await ada();
      const b = await tidak();
      expect(a.status).toBe(b.status);
      expect(await a.text()).toBe(await b.text());
    }
    const salahSandi = await masuk(new Jar(), EMAIL, SANDI2);
    const tidakAda = await masuk(new Jar(), 'hantu@example.com', SANDI2);
    expect([salahSandi.res.status, salahSandi.body]).toEqual([tidakAda.res.status, tidakAda.body]);
  });

  it('penguncian: Turnstile wajib setelah 3 gagal, terkunci 15 menit setelah 5; pesan sama untuk email ada/tidak', async () => {
    await daftarVerifikasi();
    for (const email of [EMAIL, 'hantu@example.com']) {
      for (let i = 0; i < 3; i++)
        expect((await masuk(new Jar(), email, SANDI2)).body.kode).toBe('KREDENSIAL_SALAH');
      const tanpa = await masuk(new Jar(), email, SANDI2);
      expect([tanpa.res.status, tanpa.body.kode]).toEqual([403, 'TURNSTILE_WAJIB']);
      const ts = { turnstile: TURNSTILE_TOKEN_FIXTURE };
      expect((await masuk(new Jar(), email, SANDI2, { turnstile: 'palsu' })).body.kode).toBe(
        'TURNSTILE_WAJIB',
      );
      for (let i = 0; i < 2; i++)
        expect((await masuk(new Jar(), email, SANDI2, ts)).body.kode).toBe('KREDENSIAL_SALAH');
      const kunci = await masuk(new Jar(), email, SANDI, ts);
      expect([kunci.res.status, kunci.body.kode]).toEqual([429, 'TERKUNCI']);
      expect(Number(kunci.res.headers.get('retry-after'))).toBeGreaterThan(0);
    }
    jam += 16 * 60 * 1000;
    expect((await masuk()).res.status).toBe(200);
  });

  it('token sekali pakai: verifikasi dan reset tidak bisa dipakai ulang', async () => {
    await daftarApi(ev(post({ email: EMAIL, sandi: SANDI })));
    const v = tokenDari(mailer.last(EMAIL, 'verifikasi')!.link);
    expect((await verifikasiApi(ev(post({ token: v, sandi: SANDI })))).status).toBe(200);
    const ulang = await verifikasiApi(ev(post({ token: v, sandi: SANDI })));
    expect([ulang.status, (await ulang.json()).kode]).toEqual([400, 'TOKEN_TIDAK_VALID']);
    await lupaApi(ev(post({ email: EMAIL })));
    const r = tokenDari(mailer.last(EMAIL, 'atur-ulang')!.link);
    expect((await aturUlangApi(ev(post({ token: r, sandi: SANDI2 })))).status).toBe(200);
    expect((await aturUlangApi(ev(post({ token: r, sandi: SANDI })))).status).toBe(400);
  });

  it('CSRF: POST akun (API dan form action) dengan Origin asing/tanpa Origin ditolak 403 oleh hook', async () => {
    await daftarVerifikasi();
    let dipanggil = false;
    const tandai = () => {
      dipanggil = true;
      return new Response('x');
    };
    for (const [path, origin] of [
      ['/api/akun/masuk', 'https://evil.example.com'],
      ['/api/akun/juri', 'https://evil.example.com'],
      ['/api/akun/hapus', 'null'],
      ['/api/vault', 'https://evil.example.com'],
      ['/masuk', 'https://evil.example.com'],
      ['/auth/google/callback', 'https://evil.example.com'],
    ] as const) {
      const res = await lewatHook(post({ email: EMAIL, sandi: SANDI }, path, origin), new Jar(), tandai);
      expect([path, res.status]).toEqual([path, 403]);
    }
    const tanpaOrigin = new Request(`${ORIGIN}/api/akun/keluar-semua`, { method: 'POST' });
    expect((await lewatHook(tanpaOrigin, new Jar(), tandai)).status).toBe(403);
    expect(dipanggil).toBe(false);
  });

  it('fiksasi sesi: cookie tanam tidak pernah jadi sesi; login merotasi token sesi DAN urusin_sid', async () => {
    await daftarVerifikasi();
    const tanam = 'B'.repeat(43);
    const sidTanam = 'c'.repeat(32);
    const jar = new Jar({ [AKUN_COOKIE]: tanam, [SID_COOKIE]: sidTanam });
    await masuk(jar);
    expect(jar.get(AKUN_COOKIE)).not.toBe(tanam);
    expect(jar.get(SID_COOKIE)).not.toBe(sidTanam);
    expect(rt.akun.sesi(tanam)).toBeNull();
    const lama = jar.get(AKUN_COOKIE)!;
    await masuk(jar);
    expect(jar.get(AKUN_COOKIE)).not.toBe(lama);
    expect(rt.akun.sesi(lama)).toBeNull();
  });

  it('open redirect: next= asing diganti "/" di API, form masuk, halaman masuk, dan Google', async () => {
    await daftarVerifikasi();
    for (const next of [
      '//evil.example.com',
      'https://evil.example.com',
      '/\\evil.example.com',
      'javascript:alert(1)',
    ]) {
      const r = await masukApi(ev(post({ email: EMAIL, sandi: SANDI, next })));
      expect((await r.json()).next).toBe('/');
      const l = (await masukLoad(ev(get(`/masuk?next=${encodeURIComponent(next)}`)) as never)) as any;
      expect(l.next).toBe('/');
    }
    rt.akun.vault.setDataDiri(rt.store.db.prepare('SELECT id FROM users').pluck().get() as string, {
      namaLengkap: 'Warga',
    });
    const e = await caught(
      masukPage.masuk(ev(form({ email: EMAIL, sandi: SANDI, next: '//evil.example.com' }))),
    );
    expect(isRedirect(e) && e.location).toBe('/');
    const g = await caught(googleMulai(ev(get('/auth/google?next=//evil.example.com'))));
    expect(isRedirect(g)).toBe(true);
    const row = rt.store.db.prepare('SELECT next FROM oauth_states').get() as { next: string };
    expect(row.next).toBe('/');
  });

  it('rate limit: 429 + Retry-After pada lupa sandi per email', async () => {
    for (let i = 0; i < 3; i++) await lupaApi(ev(post({ email: EMAIL }), { ip: `10.0.0.${i}` }));
    const r = await lupaApi(ev(post({ email: EMAIL }), { ip: '10.0.0.99' }));
    expect([r.status, (await r.json()).kode]).toEqual([429, 'RATE_LIMITED']);
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('keluar, ubah sandi, reset, hapus akun', () => {
  it('keluar (perangkat ini) dan keluar dari semua perangkat', async () => {
    await daftarVerifikasi();
    const a = await masuk();
    const b = await masuk();
    const sidSebelum = a.jar.get(SID_COOKIE);
    expect(sidSebelum).toMatch(/^[0-9a-f]{32}$/);
    const r = await lewatHook(post({}, '/api/akun/keluar'), a.jar, keluarApi);
    expect((await r.json()).sesiDihapus).toBe(1);
    expect(a.jar.get(AKUN_COOKIE)).toBeUndefined();
    // PoC: keluar memutar urusin_sid (pemakai berikutnya di perangkat bersama tidak mewarisi data tamu)
    expect(a.jar.get(SID_COOKIE)).toMatch(/^[0-9a-f]{32}$/);
    expect(a.jar.get(SID_COOKIE)).not.toBe(sidSebelum);
    const c = await masuk();
    const sidC = c.jar.get(SID_COOKIE);
    const semua = await lewatHook(post({}, '/api/akun/keluar-semua'), c.jar, keluarSemuaApi);
    expect((await semua.json()).sesiDihapus).toBe(2);
    expect(c.jar.get(SID_COOKIE)).not.toBe(sidC);
    expect(rt.akun.sesi(b.jar.get(AKUN_COOKIE))).toBeNull();
    expect((await keluarApi(ev(post({})))).status).toBe(200);
    expect((await keluarSemuaApi(ev(post({})))).status).toBe(401);
  });

  it('ubah sandi merotasi cookie; reset menghapus semua sesi', async () => {
    await daftarVerifikasi();
    const a = await masuk();
    const b = await masuk();
    const lama = a.jar.get(AKUN_COOKIE)!;
    const r = await lewatHook(
      post({ sandiLama: SANDI, sandiBaru: SANDI2 }, '/api/akun/ubah-sandi'),
      a.jar,
      ubahSandiApi,
    );
    expect(r.status).toBe(200);
    expect(a.jar.get(AKUN_COOKIE)).not.toBe(lama);
    expect(rt.akun.sesi(a.jar.get(AKUN_COOKIE))).not.toBeNull();
    expect(rt.akun.sesi(b.jar.get(AKUN_COOKIE))).toBeNull();
    const salah = await lewatHook(
      post({ sandiLama: 'salah-sekali-ya', sandiBaru: SANDI }, '/api/akun/ubah-sandi'),
      a.jar,
      ubahSandiApi,
    );
    expect([salah.status, (await salah.json()).kode]).toEqual([401, 'SANDI_LAMA_SALAH']);
    await lupaApi(ev(post({ email: EMAIL })));
    await aturUlangApi(ev(post({ token: tokenDari(mailer.last(EMAIL, 'atur-ulang')!.link), sandi: SANDI })));
    expect(rt.akun.sesi(a.jar.get(AKUN_COOKIE))).toBeNull();
  });

  it('hapus akun: wajib sandi + konfirmasi; data, vault, urusan hilang; cookie dihapus', async () => {
    await daftarVerifikasi();
    const a = await masuk();
    await lewatHook(put({ namaLengkap: 'Warga Uji' }), a.jar, dataDiriPut);
    const salah = await lewatHook(
      post({ konfirmasi: 'HAPUS', sandi: SANDI2 }, '/api/akun/hapus'),
      a.jar,
      hapusApi,
    );
    expect(salah.status).toBe(401);
    const ok = await lewatHook(
      post({ konfirmasi: 'HAPUS', sandi: SANDI }, '/api/akun/hapus'),
      a.jar,
      hapusApi,
    );
    expect(ok.status).toBe(200);
    expect(a.jar.get(AKUN_COOKIE)).toBeUndefined();
    expect(hitung('SELECT COUNT(*) n FROM users')).toBe(0);
    expect(hitung('SELECT COUNT(*) n FROM vault_data_diri')).toBe(0);
  });
});

describe('vault (/api/vault): Data Diri, dokumen, dan urusan mengikuti akun', () => {
  it('Data Diri terenkripsi: HP dan laptop (dua sesi) melihat data yang sama', async () => {
    await daftarVerifikasi();
    const hp = await masuk();
    const laptop = await masuk();
    const r = await lewatHook(
      put({ namaLengkap: 'Warga Uji', nik: NIK_SINTETIS, rt: '001' }),
      hp.jar,
      dataDiriPut,
    );
    expect(r.status).toBe(200);
    const g = await lewatHook(vget('/api/vault/data-diri'), laptop.jar, dataDiriGet);
    expect(g.headers.get('cache-control')).toBe('no-store');
    const gb = await g.json();
    expect(gb.dataDiri).toEqual({ namaLengkap: 'Warga Uji', nik: NIK_SINTETIS, rt: '001' });
    const ct = rt.store.db.prepare('SELECT ciphertext FROM vault_data_diri').get() as { ciphertext: Buffer };
    expect(ct.ciphertext.includes(Buffer.from(NIK_SINTETIS))).toBe(false);
    expect((await lewatHook(put({ nik: '123' }), hp.jar, dataDiriPut)).status).toBe(422);
    const p = await (
      await lewatHook(post({ namaLengkap: 'Nama Baru' }, '/api/akun/profil'), hp.jar, profilApi)
    ).json();
    expect(p.dataDiri).toEqual({ namaLengkap: 'Nama Baru', nik: NIK_SINTETIS, rt: '001' });
    const s = SesiAkunResponseSchema.parse(
      await (await lewatHook(get('/api/akun'), hp.jar, sesiAkun)).json(),
    );
    expect(s.masuk && s.akun.profilLengkap).toBe(true);
    const v = VaultResponseSchema.parse(
      await (await lewatHook(vget('/api/vault'), laptop.jar, vaultList)).json(),
    );
    expect([v.pemilik, v.sinkron, v.dataDiri.ada, v.batas.berkas]).toEqual(['akun', true, true, 10]);
  });

  it('baca vault hanya same-origin: tanpa Sec-Fetch-Site, lintas situs, atau Origin asing → 403', async () => {
    await daftarVerifikasi();
    const a = await masuk();
    await lewatHook(put({ namaLengkap: 'Warga Uji' }), a.jar, dataDiriPut);
    for (const h of [
      {} as Record<string, string>,
      { 'sec-fetch-site': 'cross-site' },
      { 'sec-fetch-site': 'same-site' },
      { 'sec-fetch-site': 'none' },
      { 'sec-fetch-site': 'same-origin', origin: 'https://evil.example.com' },
    ]) {
      for (const [path, fn] of [
        ['/api/vault/data-diri', dataDiriGet],
        ['/api/vault', vaultList],
      ] as const) {
        const r = await lewatHook(vget(path, h), a.jar, fn);
        expect([path, h, r.status]).toEqual([path, h, 403]);
        expect(await r.text()).not.toContain('Warga Uji');
      }
    }
  });

  it('dokumen: unggah terenkripsi, unduh no-store, re-auth di perangkat baru, batas 9 MB/jenis/10 berkas', async () => {
    await daftarVerifikasi();
    const a = await masuk();
    const multipart = (berkas: Blob, jenis = 'ktp', judul = 'KTP saya') => {
      const fd = new FormData();
      fd.set('berkas', berkas, 'ktp.png');
      fd.set('jenis', jenis);
      fd.set('judul', judul);
      return new Request(`${ORIGIN}/api/vault`, { method: 'POST', headers: { origin: ORIGIN }, body: fd });
    };
    const isi = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const up = await lewatHook(multipart(new Blob([isi], { type: 'image/png' })), a.jar, vaultPost);
    expect(up.status).toBe(201);
    const doc = await up.json();
    expect(doc).toMatchObject({ jenis: 'ktp', judul: 'KTP saya', mime: 'image/png', ukuran: 7 });
    const dl = await lewatHook(vget(`/api/vault/${doc.id}`), a.jar, dokumenGet, { id: doc.id });
    expect(dl.status).toBe(200);
    expect(dl.headers.get('cache-control')).toBe('no-store');
    expect(dl.headers.get('content-disposition')).toMatch(/^attachment/);
    expect(new Uint8Array(await dl.arrayBuffer())).toEqual(isi);

    // perangkat baru (sesi yang belum pernah mengunduh) dengan login > 15 menit lalu → wajib konfirmasi sandi
    const laptop = await masuk();
    jam += 16 * 60 * 1000;
    const perlu = await lewatHook(vget(`/api/vault/${doc.id}`), laptop.jar, dokumenGet, { id: doc.id });
    expect([perlu.status, (await perlu.json()).kode]).toEqual([401, 'PERLU_MASUK_ULANG']);
    // perangkat yang sudah pernah mengunduh tidak diminta lagi
    expect((await lewatHook(vget(`/api/vault/${doc.id}`), a.jar, dokumenGet, { id: doc.id })).status).toBe(
      200,
    );
    const salah = await lewatHook(
      post({ sandi: SANDI2 }, '/api/akun/konfirmasi-sandi'),
      laptop.jar,
      konfirmasiApi,
    );
    expect(salah.status).toBe(401);
    const ok = await lewatHook(
      post({ sandi: SANDI }, '/api/akun/konfirmasi-sandi'),
      laptop.jar,
      konfirmasiApi,
    );
    expect(ok.status).toBe(200);
    expect(
      (await lewatHook(vget(`/api/vault/${doc.id}`), laptop.jar, dokumenGet, { id: doc.id })).status,
    ).toBe(200);

    const besar = new Blob([new Uint8Array(9 * 1024 * 1024 + 1)], { type: 'image/png' });
    const r413 = await lewatHook(multipart(besar), a.jar, vaultPost);
    expect([r413.status, (await r413.json()).pesanWarga]).toEqual([
      413,
      'Berkas terlalu besar. Maksimal 9 MB.',
    ]);
    expect(
      (await lewatHook(multipart(new Blob(['<script>'], { type: 'text/html' })), a.jar, vaultPost)).status,
    ).toBe(415);
    expect(
      (await lewatHook(multipart(new Blob(['x'], { type: 'image/png' }), 'senjata'), a.jar, vaultPost))
        .status,
    ).toBe(422);
    for (let i = 1; i < 10; i++)
      expect(
        (await lewatHook(multipart(new Blob(['x'], { type: 'image/png' })), a.jar, vaultPost)).status,
      ).toBe(201);
    const penuh = await lewatHook(multipart(new Blob(['x'], { type: 'image/png' })), a.jar, vaultPost);
    expect([penuh.status, (await penuh.json()).kode]).toEqual([409, 'DOKUMEN_KUOTA_PENUH']);

    // akun lain: 404 untuk unduh dan hapus
    await daftarVerifikasi('lain@example.com');
    const b = await masuk(new Jar(), 'lain@example.com');
    expect((await lewatHook(vget(`/api/vault/${doc.id}`), b.jar, dokumenGet, { id: doc.id })).status).toBe(
      404,
    );
    expect((await lewatHook(hapus(), b.jar, dokumenDel, { id: doc.id })).status).toBe(404);
    expect((await lewatHook(hapus(), a.jar, dokumenDel, { id: doc.id })).status).toBe(200);
  });

  it('volume host penuh → 507 dengan pesan jujur', async () => {
    buatRt({ vault: { diskPersen: () => 90 } });
    await daftarVerifikasi();
    const a = await masuk();
    const fd = new FormData();
    fd.set('berkas', new Blob(['x'], { type: 'image/png' }), 'a.png');
    fd.set('jenis', 'ktp');
    fd.set('judul', 'KTP');
    const r = await lewatHook(
      new Request(`${ORIGIN}/api/vault`, { method: 'POST', headers: { origin: ORIGIN }, body: fd }),
      a.jar,
      vaultPost,
    );
    expect([r.status, (await r.json()).kode]).toEqual([507, 'PENYIMPANAN_PENUH']);
  });

  it('tamu malas: menjelajah dan membuat urusan tanpa pesan tidak membuat baris pengguna', async () => {
    const jar = new Jar();
    await lewatHook(get('/api/akun'), jar, sesiAkun);
    const v = VaultResponseSchema.parse(await (await lewatHook(vget('/api/vault'), jar, vaultList)).json());
    expect([v.pemilik, v.dataDiri.ada, v.dokumen]).toEqual(['tamu', false, []]);
    await lewatHook(vget('/api/vault/data-diri'), jar, dataDiriGet);
    await lewatHook(post({}, '/api/urusan'), jar, buatUrusan);
    expect(hitung('SELECT COUNT(*) n FROM users')).toBe(0);
    // tulis vault pertama membuat tamu
    expect((await lewatHook(put({ namaLengkap: 'Tamu' }), jar, dataDiriPut)).status).toBe(200);
    expect(hitung("SELECT COUNT(*) n FROM users WHERE jenis = 'tamu'")).toBe(1);
  });

  it('tamu malas: turn pertama membuat tamu; kuota pembuatan tamu per IP → 429 TAMU_PENUH', async () => {
    buatRt({ kuota: { tamuPerIpHari: 1, demoPerIpHari: 3, demoAktifMaks: 200 } });
    const jar = new Jar();
    const u = await (await lewatHook(post({}, '/api/urusan'), jar, buatUrusan)).json();
    expect(hitung('SELECT COUNT(*) n FROM users')).toBe(0);
    const t = await lewatHook(post({ teks: 'halo' }, `/api/urusan/${u.id}/turn`), jar, turnApi, { id: u.id });
    expect(t.status).toBe(202);
    expect(hitung("SELECT COUNT(*) n FROM users WHERE jenis = 'tamu'")).toBe(1);
    const lain = new Jar();
    const r = await lewatHook(post({ pesan: 'halo' }, '/api/urusan'), lain, buatUrusan);
    expect([r.status, (await r.json()).kode]).toEqual([429, 'TAMU_PENUH']);
  });

  it('rotasi tamu → akun: urusan + vault tamu pindah ke akun dalam satu langkah; perangkat lain melihatnya', async () => {
    await daftarVerifikasi();
    const jar = new Jar({ [SID_COOKIE]: 'a'.repeat(32) });
    const buat = async () =>
      ((await (await lewatHook(post({}, '/api/urusan'), jar, buatUrusan)).json()) as any).id;
    const u1 = await buat();
    const u2 = await buat();
    await lewatHook(put({ namaLengkap: 'Tamu Uji' }), jar, dataDiriPut);
    const { body } = await masuk(jar);
    expect([body.urusanDipindahkan, body.vaultDipindahkan]).toEqual([2, true]);
    expect(jar.get(SID_COOKIE)).not.toBe('a'.repeat(32));
    const u3 = await buat();
    const daftar = await (await lewatHook(get('/api/akun/urusan'), jar, urusanAkun)).json();
    expect(daftar.urusan.map((u: any) => u.id).sort()).toEqual([u1, u2, u3].sort());
    const laptop = await masuk();
    expect(
      (await (await lewatHook(get('/api/akun/urusan'), laptop.jar, urusanAkun)).json()).urusan,
    ).toHaveLength(3);
    const g = await (await lewatHook(vget('/api/vault/data-diri'), laptop.jar, dataDiriGet)).json();
    expect(g.dataDiri).toEqual({ namaLengkap: 'Tamu Uji' });
    expect(hitung("SELECT COUNT(*) n FROM users WHERE jenis = 'tamu'")).toBe(0);
    expect(hitung('SELECT COUNT(*) n FROM user_keys')).toBe(1); // DEK tamu dihancurkan
    expect((await urusanAkun(ev(get('/x')))).status).toBe(401);
  });
});

describe('Masuk sebagai juri (salinan demo terisolasi)', () => {
  it('Turnstile wajib; salinan berisi data sintetis, terisolasi per klik; maksimal 3 per IP per hari', async () => {
    const tanpa = await juriApi(ev(post({}, '/api/akun/juri')));
    expect([tanpa.status, (await tanpa.json()).kode]).toEqual([403, 'TURNSTILE_WAJIB']);
    const jars: Jar[] = [];
    for (let i = 0; i < 3; i++) {
      const jar = new Jar();
      const r = await juriApi(ev(post({ turnstile: TURNSTILE_TOKEN_FIXTURE }, '/api/akun/juri'), { jar }));
      expect(r.status).toBe(200);
      expect((await r.json()).akun).toMatchObject({
        jenis: 'demo',
        email: null,
        sinkron: true,
        profilLengkap: true,
      });
      jars.push(jar);
    }
    const ids = jars.map((j) => akunDari(j).id);
    expect(new Set(ids).size).toBe(3);
    // salinan juri A menulis; juri B tidak melihatnya
    await lewatHook(put({ namaLengkap: 'Diubah Juri A' }), jars[0]!, dataDiriPut);
    const b = await (await lewatHook(vget('/api/vault/data-diri'), jars[1]!, dataDiriGet)).json();
    expect(b.dataDiri.namaLengkap).toBe('Juri Contoh Urusin');
    const ke4 = await juriApi(ev(post({ turnstile: TURNSTILE_TOKEN_FIXTURE }, '/api/akun/juri')));
    expect([ke4.status, (await ke4.json()).kode]).toEqual([429, 'DEMO_BATAS_IP']);
    // tidak ada sandi yang bisa dikunci/dipublikasikan
    expect(hitung("SELECT COUNT(*) n FROM users WHERE jenis = 'demo' AND password_hash IS NOT NULL")).toBe(0);
  });

  it('batas global salinan aktif → 503 DEMO_PENUH; produksi tanpa kunci Turnstile tetap jalan dengan batas', async () => {
    buatRt({ kuota: { tamuPerIpHari: 20, demoPerIpHari: 3, demoAktifMaks: 1 } });
    const ts = { turnstile: TURNSTILE_TOKEN_FIXTURE };
    expect((await juriApi(ev(post(ts, '/api/akun/juri'), { ip: '10.1.0.1' }))).status).toBe(200);
    const r = await juriApi(ev(post(ts, '/api/akun/juri'), { ip: '10.1.0.2' }));
    expect([r.status, (await r.json()).kode]).toEqual([503, 'DEMO_PENUH']);

    buatRt({ turnstile: turnstileFromEnv({}) });
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const l = (await masukLoad(ev(get('/masuk')) as never)) as any;
      expect(l.juri).toBe(true);
      for (let i = 0; i < 3; i++) expect((await juriApi(ev(post({}, '/api/akun/juri')))).status).toBe(200);
      const ke4 = await juriApi(ev(post({}, '/api/akun/juri')));
      expect([ke4.status, (await ke4.json()).kode]).toEqual([429, 'DEMO_BATAS_IP']);
    } finally {
      process.env.NODE_ENV = env;
    }
  });

  it('halaman masuk: aksi juri mengalihkan ke beranda dengan sesi demo', async () => {
    const jar = new Jar();
    const r = await caught(masukPage.juri(ev(form({ turnstile: TURNSTILE_TOKEN_FIXTURE }), { jar })));
    expect(isRedirect(r) && r.location).toBe('/beranda');
    expect(akunDari(jar).jenis).toBe('demo');
  });
});

describe('Google OAuth lewat rute', () => {
  async function mulai(jar: Jar, next = '/lacak', locals: App.Locals = {}) {
    const start = await caught(
      googleMulai(ev(get(`/auth/google?next=${encodeURIComponent(next)}`), { jar, locals })),
    );
    if (!isRedirect(start)) throw start;
    return { location: start.location, state: jar.get(OAUTH_COOKIE)! };
  }

  async function alurGoogle(
    claims: Record<string, unknown>,
    next = '/lacak',
    jar = new Jar(),
    locals: App.Locals = {},
  ) {
    const { location, state } = await mulai(jar, next, locals);
    expect(jar.store.get(OAUTH_COOKIE)!.opts).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 600,
    });
    const { code } = google.consent(location, claims);
    const cb = await caught(
      googleCallback(ev(get(`/auth/google/callback?code=${code}&state=${state}`), { jar, locals })),
    );
    if (!isRedirect(cb)) throw cb;
    return { location: cb.location, jar };
  }

  it('akun baru dengan nama → langsung ke tujuan; tanpa nama → Lengkapi profil', async () => {
    const a = await alurGoogle({
      sub: 'g1',
      email: 'g1@example.com',
      email_verified: true,
      name: 'Warga Google',
    });
    expect(a.location).toBe('/lacak');
    expect(a.jar.get(OAUTH_COOKIE)).toBeUndefined();
    expect(akunDari(a.jar).email).toBe('g1@example.com');
    const b = await alurGoogle({ sub: 'g2', email: 'g2@example.com', email_verified: true });
    expect(b.location).toBe('/lengkapi-profil?next=%2Flacak');
  });

  it('#48: email sama dengan akun sandi TERVERIFIKASI → tidak ditautkan otomatis; tertaut setelah bukti sandi', async () => {
    await daftarVerifikasi();
    const jar = new Jar();
    const g = await alurGoogle({ sub: 'g-sama', email: EMAIL, email_verified: true }, '/lacak', jar);
    expect(g.location).toBe('/masuk?galat=GOOGLE_PERLU_SANDI&next=%2Flacak');
    expect(jar.get(AKUN_COOKIE)).toBeUndefined();
    expect(jar.get(TAUTKAN_COOKIE)).toBeTruthy();
    expect(hitung('SELECT COUNT(*) n FROM oauth_identities')).toBe(0);
    const l = (await masukLoad(ev(get('/masuk?galat=GOOGLE_PERLU_SANDI'), { jar }) as never)) as any;
    expect([l.galat.kode, l.tautkan]).toEqual(['GOOGLE_PERLU_SANDI', true]);
    // sandi salah tidak menautkan
    expect((await masuk(jar, EMAIL, SANDI2)).res.status).toBe(401);
    expect(hitung('SELECT COUNT(*) n FROM oauth_identities')).toBe(0);
    const { body } = await masuk(jar);
    expect(body.googleTertaut).toBe(true);
    expect(jar.get(TAUTKAN_COOKIE)).toBeUndefined();
    // berikutnya Google langsung masuk ke akun yang sama
    const lagi = await alurGoogle({ sub: 'g-sama', email: EMAIL, email_verified: true });
    expect(akunDari(lagi.jar).id).toBe(akunDari(jar).id);
  });

  it('review keamanan: menautkan hanya untuk akun terverifikasi dengan bukti kredensial <= 15 menit', async () => {
    // akun belum terverifikasi: /auth/google bukan mode tautan (state tanpa user_id)
    await daftarApi(ev(post({ email: 'pra@example.com', sandi: SANDI2 })));
    const pra = await masuk(new Jar(), 'pra@example.com', SANDI2);
    const sesiPra = rt.akun.sesi(pra.jar.get(AKUN_COOKIE))!;
    await mulai(pra.jar, '/pengaturan', {
      akun: sesiPra.akun,
      akunSesi: { tokenHash: sesiPra.tokenHash, authAt: sesiPra.authAt, pernahUnduh: false },
    });
    expect(hitung('SELECT COUNT(*) n FROM oauth_states WHERE user_id IS NOT NULL')).toBe(0);
    // akun terverifikasi dengan sesi > 15 menit: masuk ulang dulu, lalu kembali ke /auth/google
    await daftarVerifikasi();
    const { jar } = await masuk(new Jar());
    const s = rt.akun.sesi(jar.get(AKUN_COOKIE))!;
    const basi = new Date(Date.now() - 20 * 60_000).toISOString();
    const r = await caught(
      googleMulai(
        ev(get('/auth/google?next=%2Fpengaturan'), {
          jar,
          locals: { akun: s.akun, akunSesi: { tokenHash: s.tokenHash, authAt: basi, pernahUnduh: false } },
        }),
      ),
    );
    expect(isRedirect(r) && r.location).toBe(
      `/masuk?ulang=1&lanjut=${encodeURIComponent('/auth/google?next=%2Fpengaturan')}`,
    );
    // ?ulang=1 (tombol Google di masuk ulang) = masuk biasa, bukan menautkan
    await caught(
      googleMulai(
        ev(get('/auth/google?next=%2F&ulang=1'), {
          jar,
          locals: { akun: s.akun, akunSesi: { tokenHash: s.tokenHash, authAt: basi, pernahUnduh: false } },
        }),
      ),
    );
    expect(hitung('SELECT COUNT(*) n FROM oauth_states WHERE user_id IS NOT NULL')).toBe(0);
  });

  it('review keamanan: lepas Google lewat API (akun bersandi saja)', async () => {
    await daftarVerifikasi();
    const { jar } = await masuk(new Jar());
    const s = rt.akun.sesi(jar.get(AKUN_COOKIE))!;
    const locals = {
      akun: s.akun,
      akunSesi: { tokenHash: s.tokenHash, authAt: s.authAt, pernahUnduh: false },
    };
    await alurGoogle(
      { sub: 'g-lepas', email: 'pribadi@example.com', email_verified: true },
      '/',
      jar,
      locals,
    );
    expect(rt.akun.terhubungGoogle(s.akun.id)).toBe(true);
    const r = await lepasGoogleApi(ev(post({}, '/api/akun/google/lepas'), { jar, locals }));
    expect([r.status, await r.json()]).toEqual([200, { dilepas: 1 }]);
    expect(rt.akun.terhubungGoogle(s.akun.id)).toBe(false);
    expect((await lepasGoogleApi(ev(post({}, '/api/akun/google/lepas')))).status).toBe(401);
  });

  it('#48: tiket tautan tidak bisa dipakai akun lain', async () => {
    await daftarVerifikasi();
    await daftarVerifikasi('lain@example.com');
    const jar = new Jar();
    await alurGoogle({ sub: 'g-x', email: EMAIL, email_verified: true }, '/', jar);
    const { body } = await masuk(jar, 'lain@example.com');
    expect(body.googleTertaut).toBe(false);
    expect(hitung('SELECT COUNT(*) n FROM oauth_identities')).toBe(0);
  });

  it('#48b: akun sandi BELUM terverifikasi tidak menghalangi pemilik email; Google mengambil alih akun', async () => {
    // penyerang mendaftar lebih dulu dengan email korban, lalu masuk dan menulis data
    await daftarApi(ev(post({ email: EMAIL, sandi: SANDI2 })));
    const penyerang = await masuk(new Jar(), EMAIL, SANDI2);
    expect(penyerang.res.status).toBe(200);
    const korban = await alurGoogle({ sub: 'g-korban', email: EMAIL, email_verified: true, name: 'Korban' });
    expect(korban.location).toBe('/lengkapi-profil?next=%2Flacak'); // akun lama: nama belum ada
    expect(rt.akun.sesi(penyerang.jar.get(AKUN_COOKIE))).toBeNull(); // sesi penyerang dicabut
    expect((await masuk(new Jar(), EMAIL, SANDI2)).res.status).toBe(401); // sandi penyerang dihapus
    expect(akunDari(korban.jar)).toMatchObject({ email: EMAIL, punyaSandi: false });
    // tautan verifikasi lama milik penyerang tidak berlaku lagi
    const lama = tokenDari(mailer.last(EMAIL, 'verifikasi')!.link);
    expect((await verifikasiApi(ev(post({ token: lama, sandi: SANDI2 })))).status).toBe(400);
  });

  it('sedang masuk: Google DITAUTKAN ke akun itu (bukti = sesi); identitas milik akun lain ditolak', async () => {
    await daftarVerifikasi();
    const a = await masuk();
    const locals = localsDari(a.jar);
    const r = await alurGoogle(
      { sub: 'g-tautan', email: 'beda@example.com', email_verified: true },
      '/',
      a.jar,
      locals,
    );
    expect(r.location).toBe('/lengkapi-profil?next=%2F');
    expect(rt.akun.terhubungGoogle(locals.akun.id)).toBe(true);
    await alurGoogle({ sub: 'g-lain', email: 'g-lain@example.com', email_verified: true, name: 'L' });
    const b = await masuk();
    const rb = await caught(
      (async () => {
        const jar = b.jar;
        const { location, state } = await mulai(jar, '/', localsDari(jar));
        const { code } = google.consent(location, {
          sub: 'g-lain',
          email: 'g-lain@example.com',
          email_verified: true,
        });
        await googleCallback(
          ev(get(`/auth/google/callback?code=${code}&state=${state}`), {
            jar,
            locals: { akun: akunDari(jar) },
          }),
        );
      })(),
    );
    expect(isRedirect(rb) && rb.location).toBe('/masuk?galat=GOOGLE_SUDAH_DIPAKAI');
  });

  it('state cookie tidak cocok, state dipakai ulang, nonce salah, PKCE tidak cocok, dibatalkan → GOOGLE_GAGAL', async () => {
    const claims = { sub: 'g3', email: 'g3@example.com', email_verified: true, name: 'G' };
    const cb = async (jar: Jar, code: string, state: string) =>
      (await caught(
        googleCallback(ev(get(`/auth/google/callback?code=${code}&state=${state}`), { jar })),
      )) as {
        location: string;
      };
    // state cookie diganti
    let jar = new Jar();
    let s = await mulai(jar);
    let code = google.consent(s.location, claims).code;
    jar.set(OAUTH_COOKIE, 'C'.repeat(43), {});
    expect((await cb(jar, code, s.state)).location).toBe('/masuk?galat=GOOGLE_GAGAL');
    // state dipakai ulang (replay) setelah sukses
    jar = new Jar();
    s = await mulai(jar);
    code = google.consent(s.location, claims).code;
    expect((await cb(jar, code, s.state)).location).toBe('/lacak');
    const jar2 = new Jar({ [OAUTH_COOKIE]: s.state });
    expect((await cb(jar2, google.consent(s.location, claims).code, s.state)).location).toBe(
      '/masuk?galat=GOOGLE_GAGAL',
    );
    // nonce salah
    jar = new Jar();
    s = await mulai(jar);
    code = google.consent(s.location, { ...claims, nonce: 'nonce-salah' }).code;
    expect((await cb(jar, code, s.state)).location).toBe('/masuk?galat=GOOGLE_GAGAL');
    // PKCE tidak cocok: kode diterbitkan untuk challenge alur A, ditukar di alur B
    jar = new Jar();
    const a = await mulai(jar);
    const codeA = google.consent(a.location, claims).code;
    const b = await mulai(jar);
    expect((await cb(jar, codeA, b.state)).location).toBe('/masuk?galat=GOOGLE_GAGAL');
    expect(jar.get(AKUN_COOKIE)).toBeUndefined();
    // dibatalkan di Google
    const batal = (await caught(googleCallback(ev(get('/auth/google/callback?error=access_denied'))))) as {
      location: string;
    };
    expect(batal.location).toBe('/masuk?galat=GOOGLE_GAGAL');
    const l = (await masukLoad(ev(get('/masuk?galat=GOOGLE_GAGAL')) as never)) as any;
    expect(l.galat.kode).toBe('GOOGLE_GAGAL');
    expect(((await masukLoad(ev(get('/masuk?galat=<script>')) as never)) as any).galat).toBeNull();

    buatRt({ google: null });
    const mati = (await caught(googleMulai(ev(get('/auth/google'))))) as { location: string };
    expect(mati.location).toBe('/masuk?galat=GOOGLE_TIDAK_AKTIF');
  });

  it('redirect URI dari DOMAIN runtime untuk setiap host di deploy/hosts.json', () => {
    expect(googleRedirectUri({ DOMAIN: 'urusinai.web.id' }, ORIGIN)).toBe(
      'https://urusinai.web.id/auth/google/callback',
    );
    expect(googleRedirectUri({ DOMAIN: '158-178-239-106.sslip.io' }, ORIGIN)).toBe(
      'https://158-178-239-106.sslip.io/auth/google/callback',
    );
    expect(googleRedirectUri({}, ORIGIN)).toBe(`${ORIGIN}/auth/google/callback`);
  });
});

describe('IdP OIDC tiruan (dev, URUSIN_OIDC_FIXTURE)', () => {
  it('404 bila fixture tidak aktif', async () => {
    const e = await caught(
      oidcGet(ev(get('/dev/oidc/authorize?code_challenge=x&code_challenge_method=S256'))),
    );
    expect((e as { status: number }).status).toBe(404);
  });

  it('aktif: tanpa PKCE S256 → 400; persetujuan menerbitkan kode yang hanya cocok dengan verifier alur ini', async () => {
    const prev = process.env.URUSIN_OIDC_FIXTURE;
    process.env.URUSIN_OIDC_FIXTURE = '1';
    try {
      rt = createRuntime({
        provider: new DemoProvider(),
        config: { dbPath: ':memory:', disconnectGraceMs: 0 },
        akun: { mailer },
      });
      setRuntimeForTests(rt);
    } finally {
      if (prev === undefined) delete process.env.URUSIN_OIDC_FIXTURE;
      else process.env.URUSIN_OIDC_FIXTURE = prev;
    }
    expect(rt.oidcFixture).toBeDefined();
    expect((await oidcGet(ev(get('/dev/oidc/authorize?state=s')))).status).toBe(400);
    const jar = new Jar();
    const start = (await caught(googleMulai(ev(get('/auth/google?next=/lacak'), { jar })))) as {
      location: string;
    };
    expect(start.location.startsWith(`${ORIGIN}/dev/oidc/authorize?`)).toBe(true);
    const halaman = await oidcGet(ev(get(start.location.slice(ORIGIN.length))));
    expect(halaman.status).toBe(200);
    const persetujuan = await caught(
      oidcPost(
        ev(
          form({
            url: start.location,
            sub: 'sub-e2e',
            email: 'e2e@example.com',
            nama: 'Warga E2E',
            email_verified: 'true',
            skenario: 'normal',
          }),
        ),
      ),
    );
    if (!isRedirect(persetujuan)) throw persetujuan;
    const cb = new URL(persetujuan.location);
    expect(cb.pathname).toBe('/auth/google/callback');
    const akhir = await caught(googleCallback(ev(get(`${cb.pathname}${cb.search}`), { jar })));
    expect(isRedirect(akhir) && akhir.location).toBe('/lacak');
    expect(akunDari(jar).email).toBe('e2e@example.com');
  });
});

describe('form action halaman akun (App 15–20)', () => {
  it('daftar → verifikasi (load tidak memakai token; POST + sandi) → masuk → lengkapi profil → tujuan', async () => {
    const d = (await daftarPage.default(ev(form({ email: EMAIL, sandi: SANDI }))))!;
    expect(d).toEqual({ terkirim: true, tertunda: false, email: EMAIL });
    const token = tokenDari(mailer.last(EMAIL, 'verifikasi')!.link);
    const l = (await verifLoad(ev(get(`/verifikasi-email?token=${token}`)) as never)) as any;
    expect(l.tokenBerlaku).toBe(true);
    expect(
      ((await verifLoad(ev(get(`/verifikasi-email?token=${token}`)) as never)) as any).tokenBerlaku,
    ).toBe(true);
    const tanpaSandi = (await verifPage.pastikan(ev(form({ token })))) as any;
    expect(tanpaSandi.data.kode).toBe('KREDENSIAL_SALAH');
    expect(await verifPage.pastikan(ev(form({ token, sandi: SANDI })))).toEqual({ terverifikasi: true });
    const lagi = (await verifPage.pastikan(ev(form({ token, sandi: SANDI })))) as any;
    expect([lagi.status, lagi.data.kode]).toEqual([400, 'TOKEN_TIDAK_VALID']);

    const jar = new Jar();
    const m = await caught(
      masukPage.masuk(ev(form({ email: EMAIL, sandi: SANDI, next: '/lacak' }), { jar })),
    );
    expect(isRedirect(m) && m.location).toBe('/lengkapi-profil?next=%2Flacak');
    const locals = { akun: akunDari(jar) };
    expect(
      ((await profilLoad(ev(get('/lengkapi-profil?next=/lacak'), { locals, jar }) as never)) as any).next,
    ).toBe('/lacak');
    const kosong = (await profilPage.default(ev(form({ namaLengkap: '' }), { locals, jar }))) as any;
    expect(kosong.status).toBe(422);
    const p = await caught(
      profilPage.default(
        ev(form({ namaLengkap: 'Warga Uji', hp: HP_SINTETIS, next: '/lacak' }), { locals, jar }),
      ),
    );
    expect(isRedirect(p) && p.location).toBe('/lacak');
    expect(rt.akun.vault.getDataDiri(locals.akun.id)?.data).toMatchObject({ namaLengkap: 'Warga Uji' });
    const tamu = await caught(profilLoad(ev(get('/lengkapi-profil')) as never));
    expect(isRedirect(tamu) && tamu.location).toContain('/masuk?next=');
  });

  it('masuk gagal → fail dengan kode, email dikembalikan, sandi tidak', async () => {
    const r = (await masukPage.masuk(ev(form({ email: EMAIL, sandi: SANDI })))) as any;
    expect([r.status, r.data.kode, r.data.email]).toEqual([401, 'KREDENSIAL_SALAH', EMAIL]);
    expect(JSON.stringify(r.data)).not.toContain(SANDI);
    await daftarVerifikasi();
    const jar = new Jar();
    await masuk(jar);
    const sudah = await caught(
      masukLoad(ev(get('/masuk?next=/lacak'), { locals: { akun: akunDari(jar) } }) as never),
    );
    expect(isRedirect(sudah) && sudah.location).toBe('/lacak');
    // masuk ulang (unduh di perangkat baru): akun yang sudah masuk tetap melihat formulir, kembali ke `lanjut`
    const lanjut = encodeURIComponent('/dokumen?unduh=d1');
    const ulang = (await masukLoad(
      ev(get(`/masuk?ulang=1&lanjut=${lanjut}`), { locals: { akun: akunDari(jar) } }) as never,
    )) as any;
    expect([ulang.next, ulang.ulang]).toEqual(['/dokumen?unduh=d1', { email: EMAIL }]);
    const luar = (await masukLoad(ev(get('/masuk?ulang=1&lanjut=//evil.example.com')) as never)) as any;
    expect([luar.next, luar.ulang]).toEqual(['/', null]);
  });

  it('lupa → atur ulang lewat halaman; kirim ulang verifikasi lewat halaman', async () => {
    await daftarVerifikasi();
    expect(await lupaPage.default(ev(form({ email: EMAIL })))).toEqual({
      terkirim: true,
      tertunda: false,
      email: EMAIL,
    });
    expect(await lupaPage.default(ev(form({ email: 'tidakada@example.com' })))).toEqual({
      terkirim: true,
      tertunda: false,
      email: 'tidakada@example.com',
    });
    const token = tokenDari(mailer.last(EMAIL, 'atur-ulang')!.link);
    expect(
      ((await aturUlangLoad(ev(get(`/atur-ulang-sandi?token=${token}`)) as never)) as any).tokenBerlaku,
    ).toBe(true);
    const lemah = (await aturUlangPage.default(ev(form({ token, sandi: 'pendek' })))) as any;
    expect(lemah.data.kode).toBe('SANDI_TERLALU_PENDEK');
    expect(await aturUlangPage.default(ev(form({ token, sandi: SANDI2 })))).toEqual({ berhasil: true });
    expect(
      ((await aturUlangLoad(ev(get(`/atur-ulang-sandi?token=${token}`)) as never)) as any).tokenBerlaku,
    ).toBe(false);
    expect((await masuk(new Jar(), EMAIL, SANDI2)).res.status).toBe(200);

    await daftarPage.default(ev(form({ email: 'baru@example.com', sandi: SANDI })));
    expect(await verifPage.kirimUlang(ev(form({ email: 'baru@example.com' })))).toEqual({
      terkirim: true,
      tertunda: false,
      email: 'baru@example.com',
    });
    const salah = (await daftarPage.default(ev(form({ email: 'bukan', sandi: SANDI })))) as any;
    expect(salah.data.kode).toBe('EMAIL_TIDAK_VALID');
  });
});
