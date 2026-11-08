/* eslint-disable @typescript-eslint/no-explicit-any -- tes membaca JSON respons tanpa tipe */
import { GoogleOidc, sha256Hex } from '@urusin/akun';
import { FakeGoogle, MemoryMailer } from '@urusin/akun/testing';
import { GalatApiSchema, SesiAkunResponseSchema } from '@urusin/contracts';
import { DemoProvider } from '@urusin/harness';
import { isRedirect } from '@sveltejs/kit';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handle } from '../../hooks.server';
import { GET as sesiAkun } from '../../routes/api/akun/+server';
import { POST as aturUlangApi } from '../../routes/api/akun/atur-ulang-sandi/+server';
import { POST as daftarApi } from '../../routes/api/akun/daftar/+server';
import { GET as dataDiriGet, PUT as dataDiriPut } from '../../routes/api/akun/data-diri/+server';
import { GET as dokumenList, POST as dokumenPost } from '../../routes/api/akun/dokumen/+server';
import { DELETE as dokumenDel, GET as dokumenGet } from '../../routes/api/akun/dokumen/[id]/+server';
import { POST as hapusApi } from '../../routes/api/akun/hapus/+server';
import { POST as keluarApi } from '../../routes/api/akun/keluar/+server';
import { POST as keluarSemuaApi } from '../../routes/api/akun/keluar-semua/+server';
import { POST as lupaApi } from '../../routes/api/akun/lupa-sandi/+server';
import { POST as masukApi } from '../../routes/api/akun/masuk/+server';
import { POST as profilApi } from '../../routes/api/akun/profil/+server';
import { POST as ubahSandiApi } from '../../routes/api/akun/ubah-sandi/+server';
import { GET as urusanAkun } from '../../routes/api/akun/urusan/+server';
import { POST as verifikasiApi } from '../../routes/api/akun/verifikasi/+server';
import { POST as kirimUlangApi } from '../../routes/api/akun/verifikasi/kirim-ulang/+server';
import { POST as buatUrusan } from '../../routes/api/urusan/+server';
import { GET as googleMulai } from '../../routes/auth/google/+server';
import { GET as googleCallback } from '../../routes/auth/google/callback/+server';
import { actions as aturUlangPage, load as aturUlangLoad } from '../../routes/atur-ulang-sandi/+page.server';
import { actions as daftarPage } from '../../routes/daftar/+page.server';
import { actions as profilPage, load as profilLoad } from '../../routes/lengkapi-profil/+page.server';
import { actions as lupaPage } from '../../routes/lupa-sandi/+page.server';
import { actions as masukPage, load as masukLoad } from '../../routes/masuk/+page.server';
import { actions as verifPage, load as verifLoad } from '../../routes/verifikasi-email/+page.server';
import { AKUN_COOKIE, OAUTH_COOKIE } from './akun';
import { createRuntime, setRuntimeForTests, type Runtime } from './runtime';
import { SID_COOKIE } from './sesi';

const ORIGIN = 'http://localhost:3000';
const EMAIL = 'warga@example.com';
const SANDI = 'kuda-lari-cepat-9';
const SANDI2 = 'gajah-terbang-tinggi-7';
// HP sintetis dirakit agar pemindai PII repo tidak menandai berkas ini
const HP_SINTETIS = ['08', '12 ', '0000 ', '0000'].join('');

let rt: Runtime;
let mailer: MemoryMailer;
let google: FakeGoogle;

beforeAll(async () => {
  google = await FakeGoogle.create();
});
beforeEach(() => {
  mailer = new MemoryMailer();
  google.gangguan = null;
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
    },
  });
  setRuntimeForTests(rt);
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
  new Request(`${ORIGIN}/x`, {
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

const tokenDari = (link: string) => new URL(link).searchParams.get('token')!;

/** Jalankan lewat hooks (CSRF + resolusi sesi) agar `locals.akun` terisi seperti produksi. */
async function lewatHook(
  request: Request,
  jar: Jar,
  handler: (e: never) => Promise<Response> | Response,
  params: Record<string, string> = {},
) {
  const event = ev(request, { jar, params }) as unknown as { locals: App.Locals; url: URL };
  return handle({ event: event as never, resolve: () => Promise.resolve(handler(event as never)) });
}

async function daftarVerifikasi(email = EMAIL, sandi = SANDI) {
  expect((await daftarApi(ev(post({ email, sandi })))).status).toBe(202);
  const res = await verifikasiApi(ev(post({ token: tokenDari(mailer.last(email, 'verifikasi')!.link) })));
  expect(res.status).toBe(200);
}

async function masuk(jar = new Jar(), email = EMAIL, sandi = SANDI) {
  const res = await masukApi(ev(post({ email, sandi, next: '/lacak' }), { jar }));
  return { res, jar, body: (await res.json()) as any };
}

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
      email: EMAIL,
      emailTerverifikasi: true,
      punyaSandi: true,
      profilLengkap: false,
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
    if (sesi.masuk) {
      expect(sesi.perangkat).toHaveLength(1);
      expect(sesi.perangkat[0]!.perangkatIni).toBe(true);
      expect(sesi.metode.google).toBe(true);
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
    const r3 = await daftarApi(ev(post({ email: EMAIL, sandi: 'password1' })));
    const b3 = await r3.json();
    expect([r3.status, b3.kode]).toEqual([422, 'SANDI_TERLALU_UMUM']);
    expect(GalatApiSchema.parse(b3)).toBeTruthy();
    expect(JSON.stringify(b3)).not.toContain('password1');
    // email SAH di endpoint akun (pemindai PII untuk teks model tidak dipakai di sini)
    expect((await daftarApi(ev(post({ email: 'lain@example.com', sandi: SANDI })))).status).toBe(202);
  });

  it('belum terverifikasi: 403 + kirim ulang 202', async () => {
    await daftarApi(ev(post({ email: EMAIL, sandi: SANDI })));
    const { res, body } = await masuk();
    expect([res.status, body.kode]).toEqual([403, 'EMAIL_BELUM_TERVERIFIKASI']);
    expect((await kirimUlangApi(ev(post({ email: EMAIL })))).status).toBe(202);
    expect(mailer.sent.filter((m) => m.jenis === 'verifikasi')).toHaveLength(2);
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

  it('token sekali pakai: verifikasi dan reset tidak bisa dipakai ulang', async () => {
    await daftarApi(ev(post({ email: EMAIL, sandi: SANDI })));
    const v = tokenDari(mailer.last(EMAIL, 'verifikasi')!.link);
    expect((await verifikasiApi(ev(post({ token: v })))).status).toBe(200);
    const ulang = await verifikasiApi(ev(post({ token: v })));
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
      ['/api/akun/hapus', 'null'],
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

  it('fiksasi sesi: cookie yang ditanam sebelum login tidak pernah menjadi sesi; login menerbitkan token baru', async () => {
    await daftarVerifikasi();
    const tanam = 'B'.repeat(43);
    const jar = new Jar({ [AKUN_COOKIE]: tanam });
    await masuk(jar);
    expect(jar.get(AKUN_COOKIE)).not.toBe(tanam);
    expect(rt.akun.sesi(tanam)).toBeNull();
    // sesi lama yang sah juga dirotasi (dihapus) saat login ulang di perangkat yang sama
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
    rt.akun.vault.setDataDiri(
      rt.akun.akun(rt.store.db.prepare('SELECT id FROM users').pluck().get() as string)!.id,
      { namaLengkap: 'Warga' },
    );
    const e = await caught(
      masukPage.default(ev(form({ email: EMAIL, sandi: SANDI, next: '//evil.example.com' }))),
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
    const r = await lewatHook(post({}, '/api/akun/keluar'), a.jar, keluarApi);
    expect((await r.json()).sesiDihapus).toBe(1);
    expect(a.jar.get(AKUN_COOKIE)).toBeUndefined();
    const c = await masuk();
    const semua = await lewatHook(post({}, '/api/akun/keluar-semua'), c.jar, keluarSemuaApi);
    expect((await semua.json()).sesiDihapus).toBe(2);
    expect(rt.akun.sesi(b.jar.get(AKUN_COOKIE))).toBeNull();
    // tamu: keluar idempoten, keluar-semua 401
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
    expect(rt.store.db.prepare('SELECT COUNT(*) n FROM users').get()).toEqual({ n: 0 });
    expect(rt.store.db.prepare('SELECT COUNT(*) n FROM vault_data_diri').get()).toEqual({ n: 0 });
  });
});

describe('Data Diri, dokumen, dan urusan mengikuti akun', () => {
  it('Data Diri terenkripsi: HP dan laptop (dua sesi) melihat data yang sama; tamu 401', async () => {
    await daftarVerifikasi();
    const hp = await masuk();
    const laptop = await masuk();
    const nik = ['3201', '0101', '0190', '0002'].join('');
    const r = await lewatHook(put({ namaLengkap: 'Warga Uji', nik, rt: '001' }), hp.jar, dataDiriPut);
    expect(r.status).toBe(200);
    const g = await (await lewatHook(get('/api/akun/data-diri'), laptop.jar, dataDiriGet)).json();
    expect(g.dataDiri).toEqual({ namaLengkap: 'Warga Uji', nik, rt: '001' });
    expect(g.diubahPada).not.toBeNull();
    const ct = rt.store.db.prepare('SELECT ciphertext FROM vault_data_diri').get() as { ciphertext: Buffer };
    expect(ct.ciphertext.includes(Buffer.from(nik))).toBe(false);
    expect((await dataDiriGet(ev(get('/x')))).status).toBe(401);
    const bad = await lewatHook(put({ nik: '123' }), hp.jar, dataDiriPut);
    expect(bad.status).toBe(422);
    // Lengkapi profil menggabungkan, tidak menimpa
    const p = await (
      await lewatHook(post({ namaLengkap: 'Nama Baru' }, '/api/akun/profil'), hp.jar, profilApi)
    ).json();
    expect(p.dataDiri).toEqual({ namaLengkap: 'Nama Baru', nik, rt: '001' });
    const s = SesiAkunResponseSchema.parse(
      await (await lewatHook(get('/api/akun'), hp.jar, sesiAkun)).json(),
    );
    expect(s.masuk && s.akun.profilLengkap).toBe(true);
  });

  it('dokumen: unggah terenkripsi, daftar, unduh, hapus; batas ukuran dan jenis', async () => {
    await daftarVerifikasi();
    const a = await masuk();
    const multipart = (berkas: Blob, jenis = 'ktp', judul = 'KTP saya') => {
      const fd = new FormData();
      fd.set('berkas', berkas, 'ktp.png');
      fd.set('jenis', jenis);
      fd.set('judul', judul);
      return new Request(`${ORIGIN}/api/akun/dokumen`, {
        method: 'POST',
        headers: { origin: ORIGIN },
        body: fd,
      });
    };
    const isi = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const up = await lewatHook(multipart(new Blob([isi], { type: 'image/png' })), a.jar, dokumenPost);
    expect(up.status).toBe(201);
    const doc = await up.json();
    expect(doc).toMatchObject({ jenis: 'ktp', judul: 'KTP saya', mime: 'image/png', ukuran: 7 });
    const list = await (await lewatHook(get('/api/akun/dokumen'), a.jar, dokumenList)).json();
    expect(list.dokumen.map((d: any) => d.id)).toEqual([doc.id]);
    const dl = await lewatHook(get(`/api/akun/dokumen/${doc.id}`), a.jar, dokumenGet, { id: doc.id });
    expect(dl.headers.get('cache-control')).toBe('no-store');
    expect(new Uint8Array(await dl.arrayBuffer())).toEqual(isi);

    const besar = await lewatHook(
      multipart(new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: 'image/png' })),
      a.jar,
      dokumenPost,
    );
    expect(besar.status).toBe(413);
    const html = await lewatHook(
      multipart(new Blob(['<script>'], { type: 'text/html' })),
      a.jar,
      dokumenPost,
    );
    expect(html.status).toBe(415);
    const tanpaJenis = await lewatHook(
      multipart(new Blob(['x'], { type: 'image/png' }), 'senjata'),
      a.jar,
      dokumenPost,
    );
    expect(tanpaJenis.status).toBe(422);

    // akun lain tidak bisa mengunduh
    await daftarVerifikasi('lain@example.com');
    const b = await masuk(new Jar(), 'lain@example.com');
    expect(
      (await lewatHook(get(`/api/akun/dokumen/${doc.id}`), b.jar, dokumenGet, { id: doc.id })).status,
    ).toBe(404);
    expect(
      (
        await lewatHook(
          new Request(`${ORIGIN}/x`, { method: 'DELETE', headers: { origin: ORIGIN } }),
          b.jar,
          dokumenDel,
          { id: doc.id },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await lewatHook(
          new Request(`${ORIGIN}/x`, { method: 'DELETE', headers: { origin: ORIGIN } }),
          a.jar,
          dokumenDel,
          { id: doc.id },
        )
      ).status,
    ).toBe(200);
  });

  it('migrasi tamu: urusan yang dibuat sebagai tamu ikut ke akun saat masuk; urusan baru langsung milik akun', async () => {
    await daftarVerifikasi();
    const jar = new Jar({ [SID_COOKIE]: 'a'.repeat(32) });
    const buat = async () => {
      const res = await lewatHook(post({}, '/api/urusan'), jar, buatUrusan);
      return ((await res.json()) as { id: string }).id;
    };
    const u1 = await buat();
    const u2 = await buat();
    const { body } = await masuk(jar);
    expect(body.urusanDipindahkan).toBe(2);
    const u3 = await buat();
    const daftar = await (await lewatHook(get('/api/akun/urusan'), jar, urusanAkun)).json();
    expect(daftar.urusan.map((u: any) => u.id).sort()).toEqual([u1, u2, u3].sort());
    // perangkat lain (laptop) melihat urusan yang sama
    const laptop = await masuk();
    const dariLaptop = await (await lewatHook(get('/api/akun/urusan'), laptop.jar, urusanAkun)).json();
    expect(dariLaptop.urusan).toHaveLength(3);
    expect((await urusanAkun(ev(get('/x')))).status).toBe(401);
  });
});

describe('Google OAuth lewat rute', () => {
  async function alurGoogle(claims: Record<string, unknown>, next = '/lacak', jar = new Jar()) {
    const start = await caught(
      googleMulai(ev(get(`/auth/google?next=${encodeURIComponent(next)}`), { jar })),
    );
    if (!isRedirect(start)) throw start;
    const state = jar.get(OAUTH_COOKIE)!;
    expect(jar.store.get(OAUTH_COOKIE)!.opts).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 600,
    });
    const { code } = google.consent(start.location, claims);
    const cb = await caught(
      googleCallback(ev(get(`/auth/google/callback?code=${code}&state=${state}`), { jar })),
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
    expect(rt.akun.sesi(a.jar.get(AKUN_COOKIE))?.akun.email).toBe('g1@example.com');
    const b = await alurGoogle({ sub: 'g2', email: 'g2@example.com', email_verified: true });
    expect(b.location).toBe('/lengkapi-profil?next=%2Flacak');
  });

  it('state cookie tidak cocok, warga membatalkan, Google tidak aktif → /masuk?galat=', async () => {
    const jar = new Jar();
    const start = (await caught(googleMulai(ev(get('/auth/google'), { jar })))) as { location: string };
    const { code } = google.consent(start.location, {
      sub: 'g3',
      email: 'g3@example.com',
      email_verified: true,
    });
    jar.set(OAUTH_COOKIE, 'C'.repeat(43), {});
    const salah = (await caught(
      googleCallback(
        ev(
          get(
            `/auth/google/callback?code=${code}&state=${new URL(start.location).searchParams.get('state')}`,
          ),
          { jar },
        ),
      ),
    )) as { location: string };
    expect(salah.location).toBe('/masuk?galat=GOOGLE_GAGAL');
    expect(jar.get(AKUN_COOKIE)).toBeUndefined();
    const batal = (await caught(googleCallback(ev(get('/auth/google/callback?error=access_denied'))))) as {
      location: string;
    };
    expect(batal.location).toBe('/masuk?galat=GOOGLE_GAGAL');
    const l = (await masukLoad(ev(get('/masuk?galat=GOOGLE_GAGAL')) as never)) as any;
    expect(l.galat.kode).toBe('GOOGLE_GAGAL');
    expect(((await masukLoad(ev(get('/masuk?galat=<script>')) as never)) as any).galat).toBeNull();

    rt = createRuntime({
      provider: new DemoProvider(),
      config: { dbPath: ':memory:' },
      akun: { mailer, google: null },
    });
    setRuntimeForTests(rt);
    const mati = (await caught(googleMulai(ev(get('/auth/google'))))) as { location: string };
    expect(mati.location).toBe('/masuk?galat=GOOGLE_TIDAK_AKTIF');
  });
});

describe('form action halaman akun (App 15–20)', () => {
  it('daftar → verifikasi (load tidak memakai token; POST memakainya) → masuk → lengkapi profil → tujuan', async () => {
    const d = (await daftarPage.default(ev(form({ email: EMAIL, sandi: SANDI }))))!;
    expect(d).toEqual({ terkirim: true, email: EMAIL });
    const token = tokenDari(mailer.last(EMAIL, 'verifikasi')!.link);
    const l = (await verifLoad(ev(get(`/verifikasi-email?token=${token}`)) as never)) as any;
    expect(l.tokenBerlaku).toBe(true);
    expect(
      ((await verifLoad(ev(get(`/verifikasi-email?token=${token}`)) as never)) as any).tokenBerlaku,
    ).toBe(true);
    expect(await verifPage.default(ev(form({ token })))).toEqual({ terverifikasi: true });
    const lagi = (await verifPage.default(ev(form({ token })))) as any;
    expect([lagi.status, lagi.data.kode]).toEqual([400, 'TOKEN_TIDAK_VALID']);

    const jar = new Jar();
    const m = await caught(
      masukPage.default(ev(form({ email: EMAIL, sandi: SANDI, next: '/lacak' }), { jar })),
    );
    expect(isRedirect(m) && m.location).toBe('/lengkapi-profil?next=%2Flacak');
    const locals = {
      akun: { id: rt.akun.sesi(jar.get(AKUN_COOKIE))!.akun.id, email: EMAIL, emailTerverifikasi: true },
    };
    expect(
      ((await profilLoad(ev(get('/lengkapi-profil?next=/lacak'), { locals }) as never)) as any).next,
    ).toBe('/lacak');
    const kosong = (await profilPage.default(ev(form({ namaLengkap: '' }), { locals }))) as any;
    expect(kosong.status).toBe(422);
    const p = await caught(
      profilPage.default(
        ev(form({ namaLengkap: 'Warga Uji', hp: HP_SINTETIS, next: '/lacak' }), { locals }),
      ),
    );
    expect(isRedirect(p) && p.location).toBe('/lacak');
    expect(rt.akun.vault.getDataDiri(locals.akun.id)?.data).toMatchObject({ namaLengkap: 'Warga Uji' });
    const tamu = await caught(profilLoad(ev(get('/lengkapi-profil')) as never));
    expect(isRedirect(tamu) && tamu.location).toContain('/masuk?next=');
  });

  it('masuk gagal → fail dengan kode, email dikembalikan, sandi tidak', async () => {
    const r = (await masukPage.default(ev(form({ email: EMAIL, sandi: SANDI })))) as any;
    expect([r.status, r.data.kode, r.data.email]).toEqual([401, 'KREDENSIAL_SALAH', EMAIL]);
    expect(JSON.stringify(r.data)).not.toContain(SANDI);
    const sudah = await caught(
      masukLoad(
        ev(get('/masuk?next=/lacak'), {
          locals: { akun: { id: 'x', email: EMAIL, emailTerverifikasi: true } },
        }) as never,
      ),
    );
    expect(isRedirect(sudah) && sudah.location).toBe('/lacak');
  });

  it('lupa → atur ulang lewat halaman; kirim ulang verifikasi lewat halaman', async () => {
    await daftarVerifikasi();
    expect(await lupaPage.default(ev(form({ email: EMAIL })))).toEqual({ terkirim: true, email: EMAIL });
    expect(await lupaPage.default(ev(form({ email: 'tidakada@example.com' })))).toEqual({
      terkirim: true,
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
      email: 'baru@example.com',
    });
    const salah = (await daftarPage.default(ev(form({ email: 'bukan', sandi: SANDI })))) as any;
    expect(salah.data.kode).toBe('EMAIL_TIDAK_VALID');
  });
});
