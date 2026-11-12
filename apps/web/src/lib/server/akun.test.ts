/* eslint-disable @typescript-eslint/no-explicit-any -- tes membaca JSON respons tanpa tipe */
import { DEFAULT_KUOTA, DevMailer, GoogleOidc, sha256Hex, type Akun } from '@urusin/akun';
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
import { POST as buatUrusan } from '../../routes/api/urusan/+server';
import { GET as statusUrusan } from '../../routes/api/urusan/[id]/+server';
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
import { actions as lupaPage, load as lupaLoad } from '../../routes/lupa-sandi/+page.server';
import { actions as masukPage, load as masukLoad } from '../../routes/masuk/+page.server';
import { actions as pengaturanPage, load as pengaturanLoad } from '../../routes/pengaturan/+page.server';
import { GET as verifikasiEmailLama } from '../../routes/verifikasi-email/+server';
import { AKUN_COOKIE, OAUTH_COOKIE, TAUTKAN_COOKIE } from './akun';
import { modePendamping, modeUjiPendamping } from './pendamping/pemilik';
import { createRuntime, googleRedirectUri, setRuntimeForTests, type Runtime } from './runtime';
import { ensureSession, SID_COOKIE, TERAKHIR_COOKIE } from './sesi';
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

type InitRt = NonNullable<Parameters<typeof createRuntime>[0]>;

function buatRt(akun: InitRt['akun'] = {}, provider: InitRt['provider'] = new DemoProvider()) {
  rt = createRuntime({
    provider,
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

/**
 * Model yang menunggu sampai turn dibatalkan, tanpa kerja CPU. Untuk tes yang hanya butuh turn DIMULAI (tamu malas):
 * turn demo penuh di latar memakan ~1,5 s CPU (6+ s di runner ARM) dan menahan permintaan berikutnya.
 */
class ModelDiam extends DemoProvider {
  override create(_p: unknown, opts: { signal?: AbortSignal | undefined } = {}): Promise<never> {
    return new Promise((_, tolak) =>
      opts.signal?.addEventListener('abort', () => tolak(new Error('dibatalkan'))),
    );
  }
}

/** Sesi juri (salinan demo) tanpa hash sandi: pemilik/sesi murah untuk tes yang tidak menguji sandi. */
async function masukJuri(jar = new Jar(), ip = '127.0.0.1') {
  const r = await juriApi(ev(post({ turnstile: TURNSTILE_TOKEN_FIXTURE }, '/api/akun/juri'), { jar, ip }));
  expect(r.status).toBe(200);
  return { jar };
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

/**
 * Data tamu lama (dibuat sebelum wajib akun, masih ada di DB saat deploy): handler dipanggil langsung dengan sid
 * perangkat, sebab hooks kini menolak API urusan/brankas tanpa sesi akun (401 BELUM_MASUK).
 */
function tamuLama(
  request: Request,
  jar: Jar,
  handler: (e: never) => Promise<Response> | Response,
  params: Record<string, string> = {},
) {
  return Promise.resolve(handler(ev(request, { jar, params, locals: { sid: ensureSession(jar as never) } })));
}

/** Daftar lewat API: akun penuh dan sesi langsung terpasang di `jar` (tanpa email verifikasi, ADR 0032). */
async function daftarAkun(email = EMAIL, sandi = SANDI, jar = new Jar()) {
  const res = await daftarApi(ev(post({ email, sandi }, '/api/akun/daftar'), { jar }));
  expect(res.status).toBe(200);
  return { res, jar, body: (await res.json()) as any };
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

describe('API akun: daftar (langsung masuk) → sesi → masuk', () => {
  it('daftar = akun penuh + sesi lewat hooks; cookie __Host- HttpOnly Secure Lax berisi token yang hanya disimpan hash-nya', async () => {
    const { res, jar, body } = await daftarAkun();
    expect(body.next).toBe('/beranda');
    expect(body.akun).toMatchObject({
      jenis: 'akun',
      email: EMAIL,
      punyaSandi: true,
      terhubungGoogle: false,
      profilLengkap: false,
      sinkron: true,
    });
    expect(body.akun).toHaveProperty('emailTerverifikasi', true); // deprecated, selalu true
    expect([body.urusanDipindahkan, body.vaultDipindahkan, body.googleTertaut]).toEqual([0, false, false]);
    expect(res.headers.get('set-cookie')).toBeNull(); // cookie lewat event.cookies, bukan header manual
    expect(mailer.sent).toHaveLength(0); // tidak ada email verifikasi
    const c = jar.store.get(AKUN_COOKIE)!;
    expect(c.opts).toMatchObject({ path: '/', httpOnly: true, secure: true, sameSite: 'lax' });
    expect(c.opts.maxAge).toBeGreaterThan(29 * 24 * 3600);
    expect(AKUN_COOKIE.startsWith('__Host-')).toBe(true);
    expect(jar.get(SID_COOKIE)).toMatch(/^[0-9a-f]{32}$/);
    const rows = rt.store.db.prepare('SELECT token_hash FROM auth_sessions').all();
    expect(rows).toEqual([{ token_hash: sha256Hex(c.value) }]);

    const s = await lewatHook(get('/api/akun'), jar, sesiAkun);
    const mentah = (await s.json()) as any;
    expect(mentah.akun).toHaveProperty('emailTerverifikasi', true);
    const sesi = SesiAkunResponseSchema.parse(mentah);
    expect(sesi.masuk).toBe(true);
    expect(sesi.email).toEqual({ mode: 'log', tertunda: false });
    if (sesi.masuk) {
      expect([sesi.akun.email, sesi.akun.sinkron]).toEqual([EMAIL, true]);
      expect(sesi.perangkat).toHaveLength(1);
      expect(sesi.perangkat[0]!.perangkatIni).toBe(true);
      expect(sesi.metode).toEqual({ email: true, google: true, juri: true });
    }

    // Perangkat lain: masuk biasa dengan sandi yang sama, ke tujuan `next`.
    const m = await masuk();
    expect([m.res.status, m.body.next]).toEqual([200, '/lacak']);
    expect(m.body.akun).toMatchObject({ email: EMAIL, sinkron: true });
    expect(akunDari(m.jar).id).toBe(akunDari(jar).id);
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
    expect(hitung('SELECT COUNT(*) n FROM users')).toBe(0);
    const ok = await daftarAkun('lain@example.com');
    expect(ok.body.akun.email).toBe('lain@example.com');
  });

  it('email ganda: API 409 EMAIL_SUDAH_TERDAFTAR tanpa sesi; form action fail 409 dengan kode; akun lama utuh', async () => {
    const pertama = await daftarAkun();
    const id = akunDari(pertama.jar).id;
    const jar = new Jar();
    const r = await daftarApi(ev(post({ email: EMAIL, sandi: SANDI2 }, '/api/akun/daftar'), { jar }));
    const b = (await r.json()) as any;
    expect([r.status, b.kode]).toEqual([409, 'EMAIL_SUDAH_TERDAFTAR']);
    expect(GalatApiSchema.parse(b).pesanWarga).toBe('Email ini sudah terdaftar. Silakan masuk.');
    expect(JSON.stringify(b)).not.toContain(SANDI2);
    expect(r.headers.get('set-cookie')).toBeNull();
    expect(jar.get(AKUN_COOKIE)).toBeUndefined();

    const halaman = (await daftarPage.default(
      ev(form({ email: EMAIL, sandi: SANDI2 }, '/daftar'), { jar }),
    )) as any;
    expect(halaman).toMatchObject({
      status: 409,
      data: { kode: 'EMAIL_SUDAH_TERDAFTAR', email: EMAIL },
    });
    expect(JSON.stringify(halaman.data)).not.toContain(SANDI2);
    expect(jar.get(AKUN_COOKIE)).toBeUndefined();

    // Akun lama tidak berubah: sesinya tetap, sandi lama berlaku, sandi penyerang tidak.
    expect(hitung('SELECT COUNT(*) n FROM users')).toBe(1);
    expect(hitung('SELECT COUNT(*) n FROM auth_sessions')).toBe(1);
    expect(rt.akun.sesi(pertama.jar.get(AKUN_COOKIE))?.akun.id).toBe(id);
    expect((await masuk(new Jar(), EMAIL, SANDI2)).res.status).toBe(401);
    expect((await masuk(new Jar(), EMAIL, SANDI)).res.status).toBe(200);
  });

  it('daftar tidak mengirim email: penyedia email gagal tidak menghalangi akun (API dan form action)', async () => {
    mailer.gagal = true;
    const { body } = await daftarAkun();
    expect(body.akun).toMatchObject({ email: EMAIL, sinkron: true });
    const jar = new Jar();
    const r = await caught(daftarPage.default(ev(form({ email: 'b@example.com', sandi: SANDI }), { jar })));
    expect(isRedirect(r) && r.location).toBe('/beranda');
    expect(akunDari(jar).email).toBe('b@example.com');
    expect(mailer.sent).toHaveLength(0);
    const s = SesiAkunResponseSchema.parse(
      await (await lewatHook(get('/api/akun'), new Jar(), sesiAkun)).json(),
    );
    expect(s.email.tertunda).toBe(false);
  });
});

describe('produksi tanpa auth.env: email ditahan, Google tersembunyi, app tetap jalan', () => {
  it('daftar langsung jadi akun sinkron, tombol Google tidak tampil, lupa sandi nonaktif dengan jujur', async () => {
    buatRt({ mailer: new DevMailer(() => undefined, undefined, true), google: null });
    const s = SesiAkunResponseSchema.parse(
      await (await lewatHook(get('/api/akun'), new Jar(), sesiAkun)).json(),
    );
    expect([s.metode.google, s.email]).toEqual([false, { mode: 'log', tertunda: true }]);
    expect(((await masukLoad(ev(get('/masuk')) as never)) as any).googleAktif).toBe(false);
    const d = await daftarAkun();
    expect(d.body.akun).toMatchObject({ jenis: 'akun', sinkron: true });
    const { res, body } = await masuk();
    expect(res.status).toBe(200);
    expect(body.akun).toMatchObject({ sinkron: true });

    // Lupa sandi: tautan tidak akan pernah sampai → 503 ATUR_ULANG_NONAKTIF (API, form action), load tersedia:false.
    expect(await lupaLoad(ev(get('/lupa-sandi')) as never)).toEqual({ tersedia: false, googleAktif: false });
    const api = await lupaApi(ev(post({ email: EMAIL })));
    const ab = (await api.json()) as any;
    expect([api.status, ab.kode]).toEqual([503, 'ATUR_ULANG_NONAKTIF']);
    expect(GalatApiSchema.parse(ab)).toBeTruthy();
    expect(await lupaPage.default(ev(form({ email: EMAIL }, '/lupa-sandi')))).toMatchObject({
      status: 503,
      data: { kode: 'ATUR_ULANG_NONAKTIF', email: EMAIL },
    });
    expect(hitung('SELECT COUNT(*) n FROM email_tokens')).toBe(0);
  });
});

describe('daftar memindahkan data tamu ke akun baru', () => {
  it('API: urusan + vault tamu pindah ke akun dalam satu langkah; sid diputar; perangkat lain melihatnya', async () => {
    const sidTamu = 'a'.repeat(32);
    const jar = new Jar({ [SID_COOKIE]: sidTamu });
    const buat = async () =>
      ((await (await tamuLama(post({}, '/api/urusan'), jar, buatUrusan)).json()) as any).id as string;
    const u1 = await buat();
    const u2 = await buat();
    expect((await tamuLama(put({ namaLengkap: 'Tamu Uji' }), jar, dataDiriPut)).status).toBe(200);
    expect(hitung("SELECT COUNT(*) n FROM users WHERE jenis = 'tamu'")).toBe(1);

    const { body } = await daftarAkun(EMAIL, SANDI, jar);
    expect([body.urusanDipindahkan, body.vaultDipindahkan]).toEqual([2, true]);
    expect(body.akun).toMatchObject({ sinkron: true, profilLengkap: true });
    expect(jar.get(SID_COOKIE)).not.toBe(sidTamu);
    const id = akunDari(jar).id;
    expect(rt.akun.urusanMilik(id).sort()).toEqual([u1, u2].sort());
    expect(rt.akun.vault.getDataDiri(id)?.data).toEqual({ namaLengkap: 'Tamu Uji' });
    expect(hitung("SELECT COUNT(*) n FROM users WHERE jenis = 'tamu'")).toBe(0);
    const v = VaultResponseSchema.parse(await (await lewatHook(vget('/api/vault'), jar, vaultList)).json());
    expect([v.pemilik, v.sinkron, v.dataDiri.ada]).toEqual(['akun', true, true]);

    // Perangkat lain (masuk dengan sandi): urusan dan Data Diri ikut akun.
    const laptop = await masuk();
    const daftar = await (await lewatHook(get('/api/akun/urusan'), laptop.jar, urusanAkun)).json();
    expect(daftar.urusan.map((u: any) => u.id).sort()).toEqual([u1, u2].sort());
    const g = await (await lewatHook(vget('/api/vault/data-diri'), laptop.jar, dataDiriGet)).json();
    expect(g.dataDiri).toEqual({ namaLengkap: 'Tamu Uji' });
    // Cookie tamu lama tidak lagi memiliki apa pun.
    const bekas = new Jar({ [SID_COOKIE]: sidTamu });
    const r = await tamuLama(new Request(`${ORIGIN}/api/urusan/${u1}`), bekas, statusUrusan, { id: u1 });
    expect(r.status).toBe(404);
    // Lewat hooks, tanpa sesi akun bahkan tidak sampai ke handler: wajib akun.
    const h = await lewatHook(new Request(`${ORIGIN}/api/urusan/${u1}`), bekas, statusUrusan, { id: u1 });
    expect([h.status, (await h.json()).kode]).toEqual([401, 'BELUM_MASUK']);
  });

  it('form action: data tamu pindah, lalu ke /beranda dengan sesi akun', async () => {
    const jar = new Jar({ [SID_COOKIE]: 'b'.repeat(32) });
    const { id } = (await (await tamuLama(post({}, '/api/urusan'), jar, buatUrusan)).json()) as any;
    await tamuLama(put({ namaLengkap: 'Tamu Form' }), jar, dataDiriPut);
    const r = await caught(daftarPage.default(ev(form({ email: EMAIL, sandi: SANDI }, '/daftar'), { jar })));
    expect(isRedirect(r) && [r.status, r.location]).toEqual([303, '/beranda']);
    const akun = akunDari(jar);
    expect(rt.akun.urusanMilik(akun.id)).toEqual([id]);
    expect(rt.akun.vault.getDataDiri(akun.id)?.data).toEqual({ namaLengkap: 'Tamu Form' });
    const s = SesiAkunResponseSchema.parse(await (await lewatHook(get('/api/akun'), jar, sesiAkun)).json());
    expect(s.masuk && [s.akun.email, s.akun.sinkron, s.akun.profilLengkap]).toEqual([EMAIL, true, true]);
  });
});

describe('sesi akun aktif dengan sid yang masih memegang data tamu (review L1)', () => {
  it('hooks menggabungkan urusan + vault tamu ke akun (data akun tidak ditimpa) lalu memutar sid', async () => {
    const { jar } = await daftarAkun();
    const id = akunDari(jar).id;
    await lewatHook(put({ namaLengkap: 'Nama Akun', pekerjaan: 'Petani' }), jar, dataDiriPut);
    // Sisa data tamu pada sid perangkat ini (mis. vault satu perangkat akun lama sebelum ADR 0032).
    const sidTamu = 'c'.repeat(32);
    const tamu = new Jar({ [SID_COOKIE]: sidTamu });
    const u = ((await (await tamuLama(post({}, '/api/urusan'), tamu, buatUrusan)).json()) as any)
      .id as string;
    expect(
      (await tamuLama(put({ namaLengkap: 'Nama Tamu', tempatLahir: 'Wonogiri' }), tamu, dataDiriPut)).status,
    ).toBe(200);
    const tamuId = rt.akun.tamuDariSid(sidTamu)!;
    rt.akun.vault.putDocument(tamuId, {
      jenis: 'ktp',
      judul: 'KTP',
      mime: 'image/png',
      bytes: Buffer.from('x'),
    });
    // Data tamu sid LAIN (perangkat/orang lain) tidak boleh ikut terambil.
    const sidLain = 'd'.repeat(32);
    const lain = new Jar({ [SID_COOKIE]: sidLain });
    const uLain = ((await (await tamuLama(post({}, '/api/urusan'), lain, buatUrusan)).json()) as any)
      .id as string;
    await tamuLama(put({ namaLengkap: 'Orang Lain' }), lain, dataDiriPut);

    jar.set(SID_COOKIE, sidTamu, {});
    const res = await lewatHook(get('/api/akun'), jar, sesiAkun);
    expect(res.status).toBe(200);
    const sidBaru = jar.get(SID_COOKIE)!;
    expect(sidBaru).toMatch(/^[0-9a-f]{32}$/);
    expect(sidBaru).not.toBe(sidTamu);
    expect(rt.akun.urusanMilik(id)).toEqual([u]);
    // Data Diri digabung: nilai akun menang, isian tamu melengkapi; dokumen tamu ikut pindah.
    expect(rt.akun.vault.getDataDiri(id)?.data).toEqual({
      namaLengkap: 'Nama Akun',
      pekerjaan: 'Petani',
      tempatLahir: 'Wonogiri',
    });
    expect(rt.akun.vault.listDocuments(id).map((d) => d.judul)).toEqual(['KTP']);
    // sid lama tidak lagi memegang apa pun
    expect(rt.akun.sidMemegangDataTamu(sidTamu)).toBe(false);
    expect(rt.akun.tamuDariSid(sidTamu)).toBeUndefined();
    const curi = new Jar({ [SID_COOKIE]: sidTamu });
    expect((await tamuLama(get(`/api/urusan/${u}`), curi, statusUrusan, { id: u })).status).toBe(404);
    // tamu sid lain utuh dan tetap miliknya
    expect(rt.akun.adalahPemilikUrusan(uLain, { sid: sidLain })).toBe(true);
    expect(rt.akun.vault.getDataDiri(rt.akun.tamuDariSid(sidLain)!)?.data).toEqual({
      namaLengkap: 'Orang Lain',
    });
    // permintaan berikutnya: tidak ada lagi yang perlu digabung, sid tidak diputar ulang
    await lewatHook(get('/api/akun'), jar, sesiAkun);
    expect(jar.get(SID_COOKIE)).toBe(sidBaru);
  });
});

describe('Browser Pendamping: akun hasil daftar = portal asli; tamu dan juri = Mode Uji', () => {
  /** Request seperti dari peramban: semua cookie jar di header Cookie. */
  const permintaan = (jar: Jar) =>
    new Request(`${ORIGIN}/x`, {
      headers: {
        cookie: jar
          .getAll()
          .map((c) => `${c.name}=${c.value}`)
          .join('; '),
      },
    });
  const urusanBaru = async (jar: Jar, kirim: typeof tamuLama = lewatHook) => {
    const { id } = (await (await kirim(post({}, '/api/urusan'), jar, buatUrusan)).json()) as any;
    return rt.store.getUrusan(id)!;
  };

  it('daftar lewat API dan form action → urusan akun itu bukan Mode Uji', async () => {
    const api = await daftarAkun();
    const sesi = SesiAkunResponseSchema.parse(
      await (await lewatHook(get('/api/akun'), api.jar, sesiAkun)).json(),
    );
    expect(sesi.masuk && sesi.akun.sinkron).toBe(true);
    const uApi = await urusanBaru(api.jar);
    expect(rt.akun.urusanMilik(akunDari(api.jar).id)).toEqual([uApi.id]);
    expect(await modeUjiPendamping(permintaan(api.jar), uApi)).toBe(false);

    const jar = new Jar();
    await caught(daftarPage.default(ev(form({ email: 'form@example.com', sandi: SANDI }), { jar })));
    const uForm = await urusanBaru(jar);
    expect(await modeUjiPendamping(permintaan(jar), uForm)).toBe(false);
    // Akun lain yang masuk tidak bisa memakai urusan itu sebagai portal asli.
    expect(await modeUjiPendamping(permintaan(api.jar), uForm)).toBe(true);
  });

  it('urusan tamu yang dibawa saat daftar ikut jadi portal asli', async () => {
    const jar = new Jar({ [SID_COOKIE]: 'c'.repeat(32) });
    const u = await urusanBaru(jar, tamuLama);
    expect(await modeUjiPendamping(permintaan(jar), u)).toBe(true);
    await daftarAkun(EMAIL, SANDI, jar);
    expect(await modeUjiPendamping(permintaan(jar), u)).toBe(false);
  });

  it('urusan tamu lama tetap Mode Uji; salinan demo juri = situs asli lihat saja, replika hanya bila simulasi', async () => {
    const tamu = new Jar();
    const uTamu = await urusanBaru(tamu, tamuLama);
    await tamuLama(put({ namaLengkap: 'Tamu' }), tamu, dataDiriPut);
    expect(await modeUjiPendamping(permintaan(tamu), uTamu)).toBe(true);
    expect(await modePendamping(permintaan(tamu), uTamu)).toEqual({ modeUji: true, lihatSaja: false });
    const { jar } = await masukJuri();
    const uJuri = await urusanBaru(jar);
    expect(akunDari(jar).jenis).toBe('demo');
    expect(await modePendamping(permintaan(jar), uJuri)).toEqual({ modeUji: false, lihatSaja: true });
    expect(await modePendamping(permintaan(jar), uJuri, { simulasi: true })).toEqual({
      modeUji: true,
      lihatSaja: false,
    });
    // Juri lain tidak bisa membuka urusan juri ini di situs asli.
    const lain = await masukJuri(new Jar(), '127.0.0.2');
    expect(await modePendamping(permintaan(lain.jar), uJuri)).toEqual({ modeUji: true, lihatSaja: false });
  });

  it('akun warga biasa: simulasi diabaikan, selalu situs asli tanpa lihat saja', async () => {
    const api = await daftarAkun();
    const u = await urusanBaru(api.jar);
    expect(await modePendamping(permintaan(api.jar), u, { simulasi: true })).toEqual({
      modeUji: false,
      lihatSaja: false,
    });
  });
});

describe('keamanan', () => {
  it('enumerasi: lupa sandi dan masuk memberi status dan body identik untuk email ada dan tidak ada', async () => {
    await daftarAkun();
    const a = await lupaApi(ev(post({ email: EMAIL })));
    const b = await lupaApi(ev(post({ email: 'tidakada@example.com' })));
    expect(a.status).toBe(b.status);
    expect(await a.text()).toBe(await b.text());
    const salahSandi = await masuk(new Jar(), EMAIL, SANDI2);
    const tidakAda = await masuk(new Jar(), 'hantu@example.com', SANDI2);
    expect([salahSandi.res.status, salahSandi.body]).toEqual([tidakAda.res.status, tidakAda.body]);
  });

  it('penguncian: Turnstile wajib setelah 3 gagal, terkunci 15 menit setelah 5; pesan sama untuk email ada/tidak', async () => {
    await daftarAkun();
    // Dua email berjalan bersamaan (hash argon2 boleh 2 serentak): penghitung kegagalan per email, jadi
    // urutan di dalam satu email tetap; waktu tes kira-kira separuh.
    const uji = async (email: string) => {
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
    };
    await Promise.all([uji(EMAIL), uji('hantu@example.com')]);
    jam += 16 * 60 * 1000;
    expect((await masuk()).res.status).toBe(200);
  });

  it('token sekali pakai: tautan atur ulang tidak bisa dipakai ulang', async () => {
    await daftarAkun();
    await lupaApi(ev(post({ email: EMAIL })));
    const r = tokenDari(mailer.last(EMAIL, 'atur-ulang')!.link);
    expect((await aturUlangApi(ev(post({ token: r, sandi: SANDI2 })))).status).toBe(200);
    const ulang = await aturUlangApi(ev(post({ token: r, sandi: SANDI })));
    expect([ulang.status, (await ulang.json()).kode]).toEqual([400, 'TOKEN_TIDAK_VALID']);
  });

  it('CSRF: POST akun (API dan form action) dengan Origin asing/tanpa Origin ditolak 403 oleh hook', async () => {
    await daftarAkun();
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
    await daftarAkun();
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
    await daftarAkun();
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
    const a = await daftarAkun(); // sesi dari daftar = perangkat pertama
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

  it('perangkat bersama: keluar, keluar semua, dan hapus akun menghapus cookie urusan terakhir', async () => {
    const terakhir = `u_${'c'.repeat(32)}`;
    // Sesi juri: tanpa hash sandi (yang diuji penghapusan cookie, sama untuk semua jenis akun).
    const a = await masukJuri();
    a.jar.set(TERAKHIR_COOKIE, terakhir, {});
    await lewatHook(post({}, '/api/akun/keluar'), a.jar, keluarApi);
    expect(a.jar.get(TERAKHIR_COOKIE)).toBeUndefined();

    const b = await masukJuri();
    b.jar.set(TERAKHIR_COOKIE, terakhir, {});
    await lewatHook(post({}, '/api/akun/keluar-semua'), b.jar, keluarSemuaApi);
    expect(b.jar.get(TERAKHIR_COOKIE)).toBeUndefined();

    // Aksi Pengaturan hanya untuk akun warga: satu akun bersandi untuk keduanya.
    await daftarAkun();
    const c = await masuk();
    c.jar.set(TERAKHIR_COOKIE, terakhir, {});
    await caught(
      pengaturanPage.keluarSemua(
        ev(form({}, '/pengaturan?/keluarSemua'), { jar: c.jar, locals: localsDari(c.jar) }),
      ),
    );
    expect(c.jar.get(TERAKHIR_COOKIE)).toBeUndefined();

    const d = await masukJuri();
    d.jar.set(TERAKHIR_COOKIE, terakhir, {});
    const ok = await lewatHook(post({ konfirmasi: 'HAPUS' }, '/api/akun/hapus'), d.jar, hapusApi);
    expect(ok.status).toBe(200);
    expect(d.jar.get(TERAKHIR_COOKIE)).toBeUndefined();

    const e = await masuk();
    e.jar.set(TERAKHIR_COOKIE, terakhir, {});
    await caught(
      pengaturanPage.hapusAkun(
        ev(form({ konfirmasi: 'HAPUS', sandi: SANDI }, '/pengaturan?/hapusAkun'), {
          jar: e.jar,
          locals: localsDari(e.jar),
        }),
      ),
    );
    expect(e.jar.get(TERAKHIR_COOKIE)).toBeUndefined();
  });

  it('akun hasil daftar: buat urusan → keluar → masuk lagi → urusan tetap terbuka; pemilik lain 404', async () => {
    const a = await daftarAkun();
    const { id } = (await (await lewatHook(post({}, '/api/urusan'), a.jar, buatUrusan)).json()) as any;
    const buka = (jar: Jar) =>
      lewatHook(new Request(`${ORIGIN}/api/urusan/${id}`), jar, statusUrusan, { id }).then((r) => r.status);
    expect(await buka(a.jar)).toBe(200);
    await lewatHook(post({}, '/api/akun/keluar'), a.jar, keluarApi);
    expect(await buka(a.jar)).toBe(401); // perangkat bersama: setelah keluar tidak terbuka (wajib akun)
    await masuk(a.jar);
    expect(await buka(a.jar)).toBe(200);
    // Perangkat lain, akun yang sama: ikut akun (bukan cookie perangkat).
    expect(await buka((await masuk()).jar)).toBe(200);
    // Pemilik lain: akun lain (salinan juri, tanpa hash sandi) → 404; tanpa sesi → 401 wajib akun.
    expect(await buka((await masukJuri()).jar)).toBe(404);
    expect(await buka(new Jar())).toBe(401);
  });

  it('juri: urusan tamu lama yang dimulai sebelum masuk ikut salinan demonya (tidak yatim di sid)', async () => {
    const jar = new Jar();
    const { id } = (await (await tamuLama(post({}, '/api/urusan'), jar, buatUrusan)).json()) as any;
    const ts = { turnstile: TURNSTILE_TOKEN_FIXTURE };
    expect((await juriApi(ev(post(ts, '/api/akun/juri'), { jar, ip: '10.9.0.1' }))).status).toBe(200);
    const demo = akunDari(jar);
    expect(rt.akun.urusanMilik(demo.id)).toEqual([id]);
    jar.set(SID_COOKIE, 'e'.repeat(32), {}); // sid berganti (mis. cookie dibersihkan): tetap milik juri
    const r = await lewatHook(new Request(`${ORIGIN}/api/urusan/${id}`), jar, statusUrusan, { id });
    expect(r.status).toBe(200);
  });

  it('ubah sandi merotasi cookie; reset menghapus semua sesi', async () => {
    await daftarAkun();
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
    await daftarAkun();
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

  it('zona bahaya (form action): keluar semua → /masuk; hapus akun butuh HAPUS + sandi, lalu ke /', async () => {
    const tamu = await caught(pengaturanPage.keluarSemua(ev(form({}, '/pengaturan?/keluarSemua'))));
    expect(isRedirect(tamu) && tamu.location).toBe('/masuk');
    await daftarAkun();
    const a = await masuk();
    const b = await masuk();
    expect(
      ((await pengaturanLoad(ev(get('/pengaturan'), { locals: localsDari(b.jar) }) as never)) as any)
        .zonaBahaya,
    ).toEqual({
      punyaSandi: true,
    });
    const sidLama = b.jar.get(SID_COOKIE);
    const kel = await caught(
      pengaturanPage.keluarSemua(
        ev(form({}, '/pengaturan?/keluarSemua'), { jar: b.jar, locals: localsDari(b.jar) }),
      ),
    );
    expect(isRedirect(kel) && kel.location).toBe('/masuk');
    expect(rt.akun.sesi(a.jar.get(AKUN_COOKIE))).toBeNull();
    expect(b.jar.get(AKUN_COOKIE)).toBeUndefined();
    expect(b.jar.get(SID_COOKIE)).not.toBe(sidLama);

    const c = await masuk();
    const aksi = (f: Record<string, string>) =>
      pengaturanPage.hapusAkun(
        ev(form(f, '/pengaturan?/hapusAkun'), { jar: c.jar, locals: localsDari(c.jar) }),
      );
    expect(await aksi({ konfirmasi: 'hapus', sandi: SANDI })).toMatchObject({
      status: 422,
      data: { kode: 'KONFIRMASI_SALAH' },
    });
    expect(await aksi({ konfirmasi: 'HAPUS', sandi: SANDI2 })).toMatchObject({
      status: 401,
      data: { kode: 'SANDI_LAMA_SALAH' },
    });
    const ok = await caught(aksi({ konfirmasi: ' HAPUS ', sandi: SANDI }));
    expect(isRedirect(ok) && ok.location).toBe('/');
    expect(c.jar.get(AKUN_COOKIE)).toBeUndefined();
    expect(hitung('SELECT COUNT(*) n FROM users')).toBe(0);
  });
});

describe('vault (/api/vault): Data Diri, dokumen, dan urusan mengikuti akun', () => {
  it('Data Diri terenkripsi: HP dan laptop (dua sesi) melihat data yang sama', async () => {
    await daftarAkun();
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
    await daftarAkun();
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
    await daftarAkun();
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
    // PoC: Data Diri (GET) di perangkat baru juga butuh bukti kredensial <= 15 menit
    const dd = await lewatHook(vget('/api/vault/data-diri'), laptop.jar, dataDiriGet);
    expect([dd.status, (await dd.json()).kode]).toEqual([401, 'PERLU_MASUK_ULANG']);
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

    // pemilik lain (salinan juri, tanpa hash sandi): 404 untuk unduh dan hapus
    const b = await masukJuri();
    expect((await lewatHook(vget(`/api/vault/${doc.id}`), b.jar, dokumenGet, { id: doc.id })).status).toBe(
      404,
    );
    expect((await lewatHook(hapus(), b.jar, dokumenDel, { id: doc.id })).status).toBe(404);
    expect((await lewatHook(hapus(), a.jar, dokumenDel, { id: doc.id })).status).toBe(200);
  });

  it('volume host penuh → 507 dengan pesan jujur', async () => {
    buatRt({ vault: { diskPersen: () => 90 } });
    await daftarAkun();
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

  it('wajib akun: tanpa sesi, API urusan/brankas/ingatan → 401 BELUM_MASUK dan tidak membuat baris apa pun', async () => {
    const jar = new Jar();
    expect((await lewatHook(get('/api/akun'), jar, sesiAkun)).status).toBe(200);
    let sampai = 0;
    const handler = () => {
      sampai++;
      return new Response('ok');
    };
    for (const req of [
      vget('/api/vault'),
      vget('/api/vault/data-diri'),
      put({ namaLengkap: 'Tamu' }),
      post({}, '/api/urusan'),
      post({ pesan: 'halo' }, '/api/urusan'),
      get('/api/urusan?ids=u_' + '0'.repeat(32)),
      post({ teks: 'halo' }, `/api/urusan/u_${'0'.repeat(32)}/turn`),
      get(`/api/urusan/u_${'0'.repeat(32)}/stream`),
      get('/api/ingatan'),
    ]) {
      const r = await lewatHook(req, jar, handler);
      expect([req.method, new URL(req.url).pathname, r.status], req.url).toEqual([
        req.method,
        new URL(req.url).pathname,
        401,
      ]);
      expect(GalatApiSchema.parse(await r.json()).kode).toBe('BELUM_MASUK');
    }
    expect(sampai).toBe(0);
    expect(hitung('SELECT COUNT(*) n FROM users')).toBe(0);
    expect(hitung('SELECT COUNT(*) n FROM urusan')).toBe(0);
    // API publik tetap terbuka tanpa akun.
    expect((await lewatHook(get('/api/wilayah'), jar, handler)).status).toBe(200);
  });

  it('wajib akun: halaman aplikasi tanpa sesi → 303 ke /masuk?next=…; halaman informatif tetap publik', async () => {
    const buka = (path: string, id: string, jar = new Jar()) =>
      handle({
        event: { ...(ev(get(path), { jar }) as object), route: { id } } as never,
        resolve: () => Promise.resolve(new Response('ok')),
      });
    const urusan = `/urusan/u_${'0'.repeat(32)}`;
    for (const [path, id] of [
      [urusan, '/urusan/[id]'],
      [`/jejak/u_${'0'.repeat(32)}?head=ab`, '/jejak/[id]'],
      ['/urusanku', '/urusanku'],
      ['/data-diri', '/data-diri'],
      ['/dokumen', '/dokumen'],
      ['/pengaturan', '/pengaturan'],
    ]) {
      const r = await caught(buka(path, id));
      expect(isRedirect(r) && [r.status, r.location]).toEqual([
        303,
        `/masuk?next=${encodeURIComponent(path)}`,
      ]);
    }
    for (const [path, id] of [
      ['/', '/'],
      ['/urusan', '/urusan'],
      ['/peristiwa/kelahiran', '/peristiwa/[slug]'],
      ['/tanya-jawab', '/tanya-jawab'],
      ['/privasi', '/privasi'],
      ['/bantuan', '/bantuan'],
    ])
      expect((await buka(path, id)).status, path).toBe(200);
    // Akun yang masuk melewati gerbang.
    const { jar } = await daftarAkun();
    expect((await buka(urusan, '/urusan/[id]', jar)).status).toBe(200);
  });

  it('tamu lama malas: menjelajah dan membuat urusan tanpa pesan tidak membuat baris pengguna', async () => {
    const jar = new Jar();
    const v = VaultResponseSchema.parse(await (await tamuLama(vget('/api/vault'), jar, vaultList)).json());
    expect([v.pemilik, v.dataDiri.ada, v.dokumen]).toEqual(['tamu', false, []]);
    await tamuLama(vget('/api/vault/data-diri'), jar, dataDiriGet);
    await tamuLama(post({}, '/api/urusan'), jar, buatUrusan);
    expect(hitung('SELECT COUNT(*) n FROM users')).toBe(0);
    // tulis vault pertama membuat tamu
    expect((await tamuLama(put({ namaLengkap: 'Tamu' }), jar, dataDiriPut)).status).toBe(200);
    expect(hitung("SELECT COUNT(*) n FROM users WHERE jenis = 'tamu'")).toBe(1);
  });

  it('tamu lama malas: turn pertama membuat tamu; kuota pembuatan tamu per IP → 429 TAMU_PENUH', async () => {
    buatRt({ kuota: { tamuPerIpHari: 1, demoPerIpHari: 3, demoAktifMaks: 200 } }, new ModelDiam());
    const jar = new Jar();
    const u = await (await tamuLama(post({}, '/api/urusan'), jar, buatUrusan)).json();
    expect(hitung('SELECT COUNT(*) n FROM users')).toBe(0);
    const t = await tamuLama(post({ teks: 'halo' }, `/api/urusan/${u.id}/turn`), jar, turnApi, { id: u.id });
    expect(t.status).toBe(202);
    expect(hitung("SELECT COUNT(*) n FROM users WHERE jenis = 'tamu'")).toBe(1);
    const lain = new Jar();
    const r = await tamuLama(post({ pesan: 'halo' }, '/api/urusan'), lain, buatUrusan);
    expect([r.status, (await r.json()).kode]).toEqual([429, 'TAMU_PENUH']);
    for (const c of rt.running.values()) c.abort();
  });

  it('rotasi tamu lama → akun: urusan + vault tamu pindah ke akun dalam satu langkah; perangkat lain melihatnya', async () => {
    await daftarAkun();
    const jar = new Jar({ [SID_COOKIE]: 'a'.repeat(32) });
    const buat = async (kirim: typeof tamuLama = lewatHook) =>
      ((await (await kirim(post({}, '/api/urusan'), jar, buatUrusan)).json()) as any).id;
    const u1 = await buat(tamuLama);
    const u2 = await buat(tamuLama);
    await tamuLama(put({ namaLengkap: 'Tamu Uji' }), jar, dataDiriPut);
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
  it('Turnstile wajib; salinan berisi data sintetis, terisolasi per klik; batas per IP (di sini 3)', async () => {
    buatRt({ kuota: { tamuPerIpHari: 20, demoPerIpHari: 3, demoAktifMaks: 200 } });
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

    buatRt({
      turnstile: turnstileFromEnv({}),
      kuota: { tamuPerIpHari: 20, demoPerIpHari: 3, demoAktifMaks: 200 },
    });
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

  it('aula lomba (satu NAT): batas bawaan tidak mengunci juri ke-4 dst. maupun pengunjung tamu ke-21 dst.', async () => {
    expect(DEFAULT_KUOTA).toEqual({ tamuPerIpHari: 200, demoPerIpHari: 50, demoAktifMaks: 2000 });
    const ts = { turnstile: TURNSTILE_TOKEN_FIXTURE };
    for (let i = 0; i < 12; i++)
      expect(
        (await juriApi(ev(post(ts, '/api/akun/juri'), { ip: '203.0.113.7' }))).status,
        `juri ${i + 1}`,
      ).toBe(200);
    for (let i = 0; i < 30; i++)
      expect(() =>
        rt.akun.pastikanTamu(i.toString(16).padStart(32, '0'), { ip: '203.0.113.7' }),
      ).not.toThrow();
  });

  it('halaman masuk: widget Turnstile hanya untuk Cloudflare sungguhan; tanpa token juri ditolak', async () => {
    expect(((await masukLoad(ev(get('/masuk')) as never)) as any).turnstileSiteKey).toBe(''); // tiruan e2e
    buatRt({ turnstile: turnstileFromEnv({ TURNSTILE_SECRET_KEY: 'rahasia', TURNSTILE_SITE_KEY: 'situs' }) });
    expect(((await masukLoad(ev(get('/masuk')) as never)) as any).turnstileSiteKey).toBe('situs');
    const r = await juriApi(ev(post({}, '/api/akun/juri')));
    expect([r.status, (await r.json()).kode]).toEqual([403, 'TURNSTILE_WAJIB']);
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

  it('zona bahaya: akun Google saja → masuk ulang bila login > 15 menit, lalu hapus (form action dan API)', async () => {
    const klaim = { sub: 'g-zona', email: 'g-zona@example.com', email_verified: true, name: 'Warga Google' };
    const g = await alurGoogle(klaim);
    expect(
      ((await pengaturanLoad(ev(get('/pengaturan'), { locals: localsDari(g.jar) }) as never)) as any)
        .zonaBahaya,
    ).toEqual({
      punyaSandi: false,
    });
    jam += 16 * 60 * 1000;
    const api = await lewatHook(post({ konfirmasi: 'HAPUS' }, '/api/akun/hapus'), g.jar, hapusApi);
    expect([api.status, ((await api.json()) as any).kode]).toEqual([401, 'PERLU_MASUK_ULANG']);
    const hapus = () =>
      caught(
        pengaturanPage.hapusAkun(
          ev(form({ konfirmasi: 'HAPUS' }, '/pengaturan?/hapusAkun'), {
            jar: g.jar,
            locals: localsDari(g.jar),
          }),
        ),
      );
    const ulang = await hapus();
    expect(isRedirect(ulang) && ulang.location).toBe('/masuk?ulang=1&lanjut=%2Fpengaturan%23zona-bahaya');
    await alurGoogle(klaim, '/pengaturan', g.jar);
    const ok = await hapus();
    expect(isRedirect(ok) && ok.location).toBe('/');
    expect(g.jar.get(AKUN_COOKIE)).toBeUndefined();
    expect(hitung("SELECT COUNT(*) n FROM users WHERE email = 'g-zona@example.com'")).toBe(0);
  });

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

  it('#48: email sama dengan akun sandi → tidak ditautkan/diambil alih; tertaut setelah bukti sandi', async () => {
    const pemilik = await daftarAkun();
    const id = akunDari(pemilik.jar).id;
    const jar = new Jar();
    const g = await alurGoogle({ sub: 'g-sama', email: EMAIL, email_verified: true }, '/lacak', jar);
    expect(g.location).toBe('/masuk?galat=GOOGLE_PERLU_SANDI&next=%2Flacak');
    expect(jar.get(AKUN_COOKIE)).toBeUndefined();
    expect(jar.store.get(TAUTKAN_COOKIE)!.opts).toMatchObject({ httpOnly: true, secure: true });
    expect(hitung('SELECT COUNT(*) n FROM oauth_identities')).toBe(0);
    // Tidak ada pengambilalihan: sesi dan sandi pemilik tetap, tidak ada akun baru.
    expect(rt.akun.sesi(pemilik.jar.get(AKUN_COOKIE))?.akun.id).toBe(id);
    expect(hitung('SELECT COUNT(*) n FROM users')).toBe(1);
    const l = (await masukLoad(ev(get('/masuk?galat=GOOGLE_PERLU_SANDI'), { jar }) as never)) as any;
    expect([l.galat.kode, l.tautkan]).toEqual(['GOOGLE_PERLU_SANDI', true]);
    // sandi salah tidak menautkan
    expect((await masuk(jar, EMAIL, SANDI2)).res.status).toBe(401);
    expect(hitung('SELECT COUNT(*) n FROM oauth_identities')).toBe(0);
    const { body } = await masuk(jar);
    expect(body.googleTertaut).toBe(true);
    expect(body.akun).toMatchObject({ id, terhubungGoogle: true, punyaSandi: true });
    expect(jar.get(TAUTKAN_COOKIE)).toBeUndefined();
    const s = SesiAkunResponseSchema.parse(await (await lewatHook(get('/api/akun'), jar, sesiAkun)).json());
    expect(s.masuk && s.akun.terhubungGoogle).toBe(true);
    // berikutnya Google langsung masuk ke akun yang sama
    const lagi = await alurGoogle({ sub: 'g-sama', email: EMAIL, email_verified: true });
    expect(akunDari(lagi.jar).id).toBe(id);
  });

  it('akun Google saja: daftar dengan email itu → 409, akun Google tetap utuh', async () => {
    const g = await alurGoogle({
      sub: 'g-dulu',
      email: 'gdulu@example.com',
      email_verified: true,
      name: 'G',
    });
    const id = akunDari(g.jar).id;
    const r = await daftarApi(ev(post({ email: 'gdulu@example.com', sandi: SANDI })));
    expect([r.status, ((await r.json()) as any).kode]).toEqual([409, 'EMAIL_SUDAH_TERDAFTAR']);
    expect(akunDari(g.jar)).toMatchObject({ id, punyaSandi: false });
    expect(rt.akun.terhubungGoogle(id)).toBe(true);
  });

  it('review keamanan: menautkan butuh bukti kredensial <= 15 menit (akun hasil daftar langsung boleh)', async () => {
    // akun baru dari daftar (authAt = sekarang): /auth/google = mode tautan (state membawa user_id)
    const baru = await daftarAkun('baru@example.com', SANDI2);
    await mulai(baru.jar, '/pengaturan', localsDari(baru.jar));
    expect(hitung('SELECT COUNT(*) n FROM oauth_states WHERE user_id IS NOT NULL')).toBe(1);
    // sesi > 15 menit: masuk ulang dulu, lalu kembali ke /auth/google
    await daftarAkun();
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
    expect(hitung('SELECT COUNT(*) n FROM oauth_states WHERE user_id IS NOT NULL')).toBe(1);
    expect(hitung('SELECT COUNT(*) n FROM oauth_states')).toBe(2);
  });

  it('review keamanan: lepas Google lewat API (akun bersandi saja)', async () => {
    await daftarAkun();
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
    await daftarAkun();
    await daftarAkun('lain@example.com');
    const jar = new Jar();
    await alurGoogle({ sub: 'g-x', email: EMAIL, email_verified: true }, '/', jar);
    const { body } = await masuk(jar, 'lain@example.com');
    expect(body.googleTertaut).toBe(false);
    expect(hitung('SELECT COUNT(*) n FROM oauth_identities')).toBe(0);
  });

  it('sedang masuk: Google DITAUTKAN ke akun itu (bukti = sesi); identitas milik akun lain ditolak', async () => {
    await daftarAkun();
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
  it('daftar (form) → sesi + /beranda → masuk → lengkapi profil → tujuan', async () => {
    const dj = new Jar();
    const d = await caught(
      daftarPage.default(ev(form({ email: EMAIL, sandi: SANDI }, '/daftar'), { jar: dj })),
    );
    expect(isRedirect(d) && [d.status, d.location]).toEqual([303, '/beranda']);
    expect(dj.store.get(AKUN_COOKIE)!.opts).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax' });
    const sd = await (await lewatHook(get('/api/akun'), dj, sesiAkun)).json();
    expect(sd.akun).toHaveProperty('emailTerverifikasi', true);
    const s = SesiAkunResponseSchema.parse(sd);
    expect(s.masuk && [s.akun.jenis, s.akun.email, s.akun.sinkron]).toEqual(['akun', EMAIL, true]);
    expect(mailer.sent).toHaveLength(0);

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

  it('/verifikasi-email (tautan lama di kotak surat) → 303 ke /masuk, atau /beranda bila sudah masuk', async () => {
    // Handler sinkron: redirect dilempar langsung, jadi dibungkus agar tertangkap `caught`.
    const buka = async (e: never) => verifikasiEmailLama(e);
    const anon = await caught(buka(ev(get(`/verifikasi-email?token=${'x'.repeat(43)}`))));
    expect(isRedirect(anon) && [anon.status, anon.location]).toEqual([303, '/masuk']);
    const { jar } = await daftarAkun();
    const masukLama = await caught(
      buka(ev(get('/verifikasi-email?token=x'), { jar, locals: localsDari(jar) })),
    );
    expect(isRedirect(masukLama) && [masukLama.status, masukLama.location]).toEqual([303, '/beranda']);
  });

  it('masuk gagal → fail dengan kode, email dikembalikan, sandi tidak', async () => {
    const r = (await masukPage.masuk(ev(form({ email: EMAIL, sandi: SANDI })))) as any;
    expect([r.status, r.data.kode, r.data.email]).toEqual([401, 'KREDENSIAL_SALAH', EMAIL]);
    expect(JSON.stringify(r.data)).not.toContain(SANDI);
    await daftarAkun();
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

  it('lupa → atur ulang lewat halaman; daftar dengan email rusak → fail', async () => {
    expect(await lupaLoad(ev(get('/lupa-sandi')) as never)).toEqual({ tersedia: true, googleAktif: true });
    await daftarAkun();
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

    const salah = (await daftarPage.default(ev(form({ email: 'bukan', sandi: SANDI })))) as any;
    expect(salah.data.kode).toBe('EMAIL_TIDAK_VALID');
  });
});
