import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openHarnessDb, type Db } from '@urusin/harness';
import { beforeEach, describe, expect, it } from 'vitest';
import { AkunError } from './errors.js';
import { GoogleOidc } from './google.js';
import { deriveKek } from './keys.js';
import { DevMailer, MailerError, MemoryMailer } from './mailer.js';
import {
  AkunService,
  amanNext,
  DEFAULT_KUOTA,
  hashDaftarWrite,
  hashSid,
  kunciIp,
  LOCKOUT,
  ringkasUserAgent,
  type AkunDeps,
} from './service.js';
import { FakeGoogle, testLimiter } from './testing.js';
import { sha256Hex } from './token.js';
import { Vault } from './vault.js';

const ORIGIN = 'https://urusin.example.com';
const EMAIL = 'warga@example.com';
const SANDI = 'kuda-lari-cepat-9';
const SANDI2 = 'gajah-terbang-tinggi-7';
const EMAIL_LAIN = 'warga-google@example.com';
const ctx = { ip: '203.0.113.5', userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile' };
const JAM = 3_600_000;

let t: number;
let db: Db;
let mailer: MemoryMailer;
let akun: AkunService;
let google: FakeGoogle;
let vaultDir: string;

function buat(over: Partial<AkunDeps> = {}) {
  vaultDir = mkdtempSync(join(tmpdir(), 'akun-'));
  return new AkunService({
    db,
    mailer,
    vault: new Vault(db, deriveKek(Buffer.alloc(32, 3).toString('base64')), vaultDir, {
      now: () => new Date(t),
      diskPersen: () => 10,
    }),
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
const hitung = (sql: string, ...a: unknown[]) => (db.prepare(sql).get(...a) as { n: number }).n;

/** Daftar = akun penuh + sesi langsung (ADR 0032), tanpa email verifikasi. */
function daftarAkun(email = EMAIL, sandi = SANDI) {
  return akun.daftar({ email, sandi }, ctx);
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

function urusan(...ids: string[]) {
  for (const id of ids)
    db.prepare("INSERT INTO urusan (id, state, created_at, updated_at) VALUES (?,'BARU','x','x')").run(id);
}

describe('daftar → masuk (tanpa verifikasi email, ADR 0032)', () => {
  it('daftar langsung memberi akun penuh + sesi sah; tanpa email; email_verified_at terisi', async () => {
    const d = await akun.daftar({ email: ' Warga@Example.com ', sandi: SANDI }, ctx);
    expect(d.akun).toMatchObject({ jenis: 'akun', email: EMAIL, punyaSandi: true });
    expect(d.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(akun.sesi(d.token)?.akun.id).toBe(d.akun.id);
    expect(akun.sinkron(d.akun)).toBe(true);
    await akun.emailSelesai();
    expect(mailer.sent).toEqual([]);
    const row = db.prepare('SELECT email_verified_at, created_at FROM users WHERE id = ?').get(d.akun.id) as {
      email_verified_at: string | null;
      created_at: string;
    };
    expect(row.email_verified_at).not.toBeNull();
    expect(row.email_verified_at).toBe(row.created_at);
    expect(hitung('SELECT COUNT(*) n FROM email_tokens')).toBe(0);
    expect(db.prepare('SELECT token_hash, user_agent FROM auth_sessions').all()).toEqual([
      { token_hash: sha256Hex(d.token), user_agent: 'Chrome di Android' },
    ]);

    expect((await galat(akun.masuk({ email: EMAIL, sandi: SANDI2 }, ctx))).kode).toBe('KREDENSIAL_SALAH');
    const { token, akun: masuk } = await akun.masuk({ email: 'WARGA@example.com', sandi: SANDI }, ctx);
    expect(masuk.email).toBe(EMAIL);
    expect(akun.sinkron(masuk)).toBe(true);
    expect(token).not.toBe(d.token);
    expect(akun.sesi(token)!.akun.id).toBe(d.akun.id);
    expect(akun.sesi(d.token)).not.toBeNull(); // masuk lagi tidak mencabut sesi dari daftar
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
});

describe('email ganda: hanya daftar yang menyatakan "sudah terdaftar" (ADR 0032)', () => {
  it('daftar dua kali (beda huruf besar/spasi) → EMAIL_SUDAH_TERDAFTAR; sandi asli tetap, sandi kedua tidak berlaku', async () => {
    const asli = await daftarAkun();
    for (const email of [EMAIL, ' WARGA@example.COM ']) {
      const e = await galat(akun.daftar({ email, sandi: SANDI2 }, { ip: '198.51.100.1' }));
      expect([e.kode, e.status, e.pesanWarga]).toEqual([
        'EMAIL_SUDAH_TERDAFTAR',
        409,
        'Email ini sudah terdaftar. Silakan masuk.',
      ]);
    }
    expect(hitung('SELECT COUNT(*) n FROM users')).toBe(1);
    expect(akun.sesi(asli.token)).not.toBeNull(); // sesi pemilik tidak tersentuh
    const { akun: masuk } = await akun.masuk({ email: EMAIL, sandi: SANDI }, ctx);
    expect(masuk.id).toBe(asli.akun.id);
    expect((await galat(akun.masuk({ email: EMAIL, sandi: SANDI2 }, ctx))).kode).toBe('KREDENSIAL_SALAH');
    await akun.emailSelesai();
    expect(mailer.sent).toEqual([]);
  });

  it('daftar paralel dengan email yang sama: satu akun, sisanya EMAIL_SUDAH_TERDAFTAR', async () => {
    const hasil = await Promise.allSettled(
      [SANDI, SANDI2].map((sandi, i) => akun.daftar({ email: EMAIL, sandi }, { ip: `10.4.0.${i}` })),
    );
    expect(hasil.filter((h) => h.status === 'fulfilled')).toHaveLength(1);
    const ditolak = hasil.filter((h): h is PromiseRejectedResult => h.status === 'rejected');
    expect(ditolak.map((h) => (h.reason as AkunError).kode)).toEqual(['EMAIL_SUDAH_TERDAFTAR']);
    expect(hitung('SELECT COUNT(*) n FROM users')).toBe(1);
  });

  it('daftar dengan email akun Google-saja → EMAIL_SUDAH_TERDAFTAR; akun itu tetap tanpa sandi', async () => {
    const g = await googleLogin({ sub: 'g-only', email: EMAIL, email_verified: true });
    if (g.jenis !== 'masuk') throw new Error('harus masuk');
    expect((await galat(akun.daftar({ email: EMAIL, sandi: SANDI }, ctx))).kode).toBe(
      'EMAIL_SUDAH_TERDAFTAR',
    );
    expect(akun.akun(g.akun.id)?.punyaSandi).toBe(false);
    expect(
      (db.prepare('SELECT password_hash FROM users WHERE id = ?').get(g.akun.id) as { password_hash: null })
        .password_hash,
    ).toBeNull();
    expect((await galat(akun.masuk({ email: EMAIL, sandi: SANDI }, ctx))).kode).toBe('KREDENSIAL_SALAH');
    expect(akun.terhubungGoogle(g.akun.id)).toBe(true);
  });
});

describe('#48b Google ber-email sama dengan akun yang ada: tautkan dengan bukti sandi, tidak ada ambil alih', () => {
  it('Google ber-email sama → perlu-tautkan (tanpa sesi, tanpa identitas, sandi + sesi lama utuh); tertaut setelah masuk', async () => {
    const d = await daftarAkun();
    const sesiLain = (await akun.masuk({ email: EMAIL, sandi: SANDI }, ctx)).token;
    expect((await galat(googleLogin({ sub: 'g-2', email: EMAIL, email_verified: false }))).kode).toBe(
      'GOOGLE_EMAIL_BELUM_TERVERIFIKASI',
    );
    const r = await googleLogin({ sub: 'g-2', email: EMAIL, email_verified: true }, { next: '/lacak' });
    expect(r).toMatchObject({ jenis: 'perlu-tautkan', next: '/lacak' });
    if (r.jenis !== 'perlu-tautkan') throw new Error('harus perlu-tautkan');
    expect(hitung('SELECT COUNT(*) n FROM oauth_identities')).toBe(0);
    expect(hitung('SELECT COUNT(*) n FROM auth_sessions')).toBe(2); // tidak ada sesi baru, yang lama utuh
    expect(akun.sesi(d.token)?.akun.id).toBe(d.akun.id);
    expect(akun.sesi(sesiLain)?.akun.id).toBe(d.akun.id);
    expect(akun.akun(d.akun.id)?.punyaSandi).toBe(true);
    expect(akun.terhubungGoogle(d.akun.id)).toBe(false);
    // tiket tidak berlaku untuk akun lain
    const lain = (await daftarAkun('lain@example.com')).akun;
    expect(akun.tautkanGoogle(r.tiket, lain.id)).toBe(false);
    expect(akun.terhubungGoogle(lain.id)).toBe(false);
    // tiket sekali pakai: setelah percobaan salah di atas sudah hangus → minta lagi
    const r2 = await googleLogin({ sub: 'g-2', email: EMAIL, email_verified: true });
    if (r2.jenis !== 'perlu-tautkan') throw new Error('harus perlu-tautkan');
    const { akun: pemilik } = await akun.masuk({ email: EMAIL, sandi: SANDI }, ctx);
    expect(akun.tautkanGoogle(r2.tiket, pemilik.id)).toBe(true);
    expect(akun.tautkanGoogle(r2.tiket, pemilik.id)).toBe(false);
    const lagi = await googleLogin({ sub: 'g-2', email: EMAIL, email_verified: true });
    expect(lagi).toMatchObject({ jenis: 'masuk', akun: { id: pemilik.id, punyaSandi: true } });
    expect(akun.tautkanGoogle(undefined, pemilik.id)).toBe(false);
    // sandi tetap berlaku setelah ditautkan
    await expect(akun.masuk({ email: EMAIL, sandi: SANDI }, ctx)).resolves.toBeDefined();
  });

  it('akun sandi yang sudah punya identitas Google lain: Google ber-email sama tetap perlu-tautkan, identitas lama tetap', async () => {
    const d = await daftarAkun('b@example.com');
    db.prepare(
      "INSERT INTO oauth_identities (provider, sub, user_id, created_at, asal) VALUES ('google', 'g-b-lama', ?, 'x', 'tautan')",
    ).run(d.akun.id);
    const r = await googleLogin({ sub: 'g-b-asli', email: 'b@example.com', email_verified: true });
    expect(r.jenis).toBe('perlu-tautkan');
    expect(db.prepare('SELECT sub FROM oauth_identities WHERE user_id = ?').all(d.akun.id)).toEqual([
      { sub: 'g-b-lama' },
    ]);
    expect(akun.sesi(d.token)).not.toBeNull();
  });

  it('tiket tautan kedaluwarsa 10 menit', async () => {
    await daftarAkun();
    const r = await googleLogin({ sub: 'g-9', email: EMAIL, email_verified: true });
    if (r.jenis !== 'perlu-tautkan') throw new Error('harus perlu-tautkan');
    const { akun: a } = await akun.masuk({ email: EMAIL, sandi: SANDI }, ctx);
    t += 11 * 60_000;
    expect(akun.tautkanGoogle(r.tiket, a.id)).toBe(false);
  });
});

describe('baris akun lama (email_verified_at NULL, sebelum migrasi 0006)', () => {
  it('diperlakukan sebagai akun penuh: sinkron, pemilik vault/ingatan urusan; penyapu tidak menghapusnya', async () => {
    db.prepare(
      "INSERT INTO users (id, jenis, email, email_verified_at, password_hash, created_at) VALUES ('akun_lama', 'akun', 'lama@example.com', NULL, NULL, ?)",
    ).run(new Date(t).toISOString());
    const lama = akun.akun('akun_lama')!;
    expect(lama).toMatchObject({ jenis: 'akun', email: 'lama@example.com' });
    expect(akun.sinkron(lama)).toBe(true);
    urusan('u_lama');
    akun.catatPemilikUrusan('u_lama', { akun: lama, sid: 'sid-lama' });
    expect(akun.pemilikVaultUrusan('u_lama', { akun: lama, sid: 'sid-lama' })).toBe('akun_lama');
    expect(akun.pemilikIngatanUrusan('u_lama')).toBe('akun_lama');
    expect(akun.tamuDariSid('sid-lama')).toBeUndefined(); // bukan vault tamu satu perangkat
    t += 30 * 24 * JAM;
    expect(akun.bersihkan()).toMatchObject({ tamu: 0, demo: 0 });
    expect(hitung("SELECT COUNT(*) n FROM users WHERE id = 'akun_lama'")).toBe(1);
    expect(akun.urusanMilik('akun_lama')).toEqual(['u_lama']);
  });
});

describe('anti-enumerasi', () => {
  it('masuk: email tak dikenal, akun Google-saja, dan sandi salah → galat identik', async () => {
    await daftarAkun();
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

  it('lupa sandi: hasil sama untuk email ada/tidak ada; hanya yang ada yang menerima email', async () => {
    await daftarAkun();
    const n = mailer.sent.length;
    expect(await akun.lupaSandi('tidakada@example.com', ctx)).toEqual({ tertunda: false });
    await akun.emailSelesai();
    expect(mailer.sent.length).toBe(n);
    expect(await akun.lupaSandi(EMAIL, ctx)).toEqual({ tertunda: false });
    await akun.emailSelesai();
    expect(mailer.sent.length).toBe(n + 1);
  });
});

describe('lupa sandi → atur ulang', () => {
  it('reset 30 menit, sekali pakai, menghapus semua sesi, sandi lama tidak berlaku', async () => {
    await daftarAkun();
    const s1 = (await akun.masuk({ email: EMAIL, sandi: SANDI }, ctx)).token;
    const s2 = (await akun.masuk({ email: EMAIL, sandi: SANDI }, ctx)).token;
    await akun.lupaSandi(EMAIL, ctx);
    await akun.emailSelesai();
    const link = mailer.last(EMAIL, 'atur-ulang')!.link;
    expect(link).toContain('/atur-ulang-sandi?token=');
    const token = tokenDari(link);
    expect(akun.tokenBerlaku(token, 'reset')).toBe(true);
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
    await daftarAkun();
    await akun.lupaSandi(EMAIL, ctx);
    await akun.emailSelesai();
    const pertama = tokenDari(mailer.last(EMAIL, 'atur-ulang')!.link);
    await akun.lupaSandi(EMAIL, ctx);
    await akun.emailSelesai();
    const kedua = tokenDari(mailer.last(EMAIL, 'atur-ulang')!.link);
    expect((await galat(akun.aturUlangSandi(pertama, SANDI2, ctx))).kode).toBe('TOKEN_TIDAK_VALID');
    t += 30 * 60_000 + 1;
    expect(akun.tokenBerlaku(kedua, 'reset')).toBe(false);
    expect((await galat(akun.aturUlangSandi(kedua, SANDI2, ctx))).kode).toBe('TOKEN_TIDAK_VALID');
  });

  it('email ditahan (produksi tanpa Resend): lupa sandi ATUR_ULANG_NONAKTIF, aturUlangTersedia false', async () => {
    expect(akun.aturUlangTersedia).toBe(true);
    const log: string[] = [];
    akun = buat({ mailer: new DevMailer((l) => log.push(l), undefined, true) });
    expect(akun.aturUlangTersedia).toBe(false);
    await daftarAkun(); // daftar tetap jalan tanpa email
    for (const email of [EMAIL, 'tidakada@example.com', 'bukan-email']) {
      const e = await galat(akun.lupaSandi(email, ctx));
      expect([e.kode, e.status]).toEqual(['ATUR_ULANG_NONAKTIF', 503]);
    }
    expect(hitung('SELECT COUNT(*) n FROM email_tokens')).toBe(0);
    expect(log).toEqual([]);
  });
});

describe('sesi', () => {
  it('kedaluwarsa idle dan absolut; aktivitas memperpanjang idle', async () => {
    akun = buat({ ttl: { sesiIdleSec: 3600, sesiAbsolutSec: 3 * 3600 } });
    const { token } = await daftarAkun();
    t += 50 * 60_000;
    expect(akun.sesi(token)).not.toBeNull();
    t += 50 * 60_000;
    expect(akun.sesi(token)).not.toBeNull();
    t += 50 * 60_000;
    expect(akun.sesi(token)).not.toBeNull();
    t += 40 * 60_000;
    expect(akun.sesi(token)).toBeNull();

    const b = (await akun.masuk({ email: EMAIL, sandi: SANDI }, ctx)).token;
    t += 61 * 60_000;
    expect(akun.sesi(b)).toBeNull();
    expect(hitung('SELECT COUNT(*) n FROM auth_sessions')).toBe(0);
  });

  it('login selalu menerbitkan token baru (rotasi); token buatan klien tidak pernah diterima (fiksasi)', async () => {
    await daftarAkun();
    const a = (await akun.masuk({ email: EMAIL, sandi: SANDI }, ctx)).token;
    const b = (await akun.masuk({ email: EMAIL, sandi: SANDI }, ctx)).token;
    expect(a).not.toBe(b);
    expect(akun.sesi('A'.repeat(43))).toBeNull();
    expect(akun.sesi(undefined)).toBeNull();
    expect(akun.sesi('pendek')).toBeNull();
  });

  it('keluar, keluar dari semua perangkat, daftar perangkat', async () => {
    const a = (await daftarAkun()).token;
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

  it('unduh berkas: sesi yang belum pernah mengunduh butuh bukti kredensial ≤ 15 menit', async () => {
    const { token } = await daftarAkun(); // sesi dari daftar = bukti kredensial baru
    expect(() => akun.izinkanUnduh(akun.sesi(token)!)).not.toThrow(); // baru login
    t += 60 * 60_000;
    expect(() => akun.izinkanUnduh(akun.sesi(token)!)).not.toThrow(); // sesi ini sudah pernah mengunduh

    const lain = (await akun.masuk({ email: EMAIL, sandi: SANDI }, ctx)).token;
    t += 16 * 60_000;
    const s = akun.sesi(lain)!;
    expect((await galat(() => akun.izinkanUnduh(s))).kode).toBe('PERLU_MASUK_ULANG');
    expect((await galat(akun.konfirmasiSandi(s.akun.id, s.tokenHash, SANDI2))).kode).toBe('KREDENSIAL_SALAH');
    await akun.konfirmasiSandi(s.akun.id, s.tokenHash, SANDI);
    expect(() => akun.izinkanUnduh(akun.sesi(lain)!)).not.toThrow();
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

describe('#45 pembatas laju, Turnstile, dan penguncian', () => {
  it('Turnstile wajib setelah 3 gagal, kunci 15 menit setelah 5 gagal; sama untuk email tak terdaftar', async () => {
    akun = buat({
      limits: { masuk: { ip: { limit: 1000, windowMs: 60_000 }, email: { limit: 1000, windowMs: 60_000 } } },
    });
    await daftarAkun();
    for (let i = 0; i < LOCKOUT.turnstileSetelah; i++)
      expect((await galat(akun.masuk({ email: EMAIL, sandi: SANDI2 }, ctx))).kode).toBe('KREDENSIAL_SALAH');
    expect(akun.perluTurnstile(EMAIL)).toBe(true);
    expect((await galat(akun.masuk({ email: EMAIL, sandi: SANDI }, ctx))).kode).toBe('TURNSTILE_WAJIB');
    const tk = { ...ctx, turnstileOk: true };
    for (let i = LOCKOUT.turnstileSetelah; i < LOCKOUT.kunciSetelah; i++)
      expect((await galat(akun.masuk({ email: EMAIL, sandi: SANDI2 }, tk))).kode).toBe('KREDENSIAL_SALAH');
    const kunci = await galat(akun.masuk({ email: EMAIL, sandi: SANDI }, tk)); // sandi benar pun ditolak
    expect([kunci.kode, kunci.status, kunci.retryAfterSec]).toEqual(['TERKUNCI', 429, 30]);
    t += 29_000;
    expect((await galat(akun.masuk({ email: EMAIL, sandi: SANDI }, tk))).kode).toBe('TERKUNCI');
    t += 2_000;
    expect(akun.perluTurnstile(EMAIL)).toBe(true); // kunci habis, hitungan masih berjalan
    await expect(akun.masuk({ email: EMAIL, sandi: SANDI }, tk)).resolves.toBeDefined();
    expect(hitung('SELECT COUNT(*) n FROM auth_lockout')).toBe(0);

    for (let i = 0; i < LOCKOUT.kunciSetelah; i++)
      await galat(akun.masuk({ email: 'hantu@example.com', sandi: SANDI }, tk));
    const h = await galat(akun.masuk({ email: 'hantu@example.com', sandi: SANDI }, tk));
    expect(h.kode).toBe('TERKUNCI');
    expect(akun.perluTurnstile('bukan email')).toBe(false);
  });

  it('PoC balapan penguncian: percobaan paralel dihitung SEBELUM verifikasi sandi', async () => {
    akun = buat({
      limits: { masuk: { ip: { limit: 1000, windowMs: 60_000 }, email: { limit: 1000, windowMs: 60_000 } } },
    });
    await daftarAkun();
    const tk = { ...ctx, turnstileOk: true };
    const hasil = await Promise.all(
      Array.from({ length: 12 }, () => galat(akun.masuk({ email: EMAIL, sandi: SANDI2 }, tk))),
    );
    const kode = hasil.map((e) => e.kode).sort();
    expect(kode.filter((k) => k === 'KREDENSIAL_SALAH')).toHaveLength(LOCKOUT.kunciSetelah);
    expect(kode.filter((k) => k === 'TERKUNCI')).toHaveLength(12 - LOCKOUT.kunciSetelah);
  });

  it('backoff penguncian: 30 detik, berlipat tiap kegagalan berikutnya, paling lama 1 jam', async () => {
    akun = buat({
      limits: { masuk: { ip: { limit: 1000, windowMs: 60_000 }, email: { limit: 1000, windowMs: 60_000 } } },
    });
    await daftarAkun();
    const tk = { ...ctx, turnstileOk: true };
    for (let i = 0; i < LOCKOUT.kunciSetelah; i++)
      await galat(akun.masuk({ email: EMAIL, sandi: SANDI2 }, tk));
    const urutan: number[] = [];
    for (let i = 0; i < 9; i++) {
      const e = await galat(akun.masuk({ email: EMAIL, sandi: SANDI }, tk));
      expect(e.kode).toBe('TERKUNCI');
      urutan.push(e.retryAfterSec!);
      t += e.retryAfterSec! * 1000 + 1;
      await galat(akun.masuk({ email: EMAIL, sandi: SANDI2 }, tk)); // gagal lagi tepat setelah kunci habis
    }
    expect(urutan).toEqual([30, 60, 120, 240, 480, 960, 1920, 3600, 3600]);
    // 15 menit setelah kunci terakhir habis tanpa percobaan: hitungan mulai dari nol
    t += 3600_000 + 15 * 60_000 + 1;
    await expect(akun.masuk({ email: EMAIL, sandi: SANDI }, ctx)).resolves.toBeDefined();
  });

  it('jendela 15 menit: kegagalan lama tidak dihitung', async () => {
    await daftarAkun();
    for (let i = 0; i < 2; i++) await galat(akun.masuk({ email: EMAIL, sandi: SANDI2 }, ctx));
    t += 16 * 60_000;
    for (let i = 0; i < 2; i++) await galat(akun.masuk({ email: EMAIL, sandi: SANDI2 }, ctx));
    expect(akun.perluTurnstile(EMAIL)).toBe(false);
  });

  it('batas per email dan per IP untuk daftar, lupa, token, masuk', async () => {
    for (let i = 0; i < 3; i++) await akun.lupaSandi(EMAIL, { ip: `10.0.0.${i}` });
    expect((await galat(akun.lupaSandi(EMAIL, { ip: '10.0.0.9' }))).kode).toBe('RATE_LIMITED');
    for (let i = 0; i < 20; i++) await akun.lupaSandi(`k${i}@example.com`, ctx);
    const e = await galat(akun.lupaSandi('lain@example.com', ctx)); // per IP (20/jam)
    expect(e.kode).toBe('RATE_LIMITED');
    expect(e.retryAfterSec).toBeGreaterThan(0);
    for (let i = 0; i < 30; i++) await galat(akun.aturUlangSandi('A'.repeat(43), SANDI2, { ip: '9.9.9.9' }));
    expect((await galat(akun.aturUlangSandi('A'.repeat(43), SANDI2, { ip: '9.9.9.9' }))).kode).toBe(
      'RATE_LIMITED',
    );
    // daftar per email: percobaan dengan email yang sudah terdaftar tetap dihitung
    await akun.daftar({ email: 'd@example.com', sandi: SANDI }, { ip: '10.1.0.0' });
    for (let i = 1; i < 3; i++)
      expect(
        (await galat(akun.daftar({ email: 'd@example.com', sandi: SANDI }, { ip: `10.1.0.${i}` }))).kode,
      ).toBe('EMAIL_SUDAH_TERDAFTAR');
    expect((await galat(akun.daftar({ email: 'd@example.com', sandi: SANDI }, ctx))).kode).toBe(
      'RATE_LIMITED',
    );
    t += JAM + 1;
    expect((await galat(akun.daftar({ email: 'd@example.com', sandi: SANDI }, ctx))).kode).toBe(
      'EMAIL_SUDAH_TERDAFTAR',
    );
  });
});

describe('ubah sandi dan hapus akun', () => {
  it('ubah sandi: wajib sandi lama, rotasi sesi ini, sesi lain dihapus', async () => {
    await daftarAkun();
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
    const demo = akun.buatDemo(ctx).akun;
    expect((await galat(akun.ubahSandi(demo.id, { sandiBaru: SANDI2 }, ctx))).kode).toBe('HANYA_AKUN');
  });

  it('#46 hapus akun menghapus semua data: urusan, vault (crypto-shred), berkas, sesi, token, identitas', async () => {
    let dihapus: string[] = [];
    akun = buat({
      hapusUrusan: (id) => {
        dihapus.push(id);
        db.prepare('DELETE FROM urusan WHERE id = ?').run(id);
      },
    });
    await daftarAkun();
    const { token, akun: a } = await akun.masuk({ email: EMAIL, sandi: SANDI }, ctx);
    urusan('u_1', 'u_2');
    akun.catatPemilikUrusan('u_1', { akun: a });
    akun.catatPemilikUrusan('u_2', { sid: 'tamu-lain' });
    akun.vault.setDataDiri(a.id, { namaLengkap: 'Warga' });
    akun.vault.putDocument(a.id, { jenis: 'ktp', judul: 'KTP', mime: 'image/png', bytes: Buffer.from('x') });
    expect(readdirSync(vaultDir)).toEqual([a.id]);
    await akun.lupaSandi(EMAIL, ctx);
    await akun.emailSelesai();

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
    ])
      expect(hitung(`SELECT COUNT(*) n FROM ${tabel}`)).toBe(0);
    expect(readdirSync(vaultDir)).toEqual([]);
    expect(db.prepare('SELECT urusan_id FROM urusan_owner').all()).toEqual([{ urusan_id: 'u_2' }]);
    expect((await galat(akun.hapusAkun(a.id, { konfirmasi: 'HAPUS' }))).kode).toBe('BELUM_MASUK');
    dihapus = [];
    // email bebas lagi: daftar ulang membuat akun baru (kosong)
    const ulang = await akun.daftar({ email: EMAIL, sandi: SANDI }, { ip: '10.9.9.9' });
    expect(ulang.akun.id).not.toBe(a.id);
    expect(akun.urusanMilik(ulang.akun.id)).toEqual([]);
  });
});

describe('#47 tamu malas, salinan demo, dan batas per IP', () => {
  it('tamu dibuat hanya saat diminta, terikat hash sid, umur MUTLAK 72 jam (aktivitas tidak memperpanjang)', () => {
    expect(akun.tamuDariSid('sid-1')).toBeUndefined();
    expect(akun.tamuDariSid(undefined)).toBeUndefined();
    expect(hitung('SELECT COUNT(*) n FROM users')).toBe(0);
    const id = akun.pastikanTamu('sid-1', ctx);
    expect(id).toMatch(/^tamu_[0-9a-f]{32}$/);
    expect(akun.pastikanTamu('sid-1', ctx)).toBe(id);
    expect(akun.tamuDariSid('sid-1')).toBe(id);
    const row = db.prepare('SELECT sid_hash, email, jenis FROM users').get();
    expect(row).toEqual({ sid_hash: hashSid('sid-1'), email: null, jenis: 'tamu' });
    expect(JSON.stringify(db.prepare('SELECT * FROM users').all())).not.toContain('sid-1');
    t += 70 * JAM;
    akun.pastikanTamu('sid-1', ctx); // aktivitas TIDAK memperpanjang (PoC DoS: tamu abadi)
    expect(akun.bersihkan().tamu).toBe(0);
    t += 2 * JAM + 1;
    expect(akun.tamuDariSid('sid-1')).toBeUndefined();
    expect(akun.bersihkan().tamu).toBe(1);
    expect(hitung('SELECT COUNT(*) n FROM users')).toBe(0);
  });

  it('tamu kedaluwarsa yang belum disapu diganti tamu baru (data lama hilang)', () => {
    const id = akun.pastikanTamu('sid-2', ctx);
    akun.vault.setDataDiri(id, { namaLengkap: 'Lama' });
    t += 73 * JAM;
    const baru = akun.pastikanTamu('sid-2', ctx);
    expect(baru).not.toBe(id);
    expect(akun.vault.getDataDiri(baru)).toBeNull();
  });

  it('PoC: kunci per IP memakai /64 untuk IPv6 (satu pelanggan tidak bisa berganti alamat)', async () => {
    expect(kunciIp('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64');
    expect(kunciIp('2001:DB8:1:2:ffff:ffff:ffff:ffff')).toBe('2001:db8:1:2::/64');
    expect(kunciIp('2001:db8::')).toBe('2001:db8:0:0::/64');
    expect(kunciIp('::ffff:203.0.113.5')).toBe('203.0.113.5');
    expect(kunciIp('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    expect(kunciIp('203.0.113.5')).toBe('203.0.113.5');
    expect(kunciIp('tak-dikenal')).toBe('tak-dikenal');
    expect(kunciIp('1::2::3')).toBe('1::2::3');
    expect(kunciIp('zz::1')).toBe('zz::1');
    expect(kunciIp('2001:db8::300.1.1.1')).toBe('2001:db8::300.1.1.1');
    akun = buat({ kuota: { tamuPerIpHari: 20, demoPerIpHari: 3 } });
    for (let i = 0; i < 20; i++)
      akun.pastikanTamu(`sid6-${i}`, { ip: `2001:db8:5:6::${(i + 1).toString(16)}` });
    expect((await galat(() => akun.pastikanTamu('sid6-x', { ip: '2001:db8:5:6:dead:beef::9' }))).kode).toBe(
      'TAMU_PENUH',
    );
    akun.pastikanTamu('sid6-y', { ip: '2001:db8:5:7::1' });
    for (let i = 0; i < 3; i++) akun.buatDemo({ ip: `2001:db8:9:9::${i + 1}` });
    expect((await galat(() => akun.buatDemo({ ip: '2001:db8:9:9::99' }))).kode).toBe('DEMO_BATAS_IP');
    // pembatas laju masuk: 20 per IP per 15 menit, kini per /64
    for (let i = 0; i < 20; i++)
      await galat(akun.masuk({ email: `x${i}@example.com`, sandi: SANDI }, { ip: `2001:db8:7:7::${i + 1}` }));
    expect(
      (await galat(akun.masuk({ email: 'y@example.com', sandi: SANDI }, { ip: '2001:db8:7:7::ff' }))).kode,
    ).toBe('RATE_LIMITED');
  });

  it('batas tamu baru per IP per 24 jam (di sini 20; bawaan 200, tahan NAT)', async () => {
    akun = buat({ kuota: { tamuPerIpHari: 20 } });
    for (let i = 0; i < 20; i++) akun.pastikanTamu(`sid-${i}`, ctx);
    expect((await galat(() => akun.pastikanTamu('sid-x', ctx))).kode).toBe('TAMU_PENUH');
    akun.pastikanTamu('sid-x', { ip: '198.51.100.20' });
    t += 24 * JAM + 1;
    akun.bersihkan();
    expect(() => akun.pastikanTamu('sid-y', ctx)).not.toThrow();
  });

  it('salinan demo: terisolasi, data sintetis, batas per IP (di sini 3), batas global, kedaluwarsa 24 jam', async () => {
    akun = buat({ kuota: { demoPerIpHari: 3, demoAktifMaks: 4 } });
    const a = akun.buatDemo(ctx);
    const b = akun.buatDemo(ctx);
    expect(a.akun.id).not.toBe(b.akun.id);
    expect(a.akun).toMatchObject({ jenis: 'demo', email: null, punyaSandi: false });
    expect(akun.sinkron(a.akun)).toBe(true);
    const dd = akun.vault.getDataDiri(a.akun.id)!.data;
    expect(dd.namaLengkap).toBe('Juri Contoh Urusin');
    expect(String(dd.nik)).toMatch(/^3312\d{12}$/);
    // HP = HP uji replika Telunjuk Sakti (apps/fixtures TEST_HP): isian AI diterima di halaman masuk replika.
    expect(dd.hp).toBe('08000000001');
    akun.vault.setDataDiri(a.akun.id, { ...dd, namaLengkap: 'Diubah juri A' });
    expect(akun.vault.getDataDiri(b.akun.id)!.data.namaLengkap).toBe('Juri Contoh Urusin');
    akun.buatDemo(ctx);
    expect((await galat(() => akun.buatDemo(ctx))).kode).toBe('DEMO_BATAS_IP');
    akun.buatDemo({ ip: '198.51.100.30' });
    expect((await galat(() => akun.buatDemo({ ip: '198.51.100.31' }))).kode).toBe('DEMO_PENUH');
    t += 24 * JAM + 1;
    expect(akun.sesi(a.token)).toBeNull();
    // review delta 53fff2d: salinan kedaluwarsa langsung membebaskan slot (juri tidak terkunci menunggu sapu)
    const baru = akun.buatDemo({ ip: '198.51.100.32' });
    expect(akun.bersihkan().demo).toBe(4); // penyapu menghapus dan menghitung keempat salinan kedaluwarsa
    expect(hitung('SELECT COUNT(*) n FROM user_keys')).toBe(1);
    expect(akun.sesi(baru.token)).not.toBeNull();
  });
});

describe('salinan demo murah: dokumen contoh dirujuk bersama, tidak disalin', () => {
  it('dokumen contoh terbaca dan bisa diunduh, tanpa berkas/baris vault per salinan; tidak bisa dihapus', () => {
    const ids = [0, 1, 2].map((i) => akun.buatDemo({ ip: `198.51.100.${50 + i}` }).akun.id);
    expect(hitung('SELECT COUNT(*) n FROM vault_documents')).toBe(0);
    expect(readdirSync(vaultDir)).toEqual([]); // tidak ada berkas per salinan
    const docs = akun.vault.listDocuments(ids[0]!);
    expect(docs.map((d) => d.jenis)).toEqual(['kk', 'ktp', 'surat']);
    expect(akun.vault.listDocuments(ids[1]!).map((d) => d.id)).toEqual(docs.map((d) => d.id));
    const kk = akun.vault.getDocument(ids[0]!, docs[0]!.id)!;
    expect(kk.meta.mime).toBe('image/png');
    expect(kk.bytes.subarray(1, 4).toString()).toBe('PNG');
    expect(akun.vault.deleteDocument(ids[0]!, docs[0]!.id)).toBe(false);
    expect(akun.vault.listDocuments(ids[0]!)).toHaveLength(3);
    // Unggahan juri sendiri tetap per salinan (dan tampil di depan contoh).
    akun.vault.putDocument(ids[0]!, {
      jenis: 'foto',
      judul: 'Foto',
      mime: 'image/png',
      bytes: Buffer.from('x'),
    });
    expect(akun.vault.listDocuments(ids[0]!).map((d) => d.jenis)).toEqual(['foto', 'kk', 'ktp', 'surat']);
    expect(akun.vault.listDocuments(ids[1]!)).toHaveLength(3);
    // Tamu dan akun tidak melihat dokumen contoh.
    const tamu = akun.pastikanTamu('sid-c', ctx);
    expect(akun.vault.listDocuments(tamu)).toEqual([]);
    expect(akun.vault.getDocument(tamu, docs[0]!.id)).toBeNull();
  });

  it('batas global bawaan jauh di atas per IP × 4 (tanpa Turnstile, 4 IP tidak bisa mengunci semua juri)', () => {
    expect(DEFAULT_KUOTA.demoAktifMaks).toBeGreaterThan(DEFAULT_KUOTA.demoPerIpHari * 4);
    akun = buat();
    for (let ip = 0; ip < 4; ip++)
      for (let i = 0; i < DEFAULT_KUOTA.demoPerIpHari; i++) akun.buatDemo({ ip: `198.51.100.${100 + ip}` });
    expect(() => akun.buatDemo({ ip: '198.51.100.200' })).not.toThrow();
  });
});

describe('#47 rotasi tamu → akun (§3.26.6)', () => {
  async function siapkanTamu(sid: string) {
    const tamu = akun.pastikanTamu(sid, ctx);
    akun.vault.setDataDiri(tamu, { namaLengkap: 'Dari Tamu', kecamatan: 'Wonogiri' });
    akun.vault.putDocument(tamu, {
      jenis: 'kk',
      judul: 'KK tamu',
      mime: 'application/pdf',
      bytes: Buffer.from('%PDF'),
    });
    urusan('u_t1', 'u_t2', 'u_lain');
    akun.catatPemilikUrusan('u_t1', { sid });
    akun.catatPemilikUrusan('u_t2', { sid });
    akun.catatPemilikUrusan('u_lain', { sid: 'sid-orang-lain' });
    return tamu;
  }

  it('akun: urusan + vault tamu pindah (enkripsi ulang), DEK tamu dihancurkan, pengikat Pendamping ikut', async () => {
    db.exec('CREATE TABLE pendamping_sesi (id TEXT PRIMARY KEY, owner_hash TEXT NOT NULL)');
    db.prepare("INSERT INTO pendamping_sesi VALUES ('p1', ?)").run(hashSid('sid-lama'));
    akun.daftarPengikatPemilik(({ hashLama, hashBaru }) => {
      db.prepare('UPDATE pendamping_sesi SET owner_hash = ? WHERE owner_hash = ?').run(hashBaru, hashLama);
    });
    await daftarAkun();
    const { akun: a } = await akun.masuk({ email: EMAIL, sandi: SANDI }, ctx);
    akun.vault.setDataDiri(a.id, { namaLengkap: 'Nama Akun' });
    const tamu = await siapkanTamu('sid-lama');
    // pemilik vault urusan (jalur isi Pendamping): hanya pemiliknya sendiri
    expect(akun.pemilikVaultUrusan('u_t1', { sid: 'sid-lama' })).toBe(tamu);
    expect(akun.pemilikVaultUrusan('u_t1', { sid: 'sid-orang-lain' })).toBeUndefined();
    expect(akun.pemilikVaultUrusan('u_t1', {})).toBeUndefined();
    expect(akun.pemilikVaultUrusan('u_tidak_ada', { sid: 'sid-lama' })).toBeUndefined();

    // pemilik urusan (semua rute urusan): sid yang sama saja; akun lain, sid lain, atau tanpa catatan → false
    expect(akun.adalahPemilikUrusan('u_t1', { sid: 'sid-lama' })).toBe(true);
    expect(akun.adalahPemilikUrusan('u_t1', { sid: 'sid-orang-lain' })).toBe(false);
    expect(akun.adalahPemilikUrusan('u_t1', { akun: a })).toBe(false);
    expect(akun.adalahPemilikUrusan('u_t1', {})).toBe(false);
    expect(akun.adalahPemilikUrusan('u_tidak_ada', { sid: 'sid-lama' })).toBe(false);

    const r = akun.rotasiPemilik({ sidLama: 'sid-lama', sidBaru: 'sid-baru', userId: a.id });
    expect(akun.adalahPemilikUrusan('u_t1', { akun: a })).toBe(true);
    expect(akun.adalahPemilikUrusan('u_t1', { sid: 'sid-lama' })).toBe(false);
    expect(akun.adalahPemilikUrusan('u_t1', { akun: a, sid: 'sid-baru' })).toBe(true);
    expect(akun.pemilikVaultUrusan('u_t1', { akun: a })).toBe(a.id);
    expect(akun.pemilikVaultUrusan('u_t1', { sid: 'sid-baru' })).toBeUndefined();
    expect(akun.pemilikVaultUrusan('u_t1', { sid: 'sid-lama' })).toBeUndefined();
    expect(r).toEqual({ urusanDipindahkan: 2, vaultDipindahkan: true });
    expect(akun.urusanMilik(a.id).sort()).toEqual(['u_t1', 'u_t2']);
    expect(akun.vault.getDataDiri(a.id)!.data).toEqual({ namaLengkap: 'Nama Akun', kecamatan: 'Wonogiri' });
    const docs = akun.vault.listDocuments(a.id);
    expect(docs.map((d) => d.judul)).toEqual(['KK tamu']);
    expect(akun.vault.getDocument(a.id, docs[0]!.id)!.bytes.toString()).toBe('%PDF');
    expect(hitung('SELECT COUNT(*) n FROM users WHERE id = ?', tamu)).toBe(0);
    expect(hitung('SELECT COUNT(*) n FROM user_keys WHERE user_id = ?', tamu)).toBe(0);
    expect(readdirSync(vaultDir)).toEqual([a.id]);
    expect(db.prepare('SELECT owner_hash FROM pendamping_sesi').get()).toEqual({
      owner_hash: hashSid('sid-baru'),
    });
    // sid lama tidak lagi memiliki apa pun
    expect(akun.tamuDariSid('sid-lama')).toBeUndefined();
    expect(
      akun.rotasiPemilik({ sidLama: 'sid-lama', sidBaru: 'sid-x', userId: a.id }).urusanDipindahkan,
    ).toBe(0);
  });

  it('pengikat yang gagal membatalkan seluruh rotasi (atomik); berkas baru dibuang', async () => {
    await daftarAkun();
    const { akun: a } = await akun.masuk({ email: EMAIL, sandi: SANDI }, ctx);
    const tamu = await siapkanTamu('sid-lama');
    akun.daftarPengikatPemilik(() => {
      throw new Error('pendamping gagal');
    });
    expect(() => akun.rotasiPemilik({ sidLama: 'sid-lama', sidBaru: 'sid-baru', userId: a.id })).toThrow(
      'pendamping gagal',
    );
    expect(akun.urusanMilik(a.id)).toEqual([]);
    expect(akun.tamuDariSid('sid-lama')).toBe(tamu);
    expect(akun.vault.listDocuments(tamu)).toHaveLength(1);
    expect(akun.vault.listDocuments(a.id)).toHaveLength(0);
    expect(readdirSync(join(vaultDir, a.id))).toEqual([]);
  });

  it('tanpa akun (userId null): tamu tetap tamu, data diikat ke sid baru', async () => {
    const tamu = await siapkanTamu('sid-lama');
    const r = akun.rotasiPemilik({ sidLama: 'sid-lama', sidBaru: 'sid-baru', userId: null });
    expect(r).toEqual({ urusanDipindahkan: 2, vaultDipindahkan: false });
    expect(akun.tamuDariSid('sid-baru')).toBe(tamu);
    expect(akun.tamuDariSid('sid-lama')).toBeUndefined();
    expect(akun.rotasiPemilik({ sidLama: undefined, sidBaru: 'x', userId: null }).urusanDipindahkan).toBe(0);
  });

  it('tamu tanpa isi vault: baris tamu dihapus, tidak ada berkas', async () => {
    await daftarAkun();
    const { akun: a } = await akun.masuk({ email: EMAIL, sandi: SANDI }, ctx);
    const tamu = akun.pastikanTamu('sid-kosong', ctx);
    expect(
      akun.rotasiPemilik({ sidLama: 'sid-kosong', sidBaru: 'sid-b', userId: a.id }).vaultDipindahkan,
    ).toBe(true);
    expect(hitung('SELECT COUNT(*) n FROM users WHERE id = ?', tamu)).toBe(0);
  });

  it('catat pemilik: akun yang baru daftar dicatat sebagai akunnya (bukan sid); tanpa pemilik diabaikan', async () => {
    const { akun: a } = await daftarAkun();
    urusan('u_x', 'u_y');
    akun.catatPemilikUrusan('u_x', { akun: a, sid: 'sid-z' });
    akun.catatPemilikUrusan('u_y', {});
    expect(db.prepare('SELECT urusan_id, user_id, guest_sid_hash FROM urusan_owner').all()).toEqual([
      { urusan_id: 'u_x', user_id: a.id, guest_sid_hash: null },
    ]);
  });

  it('akun yang baru daftar: buat urusan → keluar (sid diputar) → masuk lagi → urusan tetap terbuka; orang lain 404', async () => {
    const m1 = await daftarAkun();
    expect(akun.sinkron(m1.akun)).toBe(true);
    // Vault langsung milik akun (sinkron), bukan tamu terikat sid; urusan dicatat ke akunnya.
    urusan('u_a');
    akun.catatPemilikUrusan('u_a', { akun: m1.akun, sid: 'sid-1' });
    expect(akun.pemilikVaultUrusan('u_a', { akun: m1.akun, sid: 'sid-1' })).toBe(m1.akun.id);
    expect(akun.tamuDariSid('sid-1')).toBeUndefined();
    // Keluar: sesi dihapus, sid diputar (tanpa rotasi pemilik). Masuk lagi di sid baru.
    akun.keluar(m1.token);
    const m2 = await akun.masuk({ email: EMAIL, sandi: SANDI }, ctx);
    akun.rotasiPemilik({ sidLama: 'sid-2', sidBaru: 'sid-3', userId: m2.akun.id });
    expect(akun.pemilikVaultUrusan('u_a', { akun: m2.akun, sid: 'sid-3' })).toBe(m2.akun.id);
    expect(akun.adalahPemilikUrusan('u_a', { akun: m2.akun, sid: 'sid-3' })).toBe(true);
    expect(akun.urusanMilik(m2.akun.id)).toEqual(['u_a']);
    // Pemilik lain: akun lain, sid lama, sid lain, tanpa apa-apa → tetap bukan pemilik.
    await daftarAkun(EMAIL_LAIN, SANDI2);
    const lain = (await akun.masuk({ email: EMAIL_LAIN, sandi: SANDI2 }, ctx)).akun;
    expect(akun.adalahPemilikUrusan('u_a', { akun: lain, sid: 'sid-3' })).toBe(false);
    expect(akun.adalahPemilikUrusan('u_a', { sid: 'sid-1' })).toBe(false);
    expect(akun.adalahPemilikUrusan('u_a', { sid: 'sid-3' })).toBe(false);
    expect(akun.pemilikVaultUrusan('u_a', { akun: lain, sid: 'sid-1' })).toBeUndefined();
  });

  it('akunId tanpa userId (akun atau demo) memindahkan urusan tamu ke akunnya; vault tamu tetap terikat sid baru', async () => {
    const { akun: a } = await daftarAkun();
    const tamu = akun.pastikanTamu('sid-lama', ctx);
    urusan('u_t1');
    akun.catatPemilikUrusan('u_t1', { sid: 'sid-lama' });
    expect(
      akun.rotasiPemilik({ sidLama: 'sid-lama', sidBaru: 'sid-baru', userId: null, akunId: a.id }),
    ).toEqual({ urusanDipindahkan: 1, vaultDipindahkan: false });
    expect(akun.urusanMilik(a.id)).toEqual(['u_t1']);
    expect(akun.tamuDariSid('sid-baru')).toBe(tamu);
    // Juri: urusan tamu ikut salinan demonya, jadi Keluar (sid diputar) tidak membuatnya yatim di sid.
    const demo = akun.buatDemo({ ip: '198.51.100.40' }).akun;
    urusan('u_t2');
    akun.catatPemilikUrusan('u_t2', { sid: 'sid-baru' });
    akun.rotasiPemilik({ sidLama: 'sid-baru', sidBaru: 'sid-juri', userId: null, akunId: demo.id });
    expect(akun.adalahPemilikUrusan('u_t2', { akun: demo, sid: 'sid-lain' })).toBe(true);
    expect(akun.adalahPemilikUrusan('u_t2', { sid: 'sid-juri' })).toBe(false);
  });
});

describe('token persetujuan "Izinkan isi"', () => {
  it('sekali pakai, terikat pemilik + hash daftar write + origin, 5 menit', async () => {
    const h = hashDaftarWrite(['nik', 'namaLengkap', 'nik']);
    expect(h).toBe(hashDaftarWrite(['namaLengkap', 'nik']));
    const tamu = akun.pastikanTamu('sid-i', ctx);
    const lain = akun.pastikanTamu('sid-j', ctx);
    const origin = 'https://fixtures.urusinai.web.id';
    const tok = akun.terbitkanIzin(tamu, h, origin);
    expect(
      (await galat(() => akun.pakaiIzin(tok, { userId: lain, writeListHash: h, targetOrigin: origin }))).kode,
    ).toBe('IZIN_TIDAK_VALID');
    expect(
      (
        await galat(() =>
          akun.pakaiIzin(tok, {
            userId: tamu,
            writeListHash: hashDaftarWrite(['nik']),
            targetOrigin: origin,
          }),
        )
      ).kode,
    ).toBe('IZIN_TIDAK_VALID');
    expect(
      (
        await galat(() =>
          akun.pakaiIzin(tok, { userId: tamu, writeListHash: h, targetOrigin: 'https://evil.example.com' }),
        )
      ).kode,
    ).toBe('IZIN_TIDAK_VALID');
    akun.pakaiIzin(tok, { userId: tamu, writeListHash: h, targetOrigin: origin });
    expect(
      (await galat(() => akun.pakaiIzin(tok, { userId: tamu, writeListHash: h, targetOrigin: origin }))).kode,
    ).toBe('IZIN_TIDAK_VALID');
    const tok2 = akun.terbitkanIzin(tamu, h, origin);
    t += 5 * 60_000 + 1;
    expect(
      (await galat(() => akun.pakaiIzin(tok2, { userId: tamu, writeListHash: h, targetOrigin: origin })))
        .kode,
    ).toBe('IZIN_TIDAK_VALID');
    expect(
      (await galat(() => akun.pakaiIzin('pendek', { userId: tamu, writeListHash: h, targetOrigin: origin })))
        .kode,
    ).toBe('IZIN_TIDAK_VALID');
  });
});

describe('hapus akun: bukti kredensial (zona bahaya)', () => {
  it('PoC: sandi salah ikut penguncian; akun Google saja butuh masuk <= 15 menit; demo cukup HAPUS', async () => {
    await daftarAkun();
    const { akun: a } = await akun.masuk({ email: EMAIL, sandi: SANDI }, ctx);
    for (let i = 0; i < 5; i++)
      expect((await galat(akun.hapusAkun(a.id, { konfirmasi: 'HAPUS', sandi: SANDI2 }))).kode).toBe(
        'SANDI_LAMA_SALAH',
      );
    expect((await galat(akun.hapusAkun(a.id, { konfirmasi: 'HAPUS', sandi: SANDI }))).kode).toBe('TERKUNCI');

    const g = await googleLogin({ sub: 'g-hapus', email: EMAIL_LAIN, email_verified: true });
    if (g.jenis !== 'masuk') throw new Error('harus masuk');
    const lama = new Date(t).toISOString();
    t += 16 * 60 * 1000;
    expect((await galat(akun.hapusAkun(g.akun.id, { konfirmasi: 'HAPUS' }, { authAt: lama }))).kode).toBe(
      'PERLU_MASUK_ULANG',
    );
    expect((await galat(akun.hapusAkun(g.akun.id, { konfirmasi: 'HAPUS' }))).kode).toBe('PERLU_MASUK_ULANG');
    await akun.hapusAkun(g.akun.id, { konfirmasi: 'HAPUS' }, { authAt: new Date(t).toISOString() });
    expect(akun.akun(g.akun.id)).toBeUndefined();

    const demo = akun.buatDemo(ctx).akun;
    await akun.hapusAkun(demo.id, { konfirmasi: 'HAPUS' });
    expect(akun.akun(demo.id)).toBeUndefined();
  });
});

async function googleLogin(
  claims: Record<string, unknown>,
  opts: { next?: string; userId?: string; userIdSaatIni?: string; authAt?: string } = {},
) {
  const authAt = opts.authAt ?? new Date(t).toISOString();
  const { url, state } = akun.googleMulai(opts.next, { userId: opts.userId, authAt });
  const { code } = google.consent(url, claims);
  return akun.googleSelesai({ code, state, cookieState: state, userIdSaatIni: opts.userIdSaatIni }, ctx);
}

describe('#48 Google OIDC', () => {
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
    const row = db.prepare('SELECT * FROM oauth_states').get() as Record<string, string>;
    expect(row.state_hash).toBe(sha256Hex(state));
    expect(row.next).toBe('/lacak');
  });

  it('akun baru, nama prefill ke Data Diri terenkripsi, login berikutnya lewat sub yang sama', async () => {
    const r = await googleLogin(
      { sub: 'g-1', email: 'Baru@Example.com', email_verified: true, name: 'Warga Baru' },
      { next: '/lacak' },
    );
    if (r.jenis !== 'masuk') throw new Error('harus masuk');
    expect(r.baru).toBe(true);
    expect(r.next).toBe('/lacak');
    expect(r.akun).toMatchObject({ email: 'baru@example.com', punyaSandi: false, jenis: 'akun' });
    expect(akun.sinkron(r.akun)).toBe(true);
    expect(akun.terhubungGoogle(r.akun.id)).toBe(true);
    expect(akun.vault.getDataDiri(r.akun.id)?.data).toEqual({ namaLengkap: 'Warga Baru' });
    const lagi = await googleLogin({ sub: 'g-1', email: 'ganti@example.com', email_verified: false });
    expect(lagi).toMatchObject({ jenis: 'masuk', baru: false, akun: { id: r.akun.id } });
  });

  it('menautkan saat sedang masuk (bukti = sesi): hanya untuk akun yang memulai, sub tidak boleh milik akun lain', async () => {
    await daftarAkun();
    const { akun: a } = await akun.masuk({ email: EMAIL, sandi: SANDI }, ctx);
    expect(
      (
        await galat(
          googleLogin(
            { sub: 'g-l', email: 'lain@gmail.example.com', email_verified: true },
            { userId: a.id },
          ),
        )
      ).kode,
    ).toBe('GOOGLE_GAGAL'); // callback tanpa sesi yang sama
    const r = await googleLogin(
      { sub: 'g-l', email: 'lain@gmail.example.com', email_verified: true },
      { userId: a.id, userIdSaatIni: a.id },
    );
    expect(r).toMatchObject({ jenis: 'masuk', akun: { id: a.id } });
    expect(akun.terhubungGoogle(a.id)).toBe(true);
    const b = await googleLogin({ sub: 'g-b', email: 'b@example.com', email_verified: true });
    if (b.jenis !== 'masuk') throw new Error('harus masuk');
    expect(
      (
        await galat(
          googleLogin(
            { sub: 'g-b', email: 'b@example.com', email_verified: true },
            { userId: a.id, userIdSaatIni: a.id },
          ),
        )
      ).kode,
    ).toBe('GOOGLE_SUDAH_DIPAKAI');
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

  it('kode dari alur lain (PKCE tidak cocok) ditolak', async () => {
    const korban = akun.googleMulai();
    const penyerang = akun.googleMulai();
    const { code } = google.consent(penyerang.url, {
      sub: 'g-6',
      email: 'g6@example.com',
      email_verified: true,
    });
    expect(
      (await galat(akun.googleSelesai({ code, state: korban.state, cookieState: korban.state }, ctx))).kode,
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
    for (const [nama, tok, nonce] of kasus)
      await expect(oidc.verifyIdToken(await tok, nonce), nama).rejects.toThrow(/login Google gagal/);
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
    await expect(oidc.verifyIdToken(await google.sign(claims), 'n')).rejects.toThrow();
    now += 61_000;
    await expect(oidc.verifyIdToken(await google.sign(claims), 'n')).resolves.toBeDefined();
    now += 4_000_000;
    await expect(oidc.verifyIdToken(await google.sign(claims), 'n')).resolves.toBeDefined();
  });

  it('gangguan Google (token 500, tanpa id_token, JWKS 500, jaringan putus) → GOOGLE_GAGAL', async () => {
    const pesan: string[] = [];
    for (const g of ['token-500', 'token-tanpa-id', 'jwks-500'] as const) {
      google.gangguan = g;
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

describe('keamanan tautan Google (review keamanan 133322f)', () => {
  const identitas = (userId: string) =>
    db.prepare('SELECT sub, asal FROM oauth_identities WHERE user_id = ? ORDER BY sub').all(userId);
  const tanam = (sub: string, userId: string) =>
    db
      .prepare(
        "INSERT INTO oauth_identities (provider, sub, user_id, created_at, asal) VALUES ('google', ?, ?, 'x', 'tautan')",
      )
      .run(sub, userId);
  const idDari = (email: string) =>
    (db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string }).id;

  it('mode tautan langsung untuk akun yang baru daftar (tanpa verifikasi); hanya akun, bukti kredensial <= 15 menit', async () => {
    const d = await daftarAkun();
    const basi = new Date(t - 16 * 60_000).toISOString();
    expect(
      (await galat(() => akun.googleMulai('/pengaturan', { userId: d.akun.id, authAt: basi }))).kode,
    ).toBe('PERLU_MASUK_ULANG');
    expect((await galat(() => akun.googleMulai('/pengaturan', { userId: d.akun.id }))).kode).toBe(
      'PERLU_MASUK_ULANG',
    );
    const demo = akun.buatDemo({ ip: '198.51.100.60' }).akun;
    expect(
      (await galat(() => akun.googleMulai('/', { userId: demo.id, authAt: new Date(t).toISOString() }))).kode,
    ).toBe('HANYA_AKUN');
    expect(
      (
        await galat(() =>
          akun.googleMulai('/', { userId: 'akun_tidak_ada', authAt: new Date(t).toISOString() }),
        )
      ).kode,
    ).toBe('HANYA_AKUN');
    const r = await googleLogin(
      { sub: 'g-baru', email: 'pribadi-baru@example.com', email_verified: true },
      { userId: d.akun.id, userIdSaatIni: d.akun.id },
    );
    expect(r).toMatchObject({ jenis: 'masuk', akun: { id: d.akun.id } });
    expect(identitas(d.akun.id)).toEqual([{ sub: 'g-baru', asal: 'tautan' }]);
  });

  it('PoC: atur ulang sandi lewat email mencabut identitas Google lama', async () => {
    await akun.daftar({ email: EMAIL, sandi: SANDI }, { ip: '198.51.100.9' });
    const id = idDari(EMAIL);
    tanam('g-a', id);
    await akun.lupaSandi(EMAIL, ctx);
    await akun.emailSelesai();
    await akun.aturUlangSandi(tokenDari(mailer.last(EMAIL, 'atur-ulang')!.link), SANDI2, ctx);
    expect(identitas(id)).toEqual([]);
  });

  it('mulai menautkan butuh bukti kredensial <= 15 menit; tautan baru mengirim email pemberitahuan', async () => {
    await daftarAkun();
    const { akun: a } = await akun.masuk({ email: EMAIL, sandi: SANDI }, ctx);
    const basi = new Date(t - 16 * 60_000).toISOString();
    expect((await galat(() => akun.googleMulai('/pengaturan', { userId: a.id, authAt: basi }))).kode).toBe(
      'PERLU_MASUK_ULANG',
    );
    await googleLogin(
      { sub: 'g-t', email: 'pribadi@example.com', email_verified: true },
      { userId: a.id, userIdSaatIni: a.id },
    );
    await akun.emailSelesai();
    expect(mailer.last(EMAIL, 'google-ditautkan')).toBeDefined();
    expect(identitas(a.id)).toEqual([{ sub: 'g-t', asal: 'tautan' }]);
  });

  it('lepas Google (butuh sandi agar tidak terkunci); keluar semua mencabut tautan, bukan identitas asal', async () => {
    const g = await googleLogin({ sub: 'g-asal', email: 'asal@example.com', email_verified: true });
    if (g.jenis !== 'masuk') throw new Error('harus masuk');
    expect((await galat(() => akun.lepasGoogle(g.akun.id))).kode).toBe('GOOGLE_SATU_SATUNYA');
    await googleLogin(
      { sub: 'g-tambahan', email: 'lain@example.com', email_verified: true },
      { userId: g.akun.id, userIdSaatIni: g.akun.id },
    );
    akun.keluarSemua(g.akun.id);
    expect(identitas(g.akun.id)).toEqual([{ sub: 'g-asal', asal: 'daftar' }]);

    await daftarAkun();
    const { akun: a } = await akun.masuk({ email: EMAIL, sandi: SANDI }, ctx);
    await googleLogin(
      { sub: 'g-x', email: 'x@example.com', email_verified: true },
      { userId: a.id, userIdSaatIni: a.id },
    );
    expect(akun.lepasGoogle(a.id)).toBe(1);
    expect(akun.terhubungGoogle(a.id)).toBe(false);
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
      '/\nx',
      '/\tx',
      '',
      undefined,
      null,
      'lacak',
      `/${'a'.repeat(600)}`,
    ])
      expect(amanNext(bad as string), String(bad)).toBe('/');
    expect(amanNext('/%0d%0aSet-Cookie')).toBe('/%0d%0aSet-Cookie');
    expect(amanNext('https://evil.example.com', '/masuk')).toBe('/masuk');
  });
});

describe('email tertunda (kuota Resend habis / DNS belum siap)', () => {
  it('kegagalan kirim: respons jujur "tertunda", alert sekali, tanpa alamat lengkap di log', async () => {
    const log: string[] = [];
    const alert: string[] = [];
    let gagal = true;
    akun = buat({
      mailer: {
        kind: 'resend',
        send: () => (gagal ? Promise.reject(new MailerError(429)) : Promise.resolve()),
      },
      log: (l) => log.push(l),
      alert: (p) => alert.push(p),
    });
    expect(akun.modeEmail).toBe('resend');
    // daftar tidak mengirim email, jadi tidak terpengaruh kegagalan kirim
    await expect(akun.daftar({ email: EMAIL, sandi: SANDI }, ctx)).resolves.toMatchObject({
      akun: { email: EMAIL },
    });
    expect(akun.emailTertunda).toBe(false);
    await akun.lupaSandi(EMAIL, ctx);
    await akun.emailSelesai();
    expect(akun.emailTertunda).toBe(true);
    expect(await akun.lupaSandi('siapa@example.com', ctx)).toEqual({ tertunda: true }); // global, bukan per email
    await akun.lupaSandi(EMAIL, ctx);
    await akun.emailSelesai();
    expect(alert).toEqual(['email tertunda: pengiriman email gagal: kuota penyedia habis (HTTP 429)']);
    expect(log.join('\n')).not.toContain(EMAIL);
    expect(log[0]).toContain('w***@example.com');
    await expect(akun.masuk({ email: EMAIL, sandi: SANDI }, ctx)).resolves.toBeDefined();
    gagal = false;
    t += 16 * 60_000;
    expect(akun.emailTertunda).toBe(false);
    expect(await akun.lupaSandi('b@example.com', ctx)).toEqual({ tertunda: false });
  });

  it('email ditahan (mode log di produksi): selalu tertunda, daftar tetap akun penuh, lupa sandi nonaktif', async () => {
    const terkirim: string[] = [];
    akun = buat({ mailer: { kind: 'log', ditahan: true, send: async (m) => void terkirim.push(m.jenis) } });
    expect([akun.modeEmail, akun.emailTertunda, akun.aturUlangTersedia]).toEqual(['log', true, false]);
    const d = await akun.daftar({ email: EMAIL, sandi: SANDI }, ctx);
    expect(akun.sinkron(d.akun)).toBe(true);
    expect((await galat(akun.lupaSandi(EMAIL, ctx))).kode).toBe('ATUR_ULANG_NONAKTIF');
    const { akun: a } = await akun.masuk({ email: EMAIL, sandi: SANDI }, ctx);
    expect(akun.sinkron(a)).toBe(true);
    await akun.emailSelesai();
    expect(terkirim).toEqual([]);
  });
});

describe('penyapu', () => {
  it('bersihkan: sesi/token/state/izin kedaluwarsa', async () => {
    await daftarAkun();
    await akun.masuk({ email: EMAIL, sandi: SANDI }, ctx);
    akun.googleMulai();
    const tamu = akun.pastikanTamu('sid-p', ctx);
    akun.terbitkanIzin(tamu, 'h', 'https://x.example.com');
    t += 8 * 24 * JAM;
    const r = akun.bersihkan();
    expect(r.lain).toBeGreaterThanOrEqual(3);
    expect(r.tamu).toBe(1);
    expect(db.prepare('SELECT email FROM users').all()).toEqual([{ email: EMAIL }]);
    for (const tabel of ['auth_sessions', 'oauth_states', 'pii_izin', 'email_tokens'])
      expect(hitung(`SELECT COUNT(*) n FROM ${tabel}`)).toBe(0);
  });
});

describe('rem akun massal (review H1)', () => {
  it('daftar: plafon harian 40 akun per IP; jendela jam baru tidak mereset plafon harian', async () => {
    for (let i = 0; i < 40; i++) {
      if (i > 0 && i % 20 === 0) t += 3_600_001; // lewati batas 20/jam, tetap di hari yang sama
      await akun.daftar({ email: `massal${i}@example.com`, sandi: SANDI }, ctx);
    }
    t += 3_600_001;
    const e = await galat(akun.daftar({ email: 'massal-x@example.com', sandi: SANDI }, ctx));
    expect(e.kode).toBe('RATE_LIMITED');
    expect(e.retryAfterSec).toBeGreaterThan(3600);
    expect(db.prepare("SELECT COUNT(*) n FROM users WHERE email = 'massal-x@example.com'").get()).toEqual({
      n: 0,
    });
    // IP lain tidak terdampak
    await akun.daftar({ email: 'massal-y@example.com', sandi: SANDI }, { ...ctx, ip: '198.51.100.7' });
  }, 60_000);
});

describe('atur ulang pada email yang belum terbukti (review H2)', () => {
  const terbukti = (id: string) =>
    (db.prepare('SELECT at FROM email_terbukti WHERE user_id = ?').get(id) as { at: string } | undefined)
      ?.at ?? null;
  async function resetLewatEmail(sandi = SANDI2) {
    await akun.lupaSandi(EMAIL, ctx);
    await akun.emailSelesai();
    await akun.aturUlangSandi(tokenDari(mailer.last(EMAIL, 'atur-ulang')!.link), sandi, ctx);
  }

  it('penyerobot email: urusan, vault, berkas, dan ingatannya dihancurkan sebelum akun pindah ke pemilik kotak surat', async () => {
    const dihapus: string[] = [];
    akun = buat({
      hapusUrusan: (id) => {
        dihapus.push(id);
        db.prepare('DELETE FROM urusan WHERE id = ?').run(id);
      },
    });
    const a = (await daftarAkun()).akun; // didaftarkan penyerobot dengan sandinya sendiri
    expect(terbukti(a.id)).toBeNull();
    urusan('u_serobot', 'u_lain');
    akun.catatPemilikUrusan('u_serobot', { akun: a });
    akun.catatPemilikUrusan('u_lain', { sid: 'tamu-lain' });
    akun.vault.setDataDiri(a.id, { namaLengkap: 'Data Tanaman Penyerobot' });
    akun.vault.putDocument(a.id, { jenis: 'ktp', judul: 'KTP', mime: 'image/png', bytes: Buffer.from('x') });
    akun.vault.setIngatan(a.id, { catatan: 'ingatan tanaman' });
    expect(readdirSync(vaultDir)).toEqual([a.id]);

    await resetLewatEmail();
    expect(dihapus).toEqual(['u_serobot']);
    expect(akun.urusanMilik(a.id)).toEqual([]);
    expect(akun.vault.getDataDiri(a.id)).toBeNull();
    expect(akun.vault.getIngatan(a.id)).toBeNull();
    for (const tabel of ['user_keys', 'vault_data_diri', 'vault_documents', 'vault_ingatan'])
      expect(db.prepare(`SELECT COUNT(*) n FROM ${tabel}`).get()).toEqual({ n: 0 });
    expect(readdirSync(vaultDir)).toEqual([]);
    expect(terbukti(a.id)).not.toBeNull();
    // akun tetap milik pemilik kotak surat dengan sandi barunya
    await expect(akun.masuk({ email: EMAIL, sandi: SANDI2 }, ctx)).resolves.toBeDefined();
  });

  it('email sudah terbukti: atur ulang berikutnya TIDAK menghapus data warga', async () => {
    const a = (await daftarAkun()).akun;
    await resetLewatEmail(); // bukti pertama (akun masih kosong)
    akun.vault.setDataDiri(a.id, { namaLengkap: 'Warga Asli' });
    akun.vault.setIngatan(a.id, { catatan: 'ingatan warga' });
    t += 60 * 60_000;
    await resetLewatEmail(SANDI);
    expect(akun.vault.getDataDiri(a.id)?.data).toEqual({ namaLengkap: 'Warga Asli' });
    expect(akun.vault.getIngatan(a.id)?.data).toEqual({ catatan: 'ingatan warga' });
  });

  it('akun baru lewat Google tercatat terbukti (atur ulang tidak menghapus datanya)', async () => {
    const r = await googleLogin({ sub: 'g-h2', email: 'gugel@example.com', email_verified: true, name: 'G' });
    if (r.jenis !== 'masuk') throw new Error('harus masuk');
    expect(terbukti(r.akun.id)).not.toBeNull();
  });
});
