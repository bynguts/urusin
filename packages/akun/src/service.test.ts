import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openHarnessDb, type Db } from '@urusin/harness';
import { beforeEach, describe, expect, it } from 'vitest';
import { AkunError } from './errors.js';
import { GoogleOidc } from './google.js';
import { MemoryMailer } from './mailer.js';
import { AkunService, amanNext, LOCKOUT, ringkasUserAgent, type AkunDeps } from './service.js';
import { FakeGoogle, testLimiter } from './testing.js';
import { sha256Hex } from './token.js';
import { deriveKek, Vault } from './vault.js';

const ORIGIN = 'https://urusin.example.com';
const EMAIL = 'warga@example.com';
const SANDI = 'kuda-lari-cepat-9';
const SANDI2 = 'gajah-terbang-tinggi-7';
const ctx = { ip: '203.0.113.5', userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile' };

let t: number;
let db: Db;
let mailer: MemoryMailer;
let akun: AkunService;
let google: FakeGoogle;

function buat(over: Partial<AkunDeps> = {}) {
  return new AkunService({
    db,
    mailer,
    vault: new Vault(
      db,
      deriveKek(Buffer.alloc(32, 3).toString('base64')),
      mkdtempSync(join(tmpdir(), 'akun-')),
      () => new Date(t),
    ),
    publicOrigin: ORIGIN,
    limiter: testLimiter(() => t),
    now: () => new Date(t),
    google: new GoogleOidc({
      clientId: google.clientId,
      clientSecret: google.clientSecret,
      redirectUri: `${ORIGIN}/auth/google/callback`,
      fetch: google.fetch,
    }),
    ...over,
  });
}

beforeEach(async () => {
  t = Date.parse('2026-11-09T08:00:00.000Z');
  db = openHarnessDb();
  mailer = new MemoryMailer();
  google ??= await FakeGoogle.create();
  google.gangguan = null;
  akun = buat();
});

const tokenDari = (link: string) => new URL(link).searchParams.get('token')!;

async function daftarTerverifikasi(email = EMAIL, sandi = SANDI) {
  await akun.daftar({ email, sandi }, ctx);
  akun.verifikasiEmail(tokenDari(mailer.last(email, 'verifikasi')!.link), ctx);
}

async function galat(p: Promise<unknown> | (() => unknown)): Promise<AkunError> {
  try {
    await (typeof p === 'function' ? p() : p);
  } catch (e) {
    if (e instanceof AkunError) return e;
    throw e;
  }
  throw new Error('tidak melempar');
}

describe('daftar → verifikasi → masuk', () => {
  it('alur lengkap; tautan verifikasi sekali pakai dan menunjuk origin publik', async () => {
    await akun.daftar({ email: ' Warga@Example.com ', sandi: SANDI }, ctx);
    const m = mailer.last(EMAIL, 'verifikasi')!;
    expect(m.link).toMatch(/^https:\/\/urusin\.example\.com\/verifikasi-email\?token=[A-Za-z0-9_-]{43}$/);
    expect(m.text).toContain(m.link);
    expect(m.html).toContain('lang="id"');

    // belum diverifikasi: sandi benar → 403, sandi salah → 401 generik
    expect((await galat(akun.masuk({ email: EMAIL, sandi: SANDI }, ctx))).kode).toBe(
      'EMAIL_BELUM_TERVERIFIKASI',
    );
    expect((await galat(akun.masuk({ email: EMAIL, sandi: SANDI2 }, ctx))).kode).toBe('KREDENSIAL_SALAH');

    const a = akun.verifikasiEmail(tokenDari(m.link), ctx);
    expect(a.emailVerifiedAt).not.toBeNull();
    expect((await galat(() => akun.verifikasiEmail(tokenDari(m.link), ctx))).kode).toBe('TOKEN_TIDAK_VALID');

    const { token, akun: masuk } = await akun.masuk({ email: 'WARGA@example.com', sandi: SANDI }, ctx);
    expect(masuk.email).toBe(EMAIL);
    const s = akun.sesi(token)!;
    expect(s.akun.id).toBe(a.id);
    // hanya hash token yang tersimpan
    const rows = db.prepare('SELECT token_hash, user_agent FROM auth_sessions').all() as {
      token_hash: string;
      user_agent: string;
    }[];
    expect(rows).toEqual([{ token_hash: sha256Hex(token), user_agent: 'Chrome di Android' }]);
    expect(JSON.stringify(db.prepare('SELECT * FROM auth_sessions').all())).not.toContain(token);
  });

  it('validasi masukan daftar', async () => {
    expect((await galat(akun.daftar({ email: 'bukan-email', sandi: SANDI }, ctx))).kode).toBe(
      'EMAIL_TIDAK_VALID',
    );
    expect((await galat(akun.daftar({ email: EMAIL, sandi: 'pendek' }, ctx))).kode).toBe(
      'SANDI_TERLALU_PENDEK',
    );
    expect((await galat(akun.daftar({ email: EMAIL, sandi: 'password123' }, ctx))).kode).toBe(
      'SANDI_TERLALU_UMUM',
    );
  });

  it('token verifikasi kedaluwarsa setelah 24 jam; kirim ulang membatalkan tautan lama', async () => {
    await akun.daftar({ email: EMAIL, sandi: SANDI }, ctx);
    const lama = mailer.last(EMAIL, 'verifikasi')!.link;
    await akun.kirimUlangVerifikasi(EMAIL, ctx);
    const baru = mailer.last(EMAIL, 'verifikasi')!.link;
    expect(baru).not.toBe(lama);
    expect((await galat(() => akun.verifikasiEmail(tokenDari(lama), ctx))).kode).toBe('TOKEN_TIDAK_VALID');
    t += 24 * 3600_000 + 1;
    expect((await galat(() => akun.verifikasiEmail(tokenDari(baru), ctx))).kode).toBe('TOKEN_TIDAK_VALID');
    expect((await galat(() => akun.verifikasiEmail('bukan token', ctx))).kode).toBe('TOKEN_TIDAK_VALID');
  });
});

describe('anti-enumerasi', () => {
  it('daftar dengan email yang sudah terverifikasi: hasil sama, email "sudah terdaftar", sandi tidak berubah', async () => {
    await daftarTerverifikasi();
    const n = mailer.sent.length;
    await expect(akun.daftar({ email: EMAIL, sandi: SANDI2 }, ctx)).resolves.toBeUndefined();
    expect(mailer.sent.length).toBe(n + 1);
    expect(mailer.sent.at(-1)!.jenis).toBe('sudah-terdaftar');
    await expect(akun.masuk({ email: EMAIL, sandi: SANDI }, ctx)).resolves.toBeDefined();
  });

  it('daftar ulang email belum terverifikasi: sandi diganti terbaru, tautan lama batal (anti pra-pembajakan)', async () => {
    await akun.daftar({ email: EMAIL, sandi: SANDI }, { ip: '198.51.100.1' }); // "penyerang" lebih dulu
    const linkPenyerang = mailer.last(EMAIL)!.link;
    await akun.daftar({ email: EMAIL, sandi: SANDI2 }, ctx); // pemilik asli
    expect((await galat(() => akun.verifikasiEmail(tokenDari(linkPenyerang), ctx))).kode).toBe(
      'TOKEN_TIDAK_VALID',
    );
    akun.verifikasiEmail(tokenDari(mailer.last(EMAIL)!.link), ctx);
    expect((await galat(akun.masuk({ email: EMAIL, sandi: SANDI }, ctx))).kode).toBe('KREDENSIAL_SALAH');
    await expect(akun.masuk({ email: EMAIL, sandi: SANDI2 }, ctx)).resolves.toBeDefined();
  });

  it('masuk: email tak dikenal, akun Google-saja, dan sandi salah → galat identik', async () => {
    await daftarTerverifikasi();
    await googleLogin({ sub: 'g-only', email: 'gonly@example.com', email_verified: true });
    const a = await galat(akun.masuk({ email: 'tidakada@example.com', sandi: SANDI }, ctx));
    const b = await galat(akun.masuk({ email: EMAIL, sandi: SANDI2 }, ctx));
    const c = await galat(akun.masuk({ email: 'gonly@example.com', sandi: SANDI }, ctx));
    const d = await galat(akun.masuk({ email: 'x', sandi: '' }, ctx));
    for (const e of [a, b, c, d]) {
      expect([e.status, e.kode, e.pesanWarga]).toEqual([
        401,
        'KREDENSIAL_SALAH',
        'Email atau kata sandi salah.',
      ]);
    }
  });

  it('lupa sandi dan kirim ulang: hasil sama untuk email ada/tidak ada; hanya yang ada yang menerima email', async () => {
    await daftarTerverifikasi();
    const n = mailer.sent.length;
    await expect(akun.lupaSandi('tidakada@example.com', ctx)).resolves.toBeUndefined();
    await expect(akun.kirimUlangVerifikasi('tidakada@example.com', ctx)).resolves.toBeUndefined();
    await expect(akun.kirimUlangVerifikasi(EMAIL, ctx)).resolves.toBeUndefined(); // sudah terverifikasi
    expect(mailer.sent.length).toBe(n);
    await expect(akun.lupaSandi(EMAIL, ctx)).resolves.toBeUndefined();
    expect(mailer.sent.length).toBe(n + 1);
  });
});

describe('lupa sandi → atur ulang', () => {
  it('reset 30 menit, sekali pakai, menghapus semua sesi, sandi lama tidak berlaku', async () => {
    await daftarTerverifikasi();
    const s1 = (await akun.masuk({ email: EMAIL, sandi: SANDI }, ctx)).token;
    const s2 = (await akun.masuk({ email: EMAIL, sandi: SANDI }, ctx)).token;
    await akun.lupaSandi(EMAIL, ctx);
    const link = mailer.last(EMAIL, 'atur-ulang')!.link;
    expect(link).toContain('/atur-ulang-sandi?token=');
    const token = tokenDari(link);
    expect(akun.tokenBerlaku(token, 'reset')).toBe(true);
    // sandi ditolak kebijakan → token TIDAK terbakar
    expect((await galat(akun.aturUlangSandi(token, 'pendek', ctx))).kode).toBe('SANDI_TERLALU_PENDEK');
    expect(akun.tokenBerlaku(token, 'reset')).toBe(true);

    await akun.aturUlangSandi(token, SANDI2, ctx);
    expect(akun.sesi(s1)).toBeNull();
    expect(akun.sesi(s2)).toBeNull();
    expect((await galat(akun.aturUlangSandi(token, SANDI2, ctx))).kode).toBe('TOKEN_TIDAK_VALID');
    expect((await galat(akun.masuk({ email: EMAIL, sandi: SANDI }, ctx))).kode).toBe('KREDENSIAL_SALAH');
    await expect(akun.masuk({ email: EMAIL, sandi: SANDI2 }, ctx)).resolves.toBeDefined();
  });

  it('token reset kedaluwarsa setelah 30 menit; permintaan baru membatalkan tautan lama', async () => {
    await daftarTerverifikasi();
    await akun.lupaSandi(EMAIL, ctx);
    const pertama = tokenDari(mailer.last(EMAIL, 'atur-ulang')!.link);
    await akun.lupaSandi(EMAIL, ctx);
    const kedua = tokenDari(mailer.last(EMAIL, 'atur-ulang')!.link);
    expect((await galat(akun.aturUlangSandi(pertama, SANDI2, ctx))).kode).toBe('TOKEN_TIDAK_VALID');
    t += 30 * 60_000 + 1;
    expect(akun.tokenBerlaku(kedua, 'reset')).toBe(false);
    expect((await galat(akun.aturUlangSandi(kedua, SANDI2, ctx))).kode).toBe('TOKEN_TIDAK_VALID');
  });

  it('token verifikasi tidak bisa dipakai sebagai token reset (dan sebaliknya)', async () => {
    await akun.daftar({ email: EMAIL, sandi: SANDI }, ctx);
    const v = tokenDari(mailer.last(EMAIL, 'verifikasi')!.link);
    expect((await galat(akun.aturUlangSandi(v, SANDI2, ctx))).kode).toBe('TOKEN_TIDAK_VALID');
    await akun.lupaSandi(EMAIL, ctx);
    const r = tokenDari(mailer.last(EMAIL, 'atur-ulang')!.link);
    expect((await galat(() => akun.verifikasiEmail(r, ctx))).kode).toBe('TOKEN_TIDAK_VALID');
    // reset membuktikan kepemilikan kotak surat → email terverifikasi
    await akun.aturUlangSandi(r, SANDI2, ctx);
    await expect(akun.masuk({ email: EMAIL, sandi: SANDI2 }, ctx)).resolves.toBeDefined();
  });
});

describe('sesi', () => {
  it('kedaluwarsa idle dan absolut; aktivitas memperpanjang idle', async () => {
    akun = buat({ ttl: { sesiIdleSec: 3600, sesiAbsolutSec: 3 * 3600 } });
    await daftarTerverifikasi();
    const { token } = await akun.masuk({ email: EMAIL, sandi: SANDI }, ctx);
    t += 50 * 60_000;
    expect(akun.sesi(token)).not.toBeNull(); // menyentuh last_seen
    t += 50 * 60_000;
    expect(akun.sesi(token)).not.toBeNull();
    t += 50 * 60_000;
    expect(akun.sesi(token)).not.toBeNull();
    t += 40 * 60_000; // > 3 jam sejak login: absolut habis walau aktif
    expect(akun.sesi(token)).toBeNull();

    const b = (await akun.masuk({ email: EMAIL, sandi: SANDI }, ctx)).token;
    t += 61 * 60_000; // idle habis
    expect(akun.sesi(b)).toBeNull();
    expect(db.prepare('SELECT COUNT(*) n FROM auth_sessions').get()).toEqual({ n: 0 });
  });

  it('login selalu menerbitkan token baru (rotasi); token buatan klien tidak pernah diterima (fiksasi)', async () => {
    await daftarTerverifikasi();
    const a = (await akun.masuk({ email: EMAIL, sandi: SANDI }, ctx)).token;
    const b = (await akun.masuk({ email: EMAIL, sandi: SANDI }, ctx)).token;
    expect(a).not.toBe(b);
    expect(akun.sesi('A'.repeat(43))).toBeNull();
    expect(akun.sesi(undefined)).toBeNull();
    expect(akun.sesi('pendek')).toBeNull();
  });

  it('keluar, keluar dari semua perangkat, daftar perangkat', async () => {
    await daftarTerverifikasi();
    const a = (await akun.masuk({ email: EMAIL, sandi: SANDI }, ctx)).token;
    const b = (await akun.masuk({ email: EMAIL, sandi: SANDI }, { ip: '1.1.1.1', userAgent: null })).token;
    const s = akun.sesi(a)!;
    const p = akun.perangkat(s.akun.id, s.tokenHash);
    expect(p).toHaveLength(2);
    expect(p.filter((x) => x.perangkatIni)).toHaveLength(1);
    expect(p.map((x) => x.ringkasan).sort()).toEqual(['Chrome di Android', 'Perangkat tidak dikenal']);
    akun.keluar(a);
    akun.keluar('bukan-token');
    expect(akun.sesi(a)).toBeNull();
    expect(akun.sesi(b)).not.toBeNull();
    const c = (await akun.masuk({ email: EMAIL, sandi: SANDI }, ctx)).token;
    expect(akun.keluarSemua(s.akun.id)).toBe(2);
    expect(akun.sesi(b)).toBeNull();
    expect(akun.sesi(c)).toBeNull();
  });

  it('ringkasan user-agent', () => {
    expect(ringkasUserAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/130 Safari/537 Edg/130')).toBe(
      'Edge di Windows',
    );
    expect(ringkasUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18) Version/18 Safari/604')).toBe(
      'Safari di iOS',
    );
    expect(ringkasUserAgent('Mozilla/5.0 (Macintosh) Firefox/140')).toBe('Firefox di macOS');
    expect(ringkasUserAgent('Mozilla/5.0 (X11; CrOS x86_64) Chrome/130')).toBe('Chrome di ChromeOS');
    expect(ringkasUserAgent('Mozilla/5.0 (X11; Linux x86_64) OPR/100 Chrome/130')).toBe('Opera di Linux');
    expect(ringkasUserAgent('SamsungBrowser/25 Android')).toBe('Samsung Internet di Android');
    expect(ringkasUserAgent('curl/8')).toBe('Peramban di perangkat lain');
  });
});

describe('pembatas laju dan penguncian', () => {
  it('lockout per email dengan backoff berlipat; berlaku juga untuk email tak terdaftar; berhasil membuka kunci', async () => {
    akun = buat({
      limits: { masuk: { ip: { limit: 1000, windowMs: 60_000 }, email: { limit: 1000, windowMs: 60_000 } } },
    });
    await daftarTerverifikasi();
    for (let i = 0; i < LOCKOUT.ambang; i++) {
      expect((await galat(akun.masuk({ email: EMAIL, sandi: SANDI2 }, ctx))).kode).toBe('KREDENSIAL_SALAH');
    }
    const kunci = await galat(akun.masuk({ email: EMAIL, sandi: SANDI }, ctx)); // sandi benar pun ditolak
    expect([kunci.kode, kunci.status, kunci.retryAfterSec]).toEqual(['TERKUNCI', 429, 30]);
    t += 31_000;
    expect((await galat(akun.masuk({ email: EMAIL, sandi: SANDI2 }, ctx))).kode).toBe('KREDENSIAL_SALAH');
    expect((await galat(akun.masuk({ email: EMAIL, sandi: SANDI }, ctx))).retryAfterSec).toBe(60); // berlipat
    t += 61_000;
    await expect(akun.masuk({ email: EMAIL, sandi: SANDI }, ctx)).resolves.toBeDefined();
    expect(db.prepare('SELECT COUNT(*) n FROM auth_lockout').get()).toEqual({ n: 0 });

    for (let i = 0; i < LOCKOUT.ambang; i++)
      await galat(akun.masuk({ email: 'hantu@example.com', sandi: SANDI }, ctx));
    expect((await galat(akun.masuk({ email: 'hantu@example.com', sandi: SANDI }, ctx))).kode).toBe(
      'TERKUNCI',
    );
  });

  it('batas per email dan per IP untuk daftar, lupa, kirim ulang, token, masuk', async () => {
    for (let i = 0; i < 3; i++) await akun.lupaSandi(EMAIL, { ip: `10.0.0.${i}` });
    expect((await galat(akun.lupaSandi(EMAIL, { ip: '10.0.0.9' }))).kode).toBe('RATE_LIMITED');
    for (let i = 0; i < 3; i++) await akun.kirimUlangVerifikasi(`k${i}@example.com`, ctx);
    for (let i = 0; i < 17; i++) await akun.kirimUlangVerifikasi(`k${i + 3}@example.com`, ctx);
    const e = await galat(akun.kirimUlangVerifikasi('lain@example.com', ctx)); // per IP (20/jam)
    expect(e.kode).toBe('RATE_LIMITED');
    expect(e.retryAfterSec).toBeGreaterThan(0);
    for (let i = 0; i < 30; i++) await galat(() => akun.verifikasiEmail('A'.repeat(43), { ip: '9.9.9.9' }));
    expect((await galat(() => akun.verifikasiEmail('A'.repeat(43), { ip: '9.9.9.9' }))).kode).toBe(
      'RATE_LIMITED',
    );
    for (let i = 0; i < 3; i++)
      await akun.daftar({ email: 'd@example.com', sandi: SANDI }, { ip: `10.1.0.${i}` });
    expect((await galat(akun.daftar({ email: 'd@example.com', sandi: SANDI }, ctx))).kode).toBe(
      'RATE_LIMITED',
    );
    t += 3_600_001;
    await expect(akun.daftar({ email: 'd@example.com', sandi: SANDI }, ctx)).resolves.toBeUndefined();
  });
});

describe('ubah sandi dan hapus akun', () => {
  it('ubah sandi: wajib sandi lama, rotasi sesi ini, sesi lain dihapus', async () => {
    await daftarTerverifikasi();
    const a = (await akun.masuk({ email: EMAIL, sandi: SANDI }, ctx)).token;
    const b = (await akun.masuk({ email: EMAIL, sandi: SANDI }, ctx)).token;
    const id = akun.sesi(a)!.akun.id;
    expect((await galat(akun.ubahSandi(id, { sandiBaru: SANDI2 }, ctx))).kode).toBe('SANDI_LAMA_SALAH');
    expect((await galat(akun.ubahSandi(id, { sandiLama: SANDI2, sandiBaru: SANDI2 }, ctx))).kode).toBe(
      'SANDI_LAMA_SALAH',
    );
    expect((await galat(akun.ubahSandi(id, { sandiLama: SANDI, sandiBaru: 'pendek' }, ctx))).kode).toBe(
      'SANDI_TERLALU_PENDEK',
    );
    const baru = await akun.ubahSandi(id, { sandiLama: SANDI, sandiBaru: SANDI2 }, ctx);
    expect(akun.sesi(a)).toBeNull();
    expect(akun.sesi(b)).toBeNull();
    expect(akun.sesi(baru)?.akun.id).toBe(id);
    await expect(akun.masuk({ email: EMAIL, sandi: SANDI2 }, ctx)).resolves.toBeDefined();
    expect((await galat(akun.ubahSandi('akun_tidak_ada', { sandiBaru: SANDI2 }, ctx))).kode).toBe(
      'BELUM_MASUK',
    );
  });

  it('hapus akun menghapus semua data: urusan, vault (crypto-shred), sesi, token, identitas', async () => {
    let dihapus: string[] = [];
    akun = buat({
      hapusUrusan: (id) => {
        dihapus.push(id);
        db.prepare('DELETE FROM urusan WHERE id = ?').run(id);
      },
    });
    await daftarTerverifikasi();
    const { token, akun: a } = await akun.masuk({ email: EMAIL, sandi: SANDI }, ctx);
    db.prepare(
      "INSERT INTO urusan (id, state, created_at, updated_at) VALUES ('u_1','BARU','x','x'), ('u_2','BARU','x','x')",
    ).run();
    akun.catatPemilikUrusan('u_1', { userId: a.id });
    akun.catatPemilikUrusan('u_2', { guestSid: 'tamu-lain' });
    akun.vault.setDataDiri(a.id, { namaLengkap: 'Warga' });
    akun.vault.putDocument(a.id, { jenis: 'ktp', judul: 'KTP', mime: 'image/png', bytes: Buffer.from('x') });
    await akun.lupaSandi(EMAIL, ctx);

    expect((await galat(akun.hapusAkun(a.id, { konfirmasi: 'hapus', sandi: SANDI }))).kode).toBe(
      'KONFIRMASI_SALAH',
    );
    expect((await galat(akun.hapusAkun(a.id, { konfirmasi: 'HAPUS', sandi: SANDI2 }))).kode).toBe(
      'SANDI_LAMA_SALAH',
    );
    await akun.hapusAkun(a.id, { konfirmasi: 'HAPUS', sandi: SANDI });
    expect(dihapus).toEqual(['u_1']);
    expect(akun.sesi(token)).toBeNull();
    for (const tabel of [
      'users',
      'auth_sessions',
      'email_tokens',
      'user_keys',
      'vault_data_diri',
      'vault_documents',
    ]) {
      expect(db.prepare(`SELECT COUNT(*) n FROM ${tabel}`).get()).toEqual({ n: 0 });
    }
    expect(db.prepare('SELECT urusan_id FROM urusan_owner').all()).toEqual([{ urusan_id: 'u_2' }]);
    expect((await galat(akun.hapusAkun(a.id, { konfirmasi: 'HAPUS' }))).kode).toBe('BELUM_MASUK');
    // email bisa dipakai mendaftar lagi
    dihapus = [];
    await akun.daftar({ email: EMAIL, sandi: SANDI }, { ip: '10.9.9.9' });
    expect(mailer.last(EMAIL)!.jenis).toBe('verifikasi');
  });
});

describe('kepemilikan urusan dan migrasi tamu', () => {
  it('urusan tamu pindah ke akun saat masuk; urusan tamu lain tidak ikut', async () => {
    await daftarTerverifikasi();
    const { akun: a } = await akun.masuk({ email: EMAIL, sandi: SANDI }, ctx);
    db.prepare(
      "INSERT INTO urusan (id, state, created_at, updated_at) VALUES ('u_a','BARU','x','x'), ('u_b','BARU','x','x'), ('u_c','BARU','x','x')",
    ).run();
    akun.catatPemilikUrusan('u_a', { guestSid: 'sid-saya' });
    akun.catatPemilikUrusan('u_b', { guestSid: 'sid-saya' });
    akun.catatPemilikUrusan('u_c', { guestSid: 'sid-orang-lain' });
    akun.catatPemilikUrusan('u_c', {}); // tanpa pemilik: diabaikan
    expect(akun.migrasiTamu(a.id, undefined)).toBe(0);
    expect(akun.migrasiTamu(a.id, 'sid-saya')).toBe(2);
    expect(akun.migrasiTamu(a.id, 'sid-saya')).toBe(0);
    expect(akun.urusanMilik(a.id).sort()).toEqual(['u_a', 'u_b']);
  });
});

async function googleLogin(claims: Record<string, unknown>, opts: { next?: string; guest?: string } = {}) {
  const { url, state } = akun.googleMulai(opts.next);
  const { code } = google.consent(url, claims);
  return akun.googleSelesai({ code, state, cookieState: state }, ctx);
}

describe('Google OIDC', () => {
  it('URL otorisasi: code + PKCE S256 + state + nonce + scope openid email profile', () => {
    const { url, state } = akun.googleMulai('/lacak');
    const q = new URL(url).searchParams;
    expect(url.startsWith('https://accounts.google.com/o/oauth2/v2/auth?')).toBe(true);
    expect(q.get('response_type')).toBe('code');
    expect(q.get('scope')).toBe('openid email profile');
    expect(q.get('redirect_uri')).toBe(`${ORIGIN}/auth/google/callback`);
    expect(q.get('state')).toBe(state);
    expect(q.get('nonce')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(q.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(q.get('code_challenge_method')).toBe('S256');
    // verifier dan nonce hanya di server, state disimpan sebagai hash
    const row = db.prepare('SELECT * FROM oauth_states').get() as Record<string, string>;
    expect(row.state_hash).toBe(sha256Hex(state));
    expect(row.next).toBe('/lacak');
  });

  it('akun baru terverifikasi, nama prefill ke Data Diri terenkripsi, login berikutnya lewat sub yang sama', async () => {
    const r = await googleLogin(
      { sub: 'g-1', email: 'Baru@Example.com', email_verified: true, name: 'Warga Baru' },
      { next: '/lacak' },
    );
    expect(r.baru).toBe(true);
    expect(r.next).toBe('/lacak');
    expect(r.akun.email).toBe('baru@example.com');
    expect(r.akun.emailVerifiedAt).not.toBeNull();
    expect(r.akun.punyaSandi).toBe(false);
    expect(akun.terhubungGoogle(r.akun.id)).toBe(true);
    expect(akun.vault.getDataDiri(r.akun.id)?.data).toEqual({ namaLengkap: 'Warga Baru' });
    const lagi = await googleLogin({ sub: 'g-1', email: 'ganti@example.com', email_verified: false });
    expect([lagi.baru, lagi.akun.id]).toEqual([false, r.akun.id]);
  });

  it('menautkan ke akun email terverifikasi hanya bila Google email_verified', async () => {
    await daftarTerverifikasi();
    expect((await galat(googleLogin({ sub: 'g-2', email: EMAIL, email_verified: false }))).kode).toBe(
      'GOOGLE_EMAIL_BELUM_TERVERIFIKASI',
    );
    expect(db.prepare('SELECT COUNT(*) n FROM oauth_identities').get()).toEqual({ n: 0 });
    const r = await googleLogin({ sub: 'g-2', email: EMAIL, email_verified: true });
    expect(r.baru).toBe(false);
    expect(r.akun.punyaSandi).toBe(true); // akun terverifikasi: sandi tetap
    await expect(akun.masuk({ email: EMAIL, sandi: SANDI }, ctx)).resolves.toBeDefined();
  });

  it('akun belum terverifikasi yang ditautkan: sandi lama (mungkin milik penyerang) dibuang', async () => {
    await akun.daftar({ email: EMAIL, sandi: SANDI }, { ip: '198.51.100.7' });
    const link = mailer.last(EMAIL)!.link;
    const r = await googleLogin({ sub: 'g-3', email: EMAIL, email_verified: true });
    expect(r.akun.punyaSandi).toBe(false);
    expect(r.akun.emailVerifiedAt).not.toBeNull();
    expect((await galat(akun.masuk({ email: EMAIL, sandi: SANDI }, ctx))).kode).toBe('KREDENSIAL_SALAH');
    expect((await galat(() => akun.verifikasiEmail(tokenDari(link), ctx))).kode).toBe('TOKEN_TIDAK_VALID');
  });

  it('CSRF login: state query ≠ cookie, state dipakai ulang, state kedaluwarsa → ditolak', async () => {
    const { url, state } = akun.googleMulai();
    const { code } = google.consent(url, { sub: 'g-4', email: 'g4@example.com', email_verified: true });
    const lain = akun.googleMulai().state;
    expect((await galat(akun.googleSelesai({ code, state, cookieState: lain }, ctx))).kode).toBe(
      'GOOGLE_GAGAL',
    );
    expect((await galat(akun.googleSelesai({ code, state, cookieState: undefined }, ctx))).kode).toBe(
      'GOOGLE_GAGAL',
    );
    expect((await galat(akun.googleSelesai({ code: null, state, cookieState: state }, ctx))).kode).toBe(
      'GOOGLE_GAGAL',
    );
    await akun.googleSelesai({ code, state, cookieState: state }, ctx);
    expect((await galat(akun.googleSelesai({ code, state, cookieState: state }, ctx))).kode).toBe(
      'GOOGLE_GAGAL',
    );

    const b = akun.googleMulai();
    const c2 = google.consent(b.url, { sub: 'g-5', email: 'g5@example.com', email_verified: true });
    t += 11 * 60_000;
    expect(
      (await galat(akun.googleSelesai({ code: c2.code, state: b.state, cookieState: b.state }, ctx))).kode,
    ).toBe('GOOGLE_GAGAL');
  });

  it('ID token: tanda tangan palsu, aud/iss/nonce salah, kedaluwarsa, tanpa email → ditolak', async () => {
    const oidc = new GoogleOidc({
      clientId: google.clientId,
      clientSecret: google.clientSecret,
      redirectUri: `${ORIGIN}/auth/google/callback`,
      fetch: google.fetch,
    });
    const base = { sub: 's', email: 'a@example.com', email_verified: true, nonce: 'n-1' };
    await expect(oidc.verifyIdToken(await google.sign(base), 'n-1')).resolves.toMatchObject({
      sub: 's',
      emailVerified: true,
    });
    const lain = await FakeGoogle.create();
    const kasus: [string, Promise<string>, string][] = [
      ['kunci lain, kid sama', lain.sign(base, { kid: google.kid }), 'n-1'],
      ['aud salah', google.sign({ ...base, aud: 'klien-lain' }), 'n-1'],
      ['iss salah', google.sign({ ...base, iss: 'https://evil.example.com' }), 'n-1'],
      ['nonce salah', google.sign(base), 'n-2'],
      ['kedaluwarsa', google.sign({ ...base, exp: Math.floor(Date.now() / 1000) - 3600 }), 'n-1'],
      ['tanpa email', google.sign({ sub: 's', nonce: 'n-1' }), 'n-1'],
      ['tanpa nonce', google.sign({ sub: 's', email: 'a@example.com' }), 'n-1'],
      ['sub kosong', google.sign({ ...base, sub: '' }), 'n-1'],
    ];
    for (const [nama, tok, nonce] of kasus) {
      await expect(oidc.verifyIdToken(await tok, nonce), nama).rejects.toThrow(/login Google gagal/);
    }
    await expect(oidc.verifyIdToken('bukan.jwt.sama-sekali', 'n-1')).rejects.toThrow(/login Google gagal/);
  });

  it('rotasi kunci Google: kid baru memicu ambil ulang JWKS (dibatasi sekali per menit)', async () => {
    let now = 1_000_000;
    const oidc = new GoogleOidc({
      clientId: google.clientId,
      clientSecret: google.clientSecret,
      redirectUri: `${ORIGIN}/auth/google/callback`,
      fetch: google.fetch,
      now: () => now,
    });
    const claims = { sub: 's', email: 'a@example.com', nonce: 'n', iat: Math.floor(Date.now() / 1000) };
    await oidc.verifyIdToken(await google.sign(claims), 'n');
    await google.rotate();
    await expect(oidc.verifyIdToken(await google.sign(claims), 'n')).rejects.toThrow(); // < 1 menit: tidak ambil ulang
    now += 61_000;
    await expect(oidc.verifyIdToken(await google.sign(claims), 'n')).resolves.toBeDefined();
    now += 4_000_000; // cache JWKS kedaluwarsa (1 jam) → ambil ulang biasa
    await expect(oidc.verifyIdToken(await google.sign(claims), 'n')).resolves.toBeDefined();
  });

  it('gangguan Google (token 500, tanpa id_token, JWKS 500, jaringan putus) → GOOGLE_GAGAL', async () => {
    const pesan: string[] = [];
    akun = buat({ log: (l) => pesan.push(l) });
    for (const g of ['token-500', 'token-tanpa-id', 'jwks-500'] as const) {
      google.gangguan = g;
      // JWKS di-cache per instance: buat instance baru agar JWKS benar-benar diambil
      akun = buat({ log: (l) => pesan.push(l) });
      expect(
        (await galat(googleLogin({ sub: 'g-x', email: 'x@example.com', email_verified: true }))).kode,
      ).toBe('GOOGLE_GAGAL');
    }
    google.gangguan = null;
    const putus = new GoogleOidc({
      clientId: 'a',
      clientSecret: 'b',
      redirectUri: 'https://x.example.com/cb',
      fetch: () => Promise.reject(new Error('ECONNRESET')),
    });
    await expect(putus.exchangeCode('c', 'v')).rejects.toThrow(/tidak terjangkau/);
    await expect(putus.verifyIdToken('a.b.c', 'n')).rejects.toThrow(/login Google gagal/);
    const jwksRusak = new GoogleOidc({
      clientId: 'a',
      clientSecret: 'b',
      redirectUri: 'https://x.example.com/cb',
      fetch: async () => Response.json({ bukan: 'jwks' }),
    });
    await expect(jwksRusak.verifyIdToken(await google.sign({ sub: 's', nonce: 'n' }), 'n')).rejects.toThrow(
      /JWKS tidak valid/,
    );
    expect(pesan.length).toBeGreaterThanOrEqual(3);
    expect(pesan.join('\n')).not.toContain('x@example.com');
  });

  it('Google tidak dikonfigurasi → GOOGLE_TIDAK_AKTIF', async () => {
    akun = buat({ google: undefined });
    expect(akun.googleAktif).toBe(false);
    expect((await galat(() => akun.googleMulai())).kode).toBe('GOOGLE_TIDAK_AKTIF');
    expect((await galat(akun.googleSelesai({ code: 'c', state: 's', cookieState: 's' }, ctx))).kode).toBe(
      'GOOGLE_TIDAK_AKTIF',
    );
  });
});

describe('open redirect: amanNext', () => {
  it('hanya path relatif di origin sendiri', () => {
    expect(amanNext('/lacak?x=1#a')).toBe('/lacak?x=1#a');
    expect(amanNext('/urusan/u_1')).toBe('/urusan/u_1');
    for (const bad of [
      '//evil.example.com',
      '/\\evil.example.com',
      '\\\\evil.example.com',
      'https://evil.example.com',
      'javascript:alert(1)',
      '/%0d%0aSet-Cookie',
      '/\nx',
      '/\tx',
      '',
      undefined,
      null,
      'lacak',
      `/${'a'.repeat(600)}`,
    ]) {
      const r = amanNext(bad as string);
      expect(r, String(bad)).not.toMatch(/evil|javascript/);
      if (bad !== '/%0d%0aSet-Cookie') expect(r).toBe('/');
    }
    expect(amanNext('/%0d%0aSet-Cookie')).toBe('/%0d%0aSet-Cookie'); // tetap ter-encode: aman sebagai path
    expect(amanNext('https://evil.example.com', '/masuk')).toBe('/masuk');
  });
});

describe('pemeliharaan', () => {
  it('bersihkan: sesi/token/state kedaluwarsa dan akun tak terverifikasi > 7 hari', async () => {
    await daftarTerverifikasi();
    await akun.masuk({ email: EMAIL, sandi: SANDI }, ctx);
    await akun.daftar({ email: 'basi@example.com', sandi: SANDI }, ctx);
    akun.googleMulai();
    await akun.emailSelesai();
    t += 8 * 24 * 3600_000;
    const n = akun.bersihkan();
    expect(n).toBeGreaterThanOrEqual(4);
    expect(db.prepare('SELECT email FROM users').all()).toEqual([{ email: EMAIL }]);
    expect(db.prepare('SELECT COUNT(*) n FROM auth_sessions').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) n FROM oauth_states').get()).toEqual({ n: 0 });
  });

  it('kegagalan mailer tidak menggagalkan permintaan dan tidak mencatat alamat lengkap', async () => {
    const log: string[] = [];
    akun = buat({
      mailer: { kind: 'memory', send: () => Promise.reject(new Error('HTTP 500')) },
      log: (l) => log.push(l),
    });
    await expect(akun.daftar({ email: EMAIL, sandi: SANDI }, ctx)).resolves.toBeUndefined();
    await akun.emailSelesai();
    expect(log).toEqual(['[akun] email verifikasi ke w***@example.com gagal: HTTP 500']);
  });
});
