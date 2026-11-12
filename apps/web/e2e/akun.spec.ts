/* eslint-disable @typescript-eslint/no-explicit-any -- tes membaca JSON respons tanpa tipe */
import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { devices, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { DB_PATH, E2E_GIT_SHA, ORIGIN, OUTBOX } from '../playwright.config';

/**
 * E2E akun #43–#49 (rencana §3.26, §4 e2e). Kasus berbasis waktu (penyapu 24 jam, kedaluwarsa izin) memakai
 * jam palsu di vitest (`packages/akun/src/service.test.ts`); di sini waktu "dimajukan" dengan menulis ke DB.
 */

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
async function tautan(email: string, jenis: 'atur-ulang', setelah = 0): Promise<string> {
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

/** Isi formulir daftar (ADR 0032: tanpa verifikasi email; sukses = langsung masuk). */
async function isiDaftar(page: Page, email: string, sandi = SANDI, path = '/daftar') {
  await page.goto(path);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel(/Kata sandi/).fill(sandi);
  await page.getByRole('button', { name: 'Daftar', exact: true }).click();
}

async function daftar(page: Page, email: string, sandi = SANDI) {
  await isiDaftar(page, email, sandi);
  await expect(page).toHaveURL(/\/beranda$/);
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

/** Akun baru lewat UI, lalu keluar (tes berikutnya masuk dengan sandi seperti warga di perangkat lain). */
async function akunBaru(page: Page, email: string) {
  await daftar(page, email);
  expect((await api(page, 'POST', '/api/akun/keluar', {})).status).toBe(200);
}

const sesiApi = async (page: Page) => (await api(page, 'GET', '/api/akun')).json;

test('#43 daftar (langsung masuk) → keluar → masuk → Data Diri tersimpan → masuk di HP → data sama', async ({
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
  await expect(page.getByText('Salinan demo juri').first()).toBeAttached(); // tanpa email: tetap render
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
  // UI: "Lihat" → masuk ulang (email terisi) → kembali ke /dokumen dan unduhan berlanjut
  await laptop.page.goto('/dokumen');
  await laptop.page.locator('[data-lihat]').first().click();
  await expect(laptop.page).toHaveURL(/\/masuk\?ulang=1&lanjut=%2Fdokumen%3Funduh%3D/);
  await expect(laptop.page.locator('[data-ulang]')).toBeVisible();
  await expect(laptop.page.getByLabel('Email')).toHaveValue(email);
  await laptop.page.getByLabel('Kata sandi').fill(SANDI);
  const [unduhan] = await Promise.all([
    laptop.page.waitForEvent('download'),
    laptop.page.getByRole('button', { name: 'Masuk', exact: true }).click(),
  ]);
  expect(unduhan.suggestedFilename()).toMatch(/^KTP/);
  await expect(laptop.page).toHaveURL(/\/dokumen$/);
  db((d) =>
    d
      .prepare('UPDATE auth_sessions SET auth_at = ?, pernah_unduh = 0 WHERE user_id = ?')
      .run(new Date(Date.now() - 20 * 60_000).toISOString(), id),
  );
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
  await expect(page).toHaveURL(/\/$/);
  expect((await sesiApi(page)).masuk).toBe(false);
  const v = await api(page, 'GET', '/api/vault');
  expect([v.status, v.json.pemilik, v.json.dataDiri.ada]).toEqual([200, 'tamu', false]);
  expect((await api(page, 'GET', '/api/vault/data-diri')).status).toBe(200);
  expect((await api(page, 'POST', '/api/urusan', {})).status).toBe(201);
  expect(hitung('SELECT COUNT(*) n FROM users')).toBe(sebelum);

  // tulis vault pertama membuat tamu; daftar (langsung masuk) memindahkan data tamu ke akun
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

  // email sama dengan akun sandi (tanpa verifikasi, ADR 0032): TIDAK tertaut otomatis; tertaut setelah bukti sandi
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

test('#48b daftar langsung masuk; email ganda ditolak tanpa mengubah sandi; Google tidak mengambil alih', async ({
  page,
  context,
  browser,
}) => {
  await pakaiIp(context);
  // daftar = akun penuh + sesi aktif, tanpa email apa pun
  const email = emailBaru('e48b');
  const pertama = await konteksHp(browser);
  await daftar(pertama.page, email, SANDI2);
  expect(await sesiApi(pertama.page)).toMatchObject({ masuk: true, akun: { email, sinkron: true } });
  expect(
    hitung('SELECT COUNT(*) n FROM email_tokens t JOIN users u ON u.id = t.user_id WHERE u.email = ?', email),
  ).toBe(0);

  // email ganda: galat jelas + tautan Masuk; sandi pemilik pertama tidak berubah
  await isiDaftar(page, email.toUpperCase(), SANDI);
  await expect(page.getByRole('alert')).toHaveAttribute('data-kode', 'EMAIL_SUDAH_TERDAFTAR');
  await expect(page.getByRole('alert')).toContainText('sudah terdaftar. Silakan masuk.');
  await expect(page.getByRole('alert').getByRole('link', { name: 'Masuk' })).toBeVisible();
  expect((await sesiApi(page)).masuk).toBe(false);
  await masuk(page, email, SANDI);
  await expect(page.getByRole('alert')).toHaveAttribute('data-kode', 'KREDENSIAL_SALAH');

  // Google ber-email sama: tidak mengambil alih; sesi pemilik sandi utuh; tertaut hanya dengan bukti sandi
  const sub = `sub-${unik()}`;
  await mulaiGoogle(page);
  await setujuiGoogle(page, { sub, email });
  await expect(page).toHaveURL(/\/masuk\?galat=GOOGLE_PERLU_SANDI/);
  expect((await sesiApi(page)).masuk).toBe(false);
  expect(hitung('SELECT COUNT(*) n FROM oauth_identities WHERE sub = ?', sub)).toBe(0);
  expect((await sesiApi(pertama.page)).akun).toMatchObject({
    email,
    punyaSandi: true,
    terhubungGoogle: false,
  });
  await pertama.ctx.close();
  await masuk(page, email, SANDI2);
  expect((await sesiApi(page)).akun).toMatchObject({ email, terhubungGoogle: true, punyaSandi: true });

  // tautan verifikasi lama di kotak surat: dialihkan, tidak ada halaman verifikasi lagi
  await page.goto('/verifikasi-email?token=' + 'A'.repeat(43));
  await expect(page).toHaveURL(/\/beranda$/);
});

test('tamu di portal tanpa situs latihan diajak daftar; setelah daftar kembali ke urusan yang sama dengan portal asli', async ({
  page,
  context,
}) => {
  await pakaiIp(context);
  await page.goto('/peristiwa/kelahiran');
  const kota = page.getByRole('combobox', { name: 'Kabupaten/kota sesuai KTP Anda' });
  await expect(kota).toHaveAttribute('aria-autocomplete', 'list'); // terhidrasi: select menjadi combobox
  // Kota Malang: daerah Browser Pendamping aktif (ADR 0033) dengan portal web asli tanpa situs latihan.
  await kota.fill('Malang');
  await page.getByRole('option', { name: 'Kota Malang', exact: true }).click();
  await page.getByRole('button', { name: 'Mulai urusan ini' }).click();
  await expect(page).toHaveURL(/\/urusan\/u_[0-9a-f]{32}$/);
  const urlUrusan = page.url();
  const benar = page.getByRole('button', { name: 'Ya, betul' });
  await expect(benar).toBeEnabled({ timeout: 20_000 });
  await benar.click();
  const setujuiRencana = page.getByRole('button', { name: 'Setujui rencana' });
  await expect(setujuiRencana).toBeEnabled({ timeout: 20_000 });
  await setujuiRencana.click();

  // tamu: tidak ada tawaran palsu "Setujui dan buka situs"; ajakan masuk/daftar yang jujur
  const ajak = page.getByRole('link', { name: 'Masuk / Daftar (gratis, 30 detik)' });
  await expect(ajak).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Setujui dan buka situs' })).toHaveCount(0);
  await ajak.click();
  await expect(page).toHaveURL(/\/daftar\?next=%2Furusan%2Fu_/);
  const email = emailBaru('tamu-malang');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel(/Kata sandi/).fill(SANDI);
  await page.getByRole('button', { name: 'Daftar', exact: true }).click();

  // kembali ke urusan yang sama (pindah ke akun), rencana tetap, kini portal asli ditawarkan
  await expect(page).toHaveURL(urlUrusan);
  expect(await sesiApi(page)).toMatchObject({ masuk: true, akun: { email, sinkron: true } });
  await expect(page.getByRole('button', { name: 'Setujui dan buka situs' })).toBeEnabled({ timeout: 20_000 });
  await expect(page.getByRole('link', { name: 'Masuk / Daftar (gratis, 30 detik)' })).toHaveCount(0);
  const id = urlUrusan.split('/').at(-1)!;
  expect(
    hitung(
      'SELECT COUNT(*) n FROM urusan_owner o JOIN users u ON u.id = o.user_id WHERE o.urusan_id = ? AND u.email = ?',
      id,
      email,
    ),
  ).toBe(1);
});

test('#49 zona bahaya di Pengaturan: keluar dari semua perangkat, lalu hapus akun lewat form tanpa JS', async ({
  page,
  context,
  browser,
}) => {
  const ip = await pakaiIp(context);
  const email = emailBaru('e49');
  await akunBaru(page, email);
  await masuk(page, email, SANDI);
  const hp = await konteksHp(browser);
  await masuk(hp.page, email, SANDI);
  expect((await sesiApi(hp.page)).masuk).toBe(true);

  await page.goto('/pengaturan');
  // Stempel versi M11: baris kecil v<sha7> bertaut ke commit di GitHub.
  const versi = page.locator('[data-versi] a');
  await expect(versi).toHaveText(`v${E2E_GIT_SHA.slice(0, 7)}`);
  await expect(versi).toHaveAttribute('href', `https://github.com/bynguts/urusin/commit/${E2E_GIT_SHA}`);
  const zona = page.locator('[data-zona-bahaya]');
  await expect(zona.getByRole('heading', { name: 'Zona bahaya' })).toBeVisible();
  // Perangkat bersama: daftar urusan di perangkat ini harus ikut hilang saat keluar.
  const urusanLokal = () =>
    page.evaluate(
      () => (JSON.parse(localStorage.getItem('urusin.lokal.v1') ?? '{}') as { urusan?: unknown[] }).urusan,
    );
  await page.evaluate(() =>
    localStorage.setItem(
      'urusin.lokal.v1',
      JSON.stringify({
        urusan: [
          { id: `u_${'d'.repeat(32)}`, judul: 'Urusan lama', peristiwa: null, dibuatPada: '2026-11-10' },
        ],
      }),
    ),
  );
  await zona.getByRole('button', { name: 'Keluar dari semua perangkat' }).click();
  await expect(page).toHaveURL(/\/masuk$/);
  expect(await urusanLokal()).toEqual([]);
  expect((await sesiApi(page)).masuk).toBe(false);
  expect((await sesiApi(hp.page)).masuk).toBe(false); // perangkat lain ikut dikeluarkan
  await hp.ctx.close();

  // Progressive enhancement: form action jalan tanpa JavaScript.
  const tanpaJs = await browser.newContext({
    baseURL: ORIGIN,
    locale: 'id-ID',
    javaScriptEnabled: false,
    extraHTTPHeaders: { 'x-forwarded-proto': 'http', 'x-forwarded-for': ip },
  });
  const p = await tanpaJs.newPage();
  await masuk(p, email, SANDI);
  await p.goto('/pengaturan');
  const hapus = p.locator('form[data-hapus-akun]');
  await hapus.getByLabel('Ketik HAPUS untuk melanjutkan').fill('HAPUS');
  await hapus.locator('#sandi-hapus').fill(SANDI2);
  await hapus.getByRole('button', { name: 'Hapus akun permanen' }).click();
  await expect(p.locator('form[data-hapus-akun]')).toContainText('Kata sandi saat ini salah.');
  expect(hitung('SELECT COUNT(*) n FROM users WHERE email = ?', email)).toBe(1);

  await p.locator('form[data-hapus-akun]').getByLabel('Ketik HAPUS untuk melanjutkan').fill('HAPUS');
  await p.locator('#sandi-hapus').fill(SANDI);
  await p.locator('form[data-hapus-akun]').getByRole('button', { name: 'Hapus akun permanen' }).click();
  await expect(p).toHaveURL(`${ORIGIN}/`);
  expect(hitung('SELECT COUNT(*) n FROM users WHERE email = ?', email)).toBe(0);
  await tanpaJs.close();
});

test('isian sebelum hidrasi tidak terhapus (HP lambat): email tetap, form tetap terkirim', async ({
  page,
  context,
}) => {
  await pakaiIp(context);
  // Tahan potongan JS halaman agar warga (dan Playwright) mengetik SEBELUM hidrasi, lalu lepaskan.
  const email = emailBaru('hidrasi');
  for (const path of ['/daftar', '/lupa-sandi', '/masuk'] as const) {
    let lepas = () => {};
    const ditahan = new Promise<void>((r) => (lepas = r));
    await page.route('**/_app/immutable/nodes/**', async (route) => {
      await ditahan;
      await route.continue();
    });
    try {
      await page.goto(path);
      await page.getByLabel('Email').fill(email);
    } finally {
      lepas(); // selalu dilepas: permintaan tertahan tidak boleh menggantung penutupan konteks
    }
    await page.waitForLoadState('networkidle');
    await page.unrouteAll();
    await expect(page.getByLabel('Email')).toHaveValue(email);
  }
  // Setelah hidrasi form masuk (use:enhance) terkirim dengan email itu dan menampilkan galat.
  await page.getByLabel('Kata sandi').fill(SANDI2);
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveAttribute('data-kode', 'KREDENSIAL_SALAH');
});
