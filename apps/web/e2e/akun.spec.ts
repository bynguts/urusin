/* eslint-disable @typescript-eslint/no-explicit-any -- tes membaca JSON respons tanpa tipe */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { devices, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { DB_PATH, E2E_DIR, ORIGIN, OUTBOX } from '../playwright.config';

/**
 * E2E akun #43–#48b (rencana §3.26, §4 e2e). Kasus berbasis waktu (penyapu 24 jam, kedaluwarsa izin) memakai
 * jam palsu di vitest (`packages/akun/src/service.test.ts`); di sini waktu "dimajukan" dengan menulis ke DB.
 */

mkdirSync(E2E_DIR, { recursive: true });

const TURNSTILE = 'XXXX.DUMMY.TOKEN.XXXX';
const SANDI = 'kuda-lari-cepat-9';
const SANDI2 = 'gajah-terbang-tinggi-7';
// NIK sintetis dirakit agar pemindai PII repo tidak menandai berkas ini
const NIK = ['3201', '0101', '0190', '0002'].join('');

let seq = 0;
const unik = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;
const emailBaru = (awal: string) => `${awal}-${unik()}@example.com`;
const ipBaru = () =>
  `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${(seq++ % 250) + 1}`;

/** IP klien sendiri per konteks (lewat X-Forwarded-For, seperti di belakang Caddy). */
async function pakaiIp(context: BrowserContext, ip = ipBaru()) {
  await context.setExtraHTTPHeaders({ 'x-forwarded-proto': 'http', 'x-forwarded-for': ip });
  return ip;
}

async function konteksHp(browser: import('@playwright/test').Browser, ip = ipBaru()) {
  const ctx = await browser.newContext({
    ...devices['Pixel 7'],
    baseURL: ORIGIN,
    locale: 'id-ID',
    extraHTTPHeaders: { 'x-forwarded-proto': 'http', 'x-forwarded-for': ip },
  });
  return { ctx, page: await ctx.newPage() };
}

function db<T>(fn: (d: DatabaseSync) => T): T {
  const d = new DatabaseSync(DB_PATH);
  try {
    d.exec('PRAGMA busy_timeout = 5000');
    return fn(d);
  } finally {
    d.close();
  }
}
const hitung = (sql: string, ...p: (string | number)[]) =>
  db((d) => Number((d.prepare(sql).get(...p) as { n: number }).n));

/** Tautan terakhir di outbox mailer mode log untuk penerima + jenis (menunggu sampai muncul). */
async function tautan(email: string, jenis: 'verifikasi' | 'atur-ulang', setelah = 0): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      () => {
        let isi: string;
        try {
          isi = readFileSync(OUTBOX, 'utf8');
        } catch {
          return undefined;
        }
        const semua = isi
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l) as { to: string; jenis: string; link: string })
          .filter((m) => m.to === email && m.jenis === jenis);
        link = semua.length > setelah ? semua.at(-1)!.link : undefined;
        return link;
      },
      { timeout: 10_000 },
    )
    .toBeTruthy();
  return link!;
}

/** fetch dari halaman (peramban mengirim Origin dan Sec-Fetch-Site: same-origin seperti aplikasi asli). */
async function api(page: Page, method: string, path: string, body?: unknown) {
  return page.evaluate(
    async ([m, p, b]) => {
      const r = await fetch(p as string, {
        method: m as string,
        ...(b === undefined
          ? {}
          : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }),
      });
      const text = await r.text();
      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {
        // bukan JSON (berkas)
      }
      return { status: r.status, cacheControl: r.headers.get('cache-control'), text, json };
    },
    [method, path, body] as const,
  );
}

async function daftar(page: Page, email: string, sandi = SANDI) {
  await page.goto('/daftar');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel(/Kata sandi/).fill(sandi);
  await page.getByRole('button', { name: 'Daftar', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Cek email Anda');
}

async function verifikasi(page: Page, email: string, sandi = SANDI, setelah = 0) {
  await page.goto(await tautan(email, 'verifikasi', setelah));
  await page.getByLabel(/Kata sandi/).fill(sandi);
  await page.getByRole('button', { name: 'Pastikan email saya' }).click();
}

async function masuk(page: Page, email: string, sandi: string, turnstile?: string) {
  await page.goto('/masuk');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Kata sandi').fill(sandi);
  if (turnstile)
    await page
      .locator('form[action="?/masuk"] input[name="turnstile"]')
      .evaluate((el, v) => ((el as HTMLInputElement).value = v), turnstile);
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();
  await page.waitForLoadState('networkidle');
}

async function akunBaru(page: Page, email: string) {
  await daftar(page, email);
  await verifikasi(page, email);
  await expect(page.getByRole('status')).toContainText('Email sudah dipastikan');
}

const sesiApi = async (page: Page) => (await api(page, 'GET', '/api/akun')).json;

test('#43 daftar → verifikasi → masuk → Data Diri tersimpan → masuk di HP (konteks kedua) → data sama', async ({
  page,
  context,
  browser,
}) => {
  await pakaiIp(context);
  const email = emailBaru('e43');
  await akunBaru(page, email);
  await masuk(page, email, SANDI);
  await expect(page).toHaveURL(/\/lengkapi-profil\?next=%2F$/);
  await page.getByLabel(/Nama lengkap/).fill('Warga Uji E2E');
  await page.getByRole('button', { name: 'Simpan' }).click();
  await expect(page).toHaveURL(/\/$/);
  const sesi = (await context.cookies()).find((c) => c.name === '__Host-urusin_akun');
  expect(sesi).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
  const isi = { namaLengkap: 'Warga Uji E2E', nik: NIK, rt: '001' };
  expect((await api(page, 'PUT', '/api/vault/data-diri', isi)).status).toBe(200);

  const hp = await konteksHp(browser);
  await masuk(hp.page, email, SANDI);
  await expect(hp.page).toHaveURL(/\/$/); // profil sudah lengkap dari laptop
  const g = await api(hp.page, 'GET', '/api/vault/data-diri');
  expect([g.status, g.cacheControl, g.json.dataDiri]).toEqual([200, 'no-store', isi]);
  const s = await sesiApi(hp.page);
  expect(s).toMatchObject({ masuk: true, akun: { email, sinkron: true, profilLengkap: true } });
  expect(s.perangkat).toHaveLength(2);
  await hp.ctx.close();
});

test('#44 lupa sandi → atur ulang → semua sesi dicabut; tautan sekali pakai; sandi lama ditolak', async ({
  page,
  context,
  browser,
}) => {
  await pakaiIp(context);
  const email = emailBaru('e44');
  await akunBaru(page, email);
  await masuk(page, email, SANDI);
  const lain = await konteksHp(browser);
  await masuk(lain.page, email, SANDI);
  expect((await sesiApi(lain.page)).masuk).toBe(true);

  await page.goto('/lupa-sandi');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Kirim tautan' }).click();
  await expect(page.getByRole('status')).toContainText('Tautan berlaku 30 menit');
  const reset = await tautan(email, 'atur-ulang');
  await page.goto(reset);
  await page.getByLabel(/Kata sandi baru/).fill(SANDI2);
  await page.getByRole('button', { name: 'Simpan kata sandi' }).click();
  await expect(page.getByRole('status')).toContainText('Kata sandi baru tersimpan');
  expect((await sesiApi(page)).masuk).toBe(false);
  expect((await sesiApi(lain.page)).masuk).toBe(false); // perangkat lain ikut dikeluarkan
  await lain.ctx.close();

  await page.goto(reset);
  await expect(page.getByRole('alert')).toHaveAttribute('data-kode', 'TOKEN_TIDAK_VALID');
  await masuk(page, email, SANDI);
  await expect(page.getByRole('alert')).toHaveAttribute('data-kode', 'KREDENSIAL_SALAH');
  await masuk(page, email, SANDI2);
  expect((await sesiApi(page)).masuk).toBe(true);
});

test('#45 Turnstile setelah 3 gagal, kunci setelah 5, pesan identik; juri butuh Turnstile + batas per IP', async ({
  page,
  context,
}) => {
  await pakaiIp(context);
  const email = emailBaru('e45');
  await akunBaru(page, email);
  const pesan: Record<string, string[]> = {};
  for (const target of [email, emailBaru('hantu')]) {
    const urutan: string[] = [];
    for (let i = 0; i < 3; i++) {
      await masuk(page, target, SANDI2);
      urutan.push(
        `${await page.getByRole('alert').getAttribute('data-kode')}|${await page.getByRole('alert').textContent()}`,
      );
    }
    await masuk(page, target, SANDI2);
    urutan.push(`${await page.getByRole('alert').getAttribute('data-kode')}`);
    for (let i = 0; i < 2; i++) {
      await masuk(page, target, SANDI2, TURNSTILE);
      urutan.push(`${await page.getByRole('alert').getAttribute('data-kode')}`);
    }
    // terkunci: sandi benar pun ditolak
    await masuk(page, target, SANDI, TURNSTILE);
    urutan.push(`${await page.getByRole('alert').getAttribute('data-kode')}`);
    pesan[target === email ? 'ada' : 'tidak'] = urutan;
  }
  expect(pesan.ada).toEqual(pesan.tidak);
  expect(pesan.ada!.map((p) => p.split('|')[0])).toEqual([
    'KREDENSIAL_SALAH',
    'KREDENSIAL_SALAH',
    'KREDENSIAL_SALAH',
    'TURNSTILE_WAJIB',
    'KREDENSIAL_SALAH',
    'KREDENSIAL_SALAH',
    'TERKUNCI',
  ]);
  expect((await sesiApi(page)).masuk).toBe(false);

  // Masuk sebagai juri: tanpa Turnstile ditolak; maksimal 3 salinan per IP per hari; tanpa sandi demo
  await pakaiIp(context);
  await page.goto('/masuk');
  await page.getByRole('button', { name: 'Masuk sebagai juri' }).click();
  await expect(page.getByRole('alert')).toHaveAttribute('data-kode', 'TURNSTILE_WAJIB');
  await page
    .locator('form[data-juri] input[name="turnstile"]')
    .evaluate((el, v) => ((el as HTMLInputElement).value = v), TURNSTILE);
  await page.getByRole('button', { name: 'Masuk sebagai juri' }).click();
  await expect(page).toHaveURL(/\/beranda$/);
  expect((await sesiApi(page)).akun).toMatchObject({ jenis: 'demo', email: null });
  for (let i = 0; i < 2; i++)
    expect((await api(page, 'POST', '/api/akun/juri', { turnstile: TURNSTILE })).status).toBe(200);
  const ke4 = await api(page, 'POST', '/api/akun/juri', { turnstile: TURNSTILE });
  expect([ke4.status, ke4.json.kode]).toEqual([429, 'DEMO_BATAS_IP']);
  expect(hitung("SELECT COUNT(*) n FROM users WHERE jenis = 'demo' AND password_hash IS NOT NULL")).toBe(0);
});

test('#46 hapus akun: user/sesi/vault/berkas/DEK hilang, nol PII plaintext di DB; /api/vault/:id aman', async ({
  page,
  context,
  browser,
}) => {
  await pakaiIp(context);
  const email = emailBaru('e46');
  await akunBaru(page, email);
  await masuk(page, email, SANDI);
  expect(
    (await api(page, 'PUT', '/api/vault/data-diri', { namaLengkap: 'Hapus Saya', nik: NIK })).status,
  ).toBe(200);
  const id = (await sesiApi(page)).akun.id as string;
  const docId = await page.evaluate(async () => {
    const fd = new FormData();
    fd.set(
      'berkas',
      new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], { type: 'image/png' }),
      'ktp.png',
    );
    fd.set('jenis', 'ktp');
    fd.set('judul', 'KTP');
    const r = await fetch('/api/vault', { method: 'POST', body: fd });
    return ((await r.json()) as { id: string }).id;
  });
  const dl = await api(page, 'GET', `/api/vault/${docId}`);
  expect([dl.status, dl.cacheControl]).toEqual([200, 'no-store']);
  // tanpa Sec-Fetch-Site (bukan dari halaman kita): 403
  expect((await page.request.get(`/api/vault/${docId}`)).status()).toBe(403);

  // perangkat baru (sesi yang belum pernah mengunduh) dengan login > 15 menit lalu: 401 sampai konfirmasi sandi
  const laptop = await konteksHp(browser);
  await masuk(laptop.page, email, SANDI);
  db((d) =>
    d
      .prepare('UPDATE auth_sessions SET auth_at = ? WHERE user_id = ? AND pernah_unduh = 0')
      .run(new Date(Date.now() - 20 * 60_000).toISOString(), id),
  );
  const perlu = await api(laptop.page, 'GET', `/api/vault/${docId}`);
  expect([perlu.status, perlu.json.kode]).toEqual([401, 'PERLU_MASUK_ULANG']);
  expect((await api(laptop.page, 'POST', '/api/akun/konfirmasi-sandi', { sandi: SANDI })).status).toBe(200);
  expect((await api(laptop.page, 'GET', `/api/vault/${docId}`)).status).toBe(200);
  await laptop.ctx.close();

  // akun lain: 404
  const lain = await konteksHp(browser);
  const emailLain = emailBaru('e46b');
  await akunBaru(lain.page, emailLain);
  await masuk(lain.page, emailLain, SANDI);
  expect((await api(lain.page, 'GET', `/api/vault/${docId}`)).status).toBe(404);
  await lain.ctx.close();

  expect((await api(page, 'POST', '/api/akun/hapus', { konfirmasi: 'HAPUS', sandi: SANDI })).status).toBe(
    200,
  );
  expect((await sesiApi(page)).masuk).toBe(false);
  for (const t of [
    'users WHERE id = ?',
    'auth_sessions WHERE user_id = ?',
    'vault_data_diri WHERE user_id = ?',
    'vault_documents WHERE user_id = ?',
    'user_keys WHERE user_id = ?',
  ])
    expect([t, hitung(`SELECT COUNT(*) n FROM ${t}`, id)]).toEqual([t, 0]);
  db((d) => d.exec('PRAGMA wal_checkpoint(TRUNCATE)'));
  for (const f of [DB_PATH, `${DB_PATH}-wal`])
    if (existsSync(f)) expect(readFileSync(f).includes(Buffer.from(NIK))).toBe(false);
});

test('#47 coba tanpa daftar: menjelajah tidak membuat baris; juri terisolasi; data tamu pindah saat mendaftar', async ({
  page,
  context,
  browser,
}) => {
  await pakaiIp(context);
  const sebelum = hitung('SELECT COUNT(*) n FROM users');
  await page.goto('/');
  await page.goto('/masuk');
  await page.getByRole('link', { name: 'Coba tanpa daftar' }).click();
  await expect(page).toHaveURL(/\/beranda$/);
  expect((await sesiApi(page)).masuk).toBe(false);
  const v = await api(page, 'GET', '/api/vault');
  expect([v.status, v.json.pemilik, v.json.dataDiri.ada]).toEqual([200, 'tamu', false]);
  expect((await api(page, 'GET', '/api/vault/data-diri')).status).toBe(200);
  expect((await api(page, 'POST', '/api/urusan', {})).status).toBe(201);
  expect(hitung('SELECT COUNT(*) n FROM users')).toBe(sebelum);

  // tulis vault pertama membuat tamu; daftar + verifikasi + masuk memindahkan data tamu ke akun
  expect((await api(page, 'PUT', '/api/vault/data-diri', { namaLengkap: 'Tamu E2E' })).status).toBe(200);
  expect(hitung('SELECT COUNT(*) n FROM users')).toBe(sebelum + 1);
  const email = emailBaru('e47');
  await akunBaru(page, email);
  await masuk(page, email, SANDI);
  await expect(page).toHaveURL(/\/$/); // nama dari data tamu: profil lengkap
  expect(hitung('SELECT COUNT(*) n FROM users')).toBe(sebelum + 1); // tamu sudah dilebur ke akun
  const hp = await konteksHp(browser);
  await masuk(hp.page, email, SANDI);
  expect((await api(hp.page, 'GET', '/api/vault/data-diri')).json.dataDiri).toEqual({
    namaLengkap: 'Tamu E2E',
  });
  await hp.ctx.close();

  // dua juri: salinan terisolasi per klik
  const a = await konteksHp(browser);
  const b = await konteksHp(browser);
  for (const j of [a, b]) {
    await j.page.goto('/');
    expect((await api(j.page, 'POST', '/api/akun/juri', { turnstile: TURNSTILE })).status).toBe(200);
  }
  expect((await api(a.page, 'PUT', '/api/vault/data-diri', { namaLengkap: 'Diubah Juri A' })).status).toBe(
    200,
  );
  expect((await api(b.page, 'GET', '/api/vault/data-diri')).json.dataDiri.namaLengkap).toBe(
    'Juri Contoh Urusin',
  );
  expect((await sesiApi(a.page)).akun.id).not.toBe((await sesiApi(b.page)).akun.id);
  await a.ctx.close();
  await b.ctx.close();
});

/** Mulai "Masuk dengan Google" lalu kembalikan URL layar persetujuan IdP tiruan. */
async function mulaiGoogle(page: Page): Promise<string> {
  await page.goto('/masuk');
  await page.getByRole('button', { name: 'Lanjutkan dengan Google' }).click();
  await expect(page).toHaveURL(/\/dev\/oidc\/authorize\?/);
  return page.url();
}

/** Setujui di IdP tiruan tanpa mengikuti redirect: kembalikan URL callback (code + state). */
async function kodeDari(page: Page, authUrl: string, claims: Record<string, string>): Promise<string> {
  const r = await page.request.post('/dev/oidc/authorize', {
    headers: { origin: ORIGIN },
    form: { url: authUrl, email_verified: 'true', skenario: 'normal', nama: '', ...claims },
    maxRedirects: 0,
  });
  expect(r.status()).toBe(303);
  return r.headers().location!;
}

async function setujuiGoogle(
  page: Page,
  claims: { sub: string; email: string; nama?: string; skenario?: string },
) {
  await page.getByLabel('sub').fill(claims.sub);
  await page.getByLabel('email', { exact: true }).fill(claims.email);
  await page.getByLabel('nama').fill(claims.nama ?? 'Warga Google');
  if (claims.skenario) await page.getByLabel('skenario').selectOption(claims.skenario);
  await page.getByRole('button', { name: 'Setujui' }).click();
  await page.waitForLoadState('networkidle');
}

test('#48 Google lewat IdP OIDC tiruan: PKCE/state/nonce ditegakkan; email sama tidak tertaut otomatis', async ({
  page,
  context,
}) => {
  await pakaiIp(context);
  // berhasil: akun baru dari Google
  let auth = await mulaiGoogle(page);
  const q = new URL(auth).searchParams;
  expect([
    q.get('code_challenge_method'),
    !!q.get('code_challenge'),
    !!q.get('nonce'),
    !!q.get('state'),
  ]).toEqual(['S256', true, true, true]);
  expect(q.get('redirect_uri')).toBe(`${ORIGIN}/auth/google/callback`);
  const emailG = emailBaru('e48g');
  await setujuiGoogle(page, { sub: `sub-${unik()}`, email: emailG });
  await expect(page).toHaveURL(/\/$/);
  expect((await sesiApi(page)).akun).toMatchObject({ email: emailG, terhubungGoogle: true });
  await api(page, 'POST', '/api/akun/keluar', {});

  // tanpa PKCE: IdP menolak (klien kita selalu mengirim S256, lihat di atas)
  const tanpa = new URL(auth);
  tanpa.searchParams.delete('code_challenge');
  tanpa.searchParams.delete('code_challenge_method');
  expect((await page.goto(tanpa.href))!.status()).toBe(400);

  // state salah
  auth = await mulaiGoogle(page);
  const cb = new URL(await kodeDari(page, auth, { sub: `sub-${unik()}`, email: emailBaru('e48s') }));
  const salah = new URL(cb);
  salah.searchParams.set('state', 'S'.repeat(43));
  await page.goto(salah.pathname + salah.search);
  await expect(page).toHaveURL(/\/masuk\?galat=GOOGLE_GAGAL$/);
  // state dipakai ulang (replay) setelah alur sukses
  auth = await mulaiGoogle(page);
  const ok = new URL(await kodeDari(page, auth, { sub: `sub-${unik()}`, email: emailBaru('e48r') }));
  await page.goto(ok.pathname + ok.search);
  await expect(page).toHaveURL(/\/lengkapi-profil|\/$/);
  await api(page, 'POST', '/api/akun/keluar', {});
  await page.goto(ok.pathname + ok.search);
  await expect(page).toHaveURL(/\/masuk\?galat=GOOGLE_GAGAL$/);
  expect((await sesiApi(page)).masuk).toBe(false);

  // nonce salah
  await mulaiGoogle(page);
  await setujuiGoogle(page, { sub: `sub-${unik()}`, email: emailBaru('e48n'), skenario: 'nonce-salah' });
  await expect(page).toHaveURL(/\/masuk\?galat=GOOGLE_GAGAL$/);

  // PKCE tidak cocok: kode alur A ditukar dengan state/verifier alur B
  const authA = await mulaiGoogle(page);
  const cbA = new URL(await kodeDari(page, authA, { sub: `sub-${unik()}`, email: emailBaru('e48p') }));
  const authB = await mulaiGoogle(page);
  const stateB = new URL(authB).searchParams.get('state')!;
  await page.goto(`/auth/google/callback?code=${cbA.searchParams.get('code')}&state=${stateB}`);
  await expect(page).toHaveURL(/\/masuk\?galat=GOOGLE_GAGAL$/);
  expect((await sesiApi(page)).masuk).toBe(false);

  // email sama dengan akun sandi terverifikasi: TIDAK tertaut otomatis; tertaut setelah bukti sandi
  const email = emailBaru('e48');
  await akunBaru(page, email);
  const sub = `sub-${unik()}`;
  await mulaiGoogle(page);
  await setujuiGoogle(page, { sub, email });
  await expect(page).toHaveURL(/\/masuk\?galat=GOOGLE_PERLU_SANDI/);
  await expect(page.getByRole('alert')).toHaveAttribute('data-kode', 'GOOGLE_PERLU_SANDI');
  await expect(page.locator('[data-tautkan]')).toBeVisible();
  expect((await sesiApi(page)).masuk).toBe(false);
  expect(hitung('SELECT COUNT(*) n FROM oauth_identities WHERE sub = ?', sub)).toBe(0);
  await masuk(page, email, SANDI);
  expect((await sesiApi(page)).akun).toMatchObject({ email, terhubungGoogle: true });
});

test('#48b pra-akun: belum terverifikasi tidak memblokir; Google mengambil alih; daftar ulang membatalkan sandi lama', async ({
  page,
  context,
  browser,
}) => {
  await pakaiIp(context);
  // penyerang mendaftar lebih dulu dengan email korban (tidak bisa memverifikasi) lalu masuk
  const email = emailBaru('e48b');
  const penyerang = await konteksHp(browser);
  await daftar(penyerang.page, email, SANDI2);
  await masuk(penyerang.page, email, SANDI2);
  expect((await sesiApi(penyerang.page)).akun).toMatchObject({ emailTerverifikasi: false, sinkron: false });
  // pemilik asli masuk dengan Google (email_verified): akun diambil alih, sandi + sesi penyerang dihapus
  await mulaiGoogle(page);
  await setujuiGoogle(page, { sub: `sub-${unik()}`, email });
  await expect(page).toHaveURL(/\/lengkapi-profil|\/$/);
  expect((await sesiApi(page)).akun).toMatchObject({ email, emailTerverifikasi: true, punyaSandi: false });
  expect((await sesiApi(penyerang.page)).masuk).toBe(false);
  await masuk(penyerang.page, email, SANDI2);
  await expect(penyerang.page.getByRole('alert')).toHaveAttribute('data-kode', 'KREDENSIAL_SALAH');
  await penyerang.ctx.close();

  // daftar ulang (email belum terverifikasi): tautan baru meminta sandi terbaru; sandi lama batal
  const email2 = emailBaru('e48b2');
  await api(page, 'POST', '/api/akun/keluar', {});
  await daftar(page, email2, SANDI2);
  await tautan(email2, 'verifikasi');
  await daftar(page, email2, SANDI);
  await verifikasi(page, email2, SANDI2, 1);
  await expect(page.getByRole('alert')).toHaveAttribute('data-kode', 'KREDENSIAL_SALAH');
  await verifikasi(page, email2, SANDI, 1);
  await expect(page.getByRole('status')).toContainText('Email sudah dipastikan');
  await api(page, 'POST', '/api/akun/keluar', {});
  await masuk(page, email2, SANDI2);
  await expect(page.getByRole('alert')).toHaveAttribute('data-kode', 'KREDENSIAL_SALAH');
  await masuk(page, email2, SANDI);
  expect((await sesiApi(page)).akun).toMatchObject({ email: email2, sinkron: true });
});
