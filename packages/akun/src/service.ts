import type { Db } from '@urusin/harness';
import { maskEmail, normalizeEmail } from './email.js';
import { AkunError } from './errors.js';
import { GoogleError, type GoogleOidc } from './google.js';
import type { EmailMessage, Mailer } from './mailer.js';
import { hashPassword, needsRehash, periksaSandi, verifyPassword } from './password.js';
import { emailAturUlang, emailSudahTerdaftar, emailVerifikasi } from './templates.js';
import { newId, randomToken, safeEqual, sha256Hex, TOKEN_RE } from './token.js';
import type { Vault } from './vault.js';

export type AkunTtl = {
  /** Sesi berakhir bila tidak dipakai selama ini. */
  sesiIdleSec: number;
  /** Sesi berakhir paling lambat ini sejak login, dipakai atau tidak. */
  sesiAbsolutSec: number;
  verifikasiSec: number;
  aturUlangSec: number;
  oauthStateSec: number;
};

export const DEFAULT_TTL: AkunTtl = Object.freeze({
  sesiIdleSec: 7 * 24 * 3600,
  sesiAbsolutSec: 30 * 24 * 3600,
  verifikasiSec: 24 * 3600,
  aturUlangSec: 30 * 60,
  oauthStateSec: 10 * 60,
});

export type Limiter = { consume(key: string): { ok: boolean; retryAfterSec: number } };
export type LimitRule = { limit: number; windowMs: number };
type Aksi = 'masuk' | 'daftar' | 'lupa' | 'kirimUlang' | 'token';

const MENIT = 60_000;
const JAM = 60 * MENIT;
/** Batas laju per aksi: per IP dan per email (kunci = hash email ternormalisasi). */
export const DEFAULT_LIMITS: Record<Aksi, { ip: LimitRule; email?: LimitRule }> = {
  masuk: { ip: { limit: 30, windowMs: 15 * MENIT }, email: { limit: 10, windowMs: 15 * MENIT } },
  daftar: { ip: { limit: 20, windowMs: JAM }, email: { limit: 3, windowMs: JAM } },
  lupa: { ip: { limit: 20, windowMs: JAM }, email: { limit: 3, windowMs: JAM } },
  kirimUlang: { ip: { limit: 20, windowMs: JAM }, email: { limit: 3, windowMs: JAM } },
  token: { ip: { limit: 30, windowMs: 15 * MENIT } },
};

/** Penguncian login: setelah 5 gagal beruntun, kunci 30 dtk lalu berlipat dua tiap gagal, maksimal 1 jam. */
export const LOCKOUT = Object.freeze({ ambang: 5, dasarSec: 30, maksSec: 3600 });

export type AkunDeps = {
  db: Db;
  mailer: Mailer;
  vault: Vault;
  /** Origin publik untuk tautan di email (`https://urusin...`). */
  publicOrigin: string;
  /** Pembuat pembatas laju (web memakai RateLimiter in-memory). */
  limiter: (rule: LimitRule) => Limiter;
  google?: GoogleOidc | undefined;
  ttl?: Partial<AkunTtl>;
  limits?: Partial<typeof DEFAULT_LIMITS>;
  now?: () => Date;
  /** Hapus satu urusan beserta rantainya (web: `store.deleteUrusan`, menyisakan tombstone). */
  hapusUrusan?: (urusanId: string) => void;
  log?: (line: string) => void;
};

export type Akun = {
  id: string;
  email: string;
  emailVerifiedAt: string | null;
  punyaSandi: boolean;
  createdAt: string;
};

export type KonteksPermintaan = { ip: string; userAgent?: string | null | undefined };

type UserRow = {
  id: string;
  email: string;
  email_verified_at: string | null;
  password_hash: string | null;
  created_at: string;
};

const toAkun = (r: UserRow): Akun => ({
  id: r.id,
  email: r.email,
  emailVerifiedAt: r.email_verified_at,
  punyaSandi: r.password_hash !== null,
  createdAt: r.created_at,
});

/** Ringkas user-agent menjadi "Chrome di Android"; UA mentah tidak disimpan. */
export function ringkasUserAgent(ua: string | null | undefined): string {
  if (!ua) return 'Perangkat tidak dikenal';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /SamsungBrowser/.test(ua)
        ? 'Samsung Internet'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Chrome\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : 'Peramban';
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad|iPod/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /CrOS/.test(ua)
          ? 'ChromeOS'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'macOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'perangkat lain';
  return `${browser} di ${os}`;
}

/**
 * Tujuan setelah login (`next=`): hanya path relatif di origin sendiri. `//evil`, `/\evil`, skema, karakter
 * kontrol, dan backslash ditolak (anti open redirect). Mengembalikan fallback bila tidak aman.
 */
export function amanNext(next: string | null | undefined, fallback = '/'): string {
  if (typeof next !== 'string' || next.length === 0 || next.length > 512) return fallback;
  if (!next.startsWith('/') || next.startsWith('//')) return fallback;
  // eslint-disable-next-line no-control-regex -- sengaja menolak karakter kontrol
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return fallback;
  try {
    const base = 'https://urusin.invalid';
    const u = new URL(next, base);
    if (u.origin !== base) return fallback;
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return fallback;
  }
}

/**
 * Layanan akun: semua alur email + sandi dan Google, sesi, kepemilikan urusan, dan hapus akun.
 * Tidak ada respons yang membedakan "email terdaftar" dari "tidak terdaftar".
 */
export class AkunService {
  private readonly db: Db;
  private readonly ttl: AkunTtl;
  private readonly now: () => Date;
  private readonly log: (line: string) => void;
  private readonly lim: Record<Aksi, { ip: Limiter; email?: Limiter | undefined }>;
  private readonly inflight = new Set<Promise<void>>();
  /** Hash sandi acak untuk menyamakan waktu respons saat email tidak dikenal. */
  private dummyHash: Promise<string> | undefined;

  constructor(private readonly deps: AkunDeps) {
    this.db = deps.db;
    this.ttl = { ...DEFAULT_TTL, ...deps.ttl };
    this.now = deps.now ?? (() => new Date());
    this.log = deps.log ?? (() => undefined);
    const limits = { ...DEFAULT_LIMITS, ...deps.limits };
    this.lim = Object.fromEntries(
      Object.entries(limits).map(([k, v]) => [
        k,
        { ip: deps.limiter(v.ip), email: v.email ? deps.limiter(v.email) : undefined },
      ]),
    ) as AkunService['lim'];
    // Baris yang dihapus ditimpa nol di berkas DB (bukan sekadar ditandai bebas).
    this.db.pragma('secure_delete = ON');
  }

  get googleAktif(): boolean {
    return this.deps.google !== undefined;
  }

  get vault(): Vault {
    return this.deps.vault;
  }

  // --- utilitas ---

  private iso(offsetSec = 0): string {
    return new Date(this.now().getTime() + offsetSec * 1000).toISOString();
  }

  private batasi(aksi: Aksi, ctx: KonteksPermintaan, email?: string): void {
    const l = this.lim[aksi];
    const hasil = [l.ip.consume(`${aksi}:ip:${ctx.ip}`)];
    if (email && l.email) hasil.push(l.email.consume(`${aksi}:email:${sha256Hex(email)}`));
    const kena = hasil.find((h) => !h.ok);
    if (kena) throw new AkunError('RATE_LIMITED', kena.retryAfterSec);
  }

  private emailAtauGagal(raw: string): string {
    const email = normalizeEmail(raw);
    if (!email) throw new AkunError('EMAIL_TIDAK_VALID');
    return email;
  }

  private sandiAtauGagal(sandi: string, email?: string): void {
    const masalah = periksaSandi(sandi, email);
    if (masalah) throw new AkunError(masalah);
  }

  /** Kirim email tanpa menunggu (waktu respons tidak bergantung penyedia email); galat hanya dicatat. */
  private kirim(msg: EmailMessage): void {
    const p = this.deps.mailer
      .send(msg)
      .catch((e: unknown) =>
        this.log(`[akun] email ${msg.jenis} ke ${maskEmail(msg.to)} gagal: ${(e as Error).message}`),
      )
      .finally(() => this.inflight.delete(p));
    this.inflight.add(p);
  }

  /** Tunggu semua email yang sedang dikirim (tes dan shutdown). */
  async emailSelesai(): Promise<void> {
    await Promise.all([...this.inflight]);
  }

  private link(path: string, token?: string): string {
    const u = new URL(path, this.deps.publicOrigin);
    if (token) u.searchParams.set('token', token);
    return u.href;
  }

  private userByEmail(email: string): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;
  }

  private userById(id: string): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  }

  akun(userId: string): Akun | undefined {
    const r = this.userById(userId);
    return r ? toAkun(r) : undefined;
  }

  terhubungGoogle(userId: string): boolean {
    return (
      this.db
        .prepare("SELECT 1 FROM oauth_identities WHERE user_id = ? AND provider = 'google'")
        .get(userId) !== undefined
    );
  }

  private async samarkanWaktu(sandi: string): Promise<void> {
    this.dummyHash ??= hashPassword(randomToken());
    await verifyPassword(await this.dummyHash, sandi);
  }

  // --- token email ---

  private terbitkanToken(userId: string, purpose: 'verify' | 'reset'): string {
    const token = randomToken();
    const ttl = purpose === 'verify' ? this.ttl.verifikasiSec : this.ttl.aturUlangSec;
    const tx = this.db.transaction(() => {
      // Hanya tautan terbaru yang berlaku.
      this.db
        .prepare('UPDATE email_tokens SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL')
        .run(this.iso(), userId, purpose);
      this.db
        .prepare(
          `INSERT INTO email_tokens (token_hash, user_id, purpose, created_at, expires_at)
           VALUES (?,?,?,?,?)`,
        )
        .run(sha256Hex(token), userId, purpose, this.iso(), this.iso(ttl));
    });
    tx.immediate();
    return token;
  }

  /** Pakai token sekali (atomik). Mengembalikan user_id atau melempar TOKEN_TIDAK_VALID. */
  private pakaiToken(token: string, purpose: 'verify' | 'reset'): string {
    if (!TOKEN_RE.test(token)) throw new AkunError('TOKEN_TIDAK_VALID');
    const row = this.db
      .prepare(
        `UPDATE email_tokens SET used_at = ?
         WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?
         RETURNING user_id`,
      )
      .get(this.iso(), sha256Hex(token), purpose, this.iso()) as { user_id: string } | undefined;
    if (!row) throw new AkunError('TOKEN_TIDAK_VALID');
    return row.user_id;
  }

  /** Token masih berlaku? (untuk halaman atur ulang sandi sebelum formulir dikirim; tidak memakai token). */
  tokenBerlaku(token: string, purpose: 'verify' | 'reset'): boolean {
    if (!TOKEN_RE.test(token)) return false;
    return (
      this.db
        .prepare(
          `SELECT 1 FROM email_tokens WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?`,
        )
        .get(sha256Hex(token), purpose, this.iso()) !== undefined
    );
  }

  // --- daftar dan verifikasi ---

  /**
   * Daftar dengan email + sandi. Hasil SELALU sama ("cek email Anda"), apa pun keadaan email:
   * - baru: buat akun belum terverifikasi + kirim tautan verifikasi;
   * - sudah ada tapi belum terverifikasi: sandi diganti yang terbaru dan tautan lama dibatalkan
   *   (hanya pemilik kotak surat yang bisa menyelesaikan; mencegah pra-pembajakan dengan sandi lama);
   * - sudah terverifikasi: kirim email "akun sudah ada" (tanpa mengubah apa pun).
   */
  async daftar(input: { email: string; sandi: string }, ctx: KonteksPermintaan): Promise<void> {
    const email = this.emailAtauGagal(input.email);
    this.sandiAtauGagal(input.sandi, email);
    this.batasi('daftar', ctx, email);
    const hash = await hashPassword(input.sandi); // selalu di-hash: waktu respons sama untuk semua cabang
    const ada = this.userByEmail(email);
    if (ada?.email_verified_at) {
      this.kirim(emailSudahTerdaftar(email, this.link('/masuk'), this.link('/lupa-sandi')));
      return;
    }
    let userId: string;
    if (ada) {
      userId = ada.id;
      this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
    } else {
      userId = newId('akun');
      this.db
        .prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?,?,?,?)')
        .run(userId, email, hash, this.iso());
    }
    this.kirim(emailVerifikasi(email, this.link('/verifikasi-email', this.terbitkanToken(userId, 'verify'))));
  }

  /** Klik tautan verifikasi. Token sekali pakai, 24 jam. */
  verifikasiEmail(token: string, ctx: KonteksPermintaan): Akun {
    this.batasi('token', ctx);
    const userId = this.pakaiToken(token, 'verify');
    this.db
      .prepare('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?')
      .run(this.iso(), userId);
    return toAkun(this.userById(userId)!);
  }

  /** Kirim ulang tautan verifikasi. Respons selalu sama. */
  async kirimUlangVerifikasi(rawEmail: string, ctx: KonteksPermintaan): Promise<void> {
    const email = this.emailAtauGagal(rawEmail);
    this.batasi('kirimUlang', ctx, email);
    const u = this.userByEmail(email);
    if (!u || u.email_verified_at || !u.password_hash) return;
    this.kirim(emailVerifikasi(email, this.link('/verifikasi-email', this.terbitkanToken(u.id, 'verify'))));
  }

  // --- masuk, lockout, sesi ---

  private lockKey(email: string): string {
    return sha256Hex(`lockout|${email}`);
  }

  private periksaKunci(email: string): void {
    const r = this.db
      .prepare('SELECT locked_until FROM auth_lockout WHERE key = ?')
      .get(this.lockKey(email)) as { locked_until: string | null } | undefined;
    if (r?.locked_until && r.locked_until > this.iso()) {
      const sisa = Math.ceil((Date.parse(r.locked_until) - this.now().getTime()) / 1000);
      throw new AkunError('TERKUNCI', Math.max(1, sisa));
    }
  }

  private catatGagal(email: string): void {
    const key = this.lockKey(email);
    const r = this.db.prepare('SELECT failures FROM auth_lockout WHERE key = ?').get(key) as
      { failures: number } | undefined;
    const failures = (r?.failures ?? 0) + 1;
    const lebih = failures - LOCKOUT.ambang;
    const lockedUntil =
      lebih >= 0 ? this.iso(Math.min(LOCKOUT.dasarSec * 2 ** Math.min(lebih, 20), LOCKOUT.maksSec)) : null;
    this.db
      .prepare(
        `INSERT INTO auth_lockout (key, failures, locked_until, updated_at) VALUES (?,?,?,?)
         ON CONFLICT(key) DO UPDATE SET failures = excluded.failures, locked_until = excluded.locked_until,
           updated_at = excluded.updated_at`,
      )
      .run(key, failures, lockedUntil, this.iso());
  }

  private bukaKunci(email: string): void {
    this.db.prepare('DELETE FROM auth_lockout WHERE key = ?').run(this.lockKey(email));
  }

  /**
   * Masuk dengan email + sandi. Email tak dikenal, akun tanpa sandi (Google saja), dan sandi salah
   * menghasilkan galat dan waktu yang sama. Sandi benar tetapi email belum diverifikasi → 403.
   */
  async masuk(
    input: { email: string; sandi: string },
    ctx: KonteksPermintaan,
  ): Promise<{ token: string; akun: Akun }> {
    const email = normalizeEmail(input.email);
    if (!email || input.sandi.length === 0 || input.sandi.length > 1024) {
      throw new AkunError('KREDENSIAL_SALAH');
    }
    this.batasi('masuk', ctx, email);
    this.periksaKunci(email);
    const u = this.userByEmail(email);
    const cocok = u?.password_hash
      ? await verifyPassword(u.password_hash, input.sandi)
      : (await this.samarkanWaktu(input.sandi), false);
    if (!u || !cocok) {
      this.catatGagal(email);
      throw new AkunError('KREDENSIAL_SALAH');
    }
    this.bukaKunci(email);
    if (!u.email_verified_at) throw new AkunError('EMAIL_BELUM_TERVERIFIKASI');
    if (needsRehash(u.password_hash!)) {
      this.db
        .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
        .run(await hashPassword(input.sandi), u.id);
    }
    return { token: this.buatSesi(u.id, ctx), akun: toAkun(u) };
  }

  /** Sesi baru (token acak; hanya hash yang disimpan). Selalu token baru: rotasi saat login. */
  buatSesi(userId: string, ctx: KonteksPermintaan): string {
    const token = randomToken();
    this.db
      .prepare(
        `INSERT INTO auth_sessions (token_hash, user_id, created_at, last_seen_at, expires_at, user_agent)
         VALUES (?,?,?,?,?,?)`,
      )
      .run(
        sha256Hex(token),
        userId,
        this.iso(),
        this.iso(),
        this.iso(this.ttl.sesiAbsolutSec),
        ringkasUserAgent(ctx.userAgent),
      );
    return token;
  }

  /** Validasi token cookie. Kedaluwarsa (idle atau absolut) → dihapus dan null. */
  sesi(token: string | undefined): { akun: Akun; tokenHash: string; kedaluwarsa: string } | null {
    if (!token || !TOKEN_RE.test(token)) return null;
    const hash = sha256Hex(token);
    const s = this.db
      .prepare('SELECT user_id, last_seen_at, expires_at FROM auth_sessions WHERE token_hash = ?')
      .get(hash) as { user_id: string; last_seen_at: string; expires_at: string } | undefined;
    if (!s) return null;
    const now = this.now().getTime();
    const idleHabis = Date.parse(s.last_seen_at) + this.ttl.sesiIdleSec * 1000 <= now;
    if (idleHabis || Date.parse(s.expires_at) <= now) {
      this.db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(hash);
      return null;
    }
    const u = this.userById(s.user_id);
    if (!u) return null;
    // Perpanjang idle paling sering sekali per menit (hemat tulisan).
    if (now - Date.parse(s.last_seen_at) > 60_000) {
      this.db.prepare('UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?').run(this.iso(), hash);
    }
    return { akun: toAkun(u), tokenHash: hash, kedaluwarsa: s.expires_at };
  }

  keluar(token: string | undefined): void {
    if (!token || !TOKEN_RE.test(token)) return;
    this.db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(sha256Hex(token));
  }

  /** "Keluar dari semua perangkat". Mengembalikan jumlah sesi yang dihapus. */
  keluarSemua(userId: string): number {
    return this.db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(userId).changes;
  }

  perangkat(userId: string, tokenHashIni?: string) {
    const rows = this.db
      .prepare(
        `SELECT token_hash, created_at, last_seen_at, user_agent FROM auth_sessions
         WHERE user_id = ? ORDER BY last_seen_at DESC`,
      )
      .all(userId) as {
      token_hash: string;
      created_at: string;
      last_seen_at: string;
      user_agent: string | null;
    }[];
    return rows.map((r) => ({
      id: r.token_hash.slice(0, 12),
      ringkasan: r.user_agent ?? 'Perangkat tidak dikenal',
      dibuatPada: r.created_at,
      terakhirAktif: r.last_seen_at,
      perangkatIni: r.token_hash === tokenHashIni,
    }));
  }

  // --- lupa / atur ulang / ubah sandi ---

  /** Lupa sandi: kirim tautan atur ulang (30 menit) bila akun ada. Respons selalu sama. */
  async lupaSandi(rawEmail: string, ctx: KonteksPermintaan): Promise<void> {
    const email = this.emailAtauGagal(rawEmail);
    this.batasi('lupa', ctx, email);
    const u = this.userByEmail(email);
    if (!u) return;
    this.kirim(emailAturUlang(email, this.link('/atur-ulang-sandi', this.terbitkanToken(u.id, 'reset'))));
  }

  /**
   * Atur ulang sandi dengan token reset. Sandi diperiksa DULU (token tidak terbakar oleh sandi yang ditolak).
   * Berhasil → semua sesi akun dihapus, email dianggap terverifikasi (pemilik kotak surat), kunci dibuka.
   */
  async aturUlangSandi(token: string, sandiBaru: string, ctx: KonteksPermintaan): Promise<Akun> {
    this.batasi('token', ctx);
    if (!this.tokenBerlaku(token, 'reset')) throw new AkunError('TOKEN_TIDAK_VALID');
    const calon = this.db
      .prepare(`SELECT u.email FROM email_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?`)
      .get(sha256Hex(token)) as { email: string };
    this.sandiAtauGagal(sandiBaru, calon.email);
    const hash = await hashPassword(sandiBaru);
    const userId = this.pakaiToken(token, 'reset');
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          'UPDATE users SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?',
        )
        .run(hash, this.iso(), userId);
      this.db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(userId);
      this.db
        .prepare(
          "UPDATE email_tokens SET used_at = ? WHERE user_id = ? AND purpose = 'reset' AND used_at IS NULL",
        )
        .run(this.iso(), userId);
    });
    tx.immediate();
    const u = this.userById(userId)!;
    this.bukaKunci(u.email);
    return toAkun(u);
  }

  /**
   * Ubah sandi saat sudah masuk. Akun bersandi wajib menyebut sandi lama; akun Google-saja boleh membuat sandi.
   * Semua sesi lain dihapus dan sesi ini dirotasi: mengembalikan token baru.
   */
  async ubahSandi(
    userId: string,
    input: { sandiLama?: string | undefined; sandiBaru: string },
    ctx: KonteksPermintaan,
  ): Promise<string> {
    const u = this.userById(userId);
    if (!u) throw new AkunError('BELUM_MASUK');
    if (u.password_hash) {
      const ok = input.sandiLama ? await verifyPassword(u.password_hash, input.sandiLama) : false;
      if (!ok) throw new AkunError('SANDI_LAMA_SALAH');
    }
    this.sandiAtauGagal(input.sandiBaru, u.email);
    const hash = await hashPassword(input.sandiBaru);
    const tx = this.db.transaction(() => {
      this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
      this.db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(userId);
    });
    tx.immediate();
    return this.buatSesi(userId, ctx);
  }

  // --- hapus akun ---

  /**
   * Hapus akun: urusan milik akun (dengan tombstone), vault (crypto-shred DEK + berkas), sesi, token,
   * identitas Google, dan baris akun. Akun bersandi wajib menyebut sandinya.
   */
  async hapusAkun(userId: string, input: { konfirmasi: string; sandi?: string | undefined }): Promise<void> {
    const u = this.userById(userId);
    if (!u) throw new AkunError('BELUM_MASUK');
    if (input.konfirmasi !== 'HAPUS') throw new AkunError('KONFIRMASI_SALAH');
    if (u.password_hash) {
      const ok = input.sandi ? await verifyPassword(u.password_hash, input.sandi) : false;
      if (!ok) throw new AkunError('SANDI_LAMA_SALAH');
    }
    const hapusUrusan =
      this.deps.hapusUrusan ?? ((id: string) => this.db.prepare('DELETE FROM urusan WHERE id = ?').run(id));
    for (const id of this.urusanMilik(userId)) hapusUrusan(id);
    this.deps.vault.shred(userId);
    this.db.prepare('DELETE FROM users WHERE id = ?').run(userId); // cascade: sesi, token, identitas
    this.bukaKunci(u.email);
    // Lipat WAL ke berkas utama agar halaman lama (berisi baris terhapus) tidak tertinggal di -wal.
    try {
      this.db.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      // DB memori / bukan WAL: tidak ada yang perlu dilipat
    }
  }

  // --- kepemilikan urusan dan migrasi tamu ---

  catatPemilikUrusan(
    urusanId: string,
    pemilik: { userId?: string | undefined; guestSid?: string | undefined },
  ): void {
    if (!pemilik.userId && !pemilik.guestSid) return;
    this.db
      .prepare(
        'INSERT OR IGNORE INTO urusan_owner (urusan_id, user_id, guest_sid, created_at) VALUES (?,?,?,?)',
      )
      .run(urusanId, pemilik.userId ?? null, pemilik.userId ? null : (pemilik.guestSid ?? null), this.iso());
  }

  /** Pindahkan urusan sesi tamu ke akun (dipanggil saat masuk). Mengembalikan jumlah urusan yang pindah. */
  migrasiTamu(userId: string, guestSid: string | undefined): number {
    if (!guestSid) return 0;
    return this.db
      .prepare(
        'UPDATE urusan_owner SET user_id = ?, guest_sid = NULL WHERE guest_sid = ? AND user_id IS NULL',
      )
      .run(userId, guestSid).changes;
  }

  urusanMilik(userId: string): string[] {
    return (
      this.db
        .prepare('SELECT urusan_id FROM urusan_owner WHERE user_id = ? ORDER BY created_at DESC')
        .all(userId) as { urusan_id: string }[]
    ).map((r) => r.urusan_id);
  }

  // --- Google ---

  /** Mulai login Google: simpan state (hash) → verifier PKCE, nonce, tujuan. Kembalikan URL dan state cookie. */
  googleMulai(next?: string | null): { url: string; state: string } {
    const google = this.deps.google;
    if (!google) throw new AkunError('GOOGLE_TIDAK_AKTIF');
    const state = randomToken();
    const nonce = randomToken();
    const codeVerifier = randomToken();
    this.db
      .prepare(
        'INSERT INTO oauth_states (state_hash, code_verifier, nonce, next, expires_at) VALUES (?,?,?,?,?)',
      )
      .run(sha256Hex(state), codeVerifier, nonce, amanNext(next), this.iso(this.ttl.oauthStateSec));
    return { url: google.authorizationUrl({ state, nonce, codeVerifier }), state };
  }

  /**
   * Callback Google. `state` dari query harus sama dengan cookie state (CSRF login), lalu state dipakai sekali.
   * Identitas Google (sub) yang sudah terhubung → akunnya. Belum terhubung: tautkan ke akun ber-email sama
   * HANYA bila Google menyatakan `email_verified`; akun lama yang belum terverifikasi kehilangan sandi lamanya
   * (anti pra-pembajakan) dan semua sesinya. Tanpa akun → akun baru terverifikasi.
   */
  async googleSelesai(
    p: { code: string | null; state: string | null; cookieState: string | undefined },
    ctx: KonteksPermintaan,
  ): Promise<{ token: string; akun: Akun; next: string; baru: boolean }> {
    const google = this.deps.google;
    if (!google) throw new AkunError('GOOGLE_TIDAK_AKTIF');
    if (!p.state || !p.cookieState || !p.code || !safeEqual(p.state, p.cookieState))
      throw new AkunError('GOOGLE_GAGAL');
    const st = this.db
      .prepare(
        'DELETE FROM oauth_states WHERE state_hash = ? RETURNING code_verifier, nonce, next, expires_at',
      )
      .get(sha256Hex(p.state)) as
      { code_verifier: string; nonce: string; next: string; expires_at: string } | undefined;
    if (!st || st.expires_at <= this.iso()) throw new AkunError('GOOGLE_GAGAL');
    let claims;
    try {
      claims = await google.verifyIdToken(await google.exchangeCode(p.code, st.code_verifier), st.nonce);
    } catch (e) {
      if (e instanceof GoogleError) {
        this.log(`[akun] ${e.message}`);
        throw new AkunError('GOOGLE_GAGAL');
      }
      throw e;
    }
    const email = normalizeEmail(claims.email);
    if (!email) throw new AkunError('GOOGLE_GAGAL');

    let baru = false;
    const tx = this.db.transaction((): string => {
      const ident = this.db
        .prepare("SELECT user_id FROM oauth_identities WHERE provider = 'google' AND sub = ?")
        .get(claims.sub) as { user_id: string } | undefined;
      if (ident) return ident.user_id;
      if (!claims.emailVerified) throw new AkunError('GOOGLE_EMAIL_BELUM_TERVERIFIKASI');
      const ada = this.userByEmail(email);
      let userId: string;
      if (ada) {
        userId = ada.id;
        if (!ada.email_verified_at) {
          this.db
            .prepare('UPDATE users SET email_verified_at = ?, password_hash = NULL WHERE id = ?')
            .run(this.iso(), userId);
          this.db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(userId);
          this.db
            .prepare('UPDATE email_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL')
            .run(this.iso(), userId);
        }
      } else {
        userId = newId('akun');
        baru = true;
        this.db
          .prepare('INSERT INTO users (id, email, email_verified_at, created_at) VALUES (?,?,?,?)')
          .run(userId, email, this.iso(), this.iso());
      }
      this.db
        .prepare("INSERT INTO oauth_identities (provider, sub, user_id, created_at) VALUES ('google',?,?,?)")
        .run(claims.sub, userId, this.iso());
      return userId;
    });
    const userId = tx.immediate();
    if (baru && claims.name) this.deps.vault.setDataDiri(userId, { namaLengkap: claims.name.slice(0, 200) });
    return {
      token: this.buatSesi(userId, ctx),
      akun: toAkun(this.userById(userId)!),
      next: st.next,
      baru,
    };
  }

  // --- pemeliharaan ---

  /**
   * Bersihkan baris kedaluwarsa: sesi, token email, state OAuth, kunci lama, dan akun yang tidak pernah
   * diverifikasi dalam 7 hari (tanpa identitas Google). Aman dipanggil berkala.
   */
  bersihkan(): number {
    const now = this.iso();
    const idleBatas = this.iso(-this.ttl.sesiIdleSec);
    let n = 0;
    n += this.db
      .prepare('DELETE FROM auth_sessions WHERE expires_at <= ? OR last_seen_at <= ?')
      .run(now, idleBatas).changes;
    n += this.db
      .prepare('DELETE FROM email_tokens WHERE expires_at <= ? OR used_at IS NOT NULL')
      .run(now).changes;
    n += this.db.prepare('DELETE FROM oauth_states WHERE expires_at <= ?').run(now).changes;
    n += this.db.prepare('DELETE FROM auth_lockout WHERE updated_at <= ?').run(this.iso(-24 * 3600)).changes;
    const basi = this.db
      .prepare(
        `SELECT id FROM users WHERE email_verified_at IS NULL AND created_at <= ?
         AND id NOT IN (SELECT user_id FROM oauth_identities)`,
      )
      .all(this.iso(-7 * 24 * 3600)) as { id: string }[];
    for (const { id } of basi) {
      this.deps.vault.shred(id);
      n += this.db.prepare('DELETE FROM users WHERE id = ?').run(id).changes;
    }
    return n;
  }
}
