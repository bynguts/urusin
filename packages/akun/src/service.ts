import { isIPv6 } from 'node:net';
import type { Db } from '@urusin/harness';
import { dataDiriSintetis } from './demo.js';
import { maskEmail, normalizeEmail } from './email.js';
import { AkunError } from './errors.js';
import { GoogleError, type GoogleOidc } from './google.js';
import type { EmailMessage, Mailer } from './mailer.js';
import { hashPassword, needsRehash, periksaSandi, verifyPassword } from './password.js';
import { emailAturUlang, emailGoogleDitautkan, emailSudahTerdaftar, emailVerifikasi } from './templates.js';
import { newId, randomToken, safeEqual, sha256Hex, TOKEN_RE } from './token.js';
import type { RencanaPindah, Vault } from './vault.js';

export type AkunTtl = {
  /** Sesi berakhir bila tidak dipakai selama ini. */
  sesiIdleSec: number;
  /** Sesi berakhir paling lambat ini sejak login, dipakai atau tidak. */
  sesiAbsolutSec: number;
  verifikasiSec: number;
  aturUlangSec: number;
  oauthStateSec: number;
  /** Tamu dihapus sekian lama setelah aktivitas terakhir. */
  tamuSec: number;
  /** Salinan demo juri dihapus sekian lama setelah dibuat. */
  demoSec: number;
  /** Akun sandi yang tidak pernah diverifikasi dihapus setelah ini. */
  belumVerifikasiSec: number;
  /** Token persetujuan "Izinkan isi". */
  izinSec: number;
  /** Batas umur bukti kredensial untuk unduh berkas di sesi yang belum pernah mengunduh. */
  reauthSec: number;
};

export const DEFAULT_TTL: AkunTtl = Object.freeze({
  sesiIdleSec: 7 * 24 * 3600,
  sesiAbsolutSec: 30 * 24 * 3600,
  verifikasiSec: 24 * 3600,
  aturUlangSec: 30 * 60,
  oauthStateSec: 10 * 60,
  tamuSec: 72 * 3600,
  demoSec: 24 * 3600,
  belumVerifikasiSec: 24 * 3600,
  izinSec: 5 * 60,
  reauthSec: 15 * 60,
});

export type Limiter = { consume(key: string): { ok: boolean; retryAfterSec: number } };
export type LimitRule = { limit: number; windowMs: number };
type Aksi = 'masuk' | 'daftar' | 'lupa' | 'kirimUlang' | 'token';

const MENIT = 60_000;
const JAM = 60 * MENIT;
/** Batas laju per aksi: per IP dan per email (kunci = hash email ternormalisasi). */
export const DEFAULT_LIMITS: Record<Aksi, { ip: LimitRule; email?: LimitRule }> = {
  masuk: { ip: { limit: 20, windowMs: 15 * MENIT }, email: { limit: 10, windowMs: 15 * MENIT } },
  daftar: { ip: { limit: 20, windowMs: JAM }, email: { limit: 3, windowMs: JAM } },
  lupa: { ip: { limit: 20, windowMs: JAM }, email: { limit: 3, windowMs: JAM } },
  kirimUlang: { ip: { limit: 20, windowMs: JAM }, email: { limit: 3, windowMs: JAM } },
  token: { ip: { limit: 30, windowMs: 15 * MENIT } },
};

/**
 * Penguncian login per email dalam jendela 15 menit: Turnstile wajib setelah 3 kegagalan, sandi dikunci
 * 15 menit setelah 5 kegagalan (sementara, agar tidak bisa dipakai mengunci akun orang lain selamanya).
 */
/**
 * Penguncian per email: Turnstile setelah 3 kegagalan; mulai kegagalan ke-5 kunci 30 detik, berlipat tiap
 * kegagalan berikutnya, paling lama 1 jam. Hitungan mulai dari nol 15 menit setelah kegagalan/kunci terakhir.
 */
export const LOCKOUT = Object.freeze({
  jendelaSec: 900,
  turnstileSetelah: 3,
  kunciSetelah: 5,
  kunciAwalSec: 30,
  kunciMaksSec: 3600,
});

/** Batas pembuatan pemilik sementara (host bersama, do-no-harm). */
export type Kuota = { tamuPerIpHari: number; demoPerIpHari: number; demoAktifMaks: number };
export const DEFAULT_KUOTA: Kuota = Object.freeze({
  tamuPerIpHari: 20,
  demoPerIpHari: 3,
  demoAktifMaks: 200,
});

/** Email dianggap tertunda selama ini setelah satu kegagalan kirim (kuota habis, DNS belum siap). */
const TERTUNDA_MS = 15 * MENIT;
/** Batas tunggu kirim email sinkron (daftar) sebelum dianggap tertunda. */
const TUNGGU_EMAIL_MS = 8_000;

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
  kuota?: Partial<Kuota>;
  now?: () => Date;
  /** Hapus satu urusan beserta rantainya (web: `store.deleteUrusan`, menyisakan tombstone). */
  hapusUrusan?: (urusanId: string) => void;
  log?: (line: string) => void;
  /** Alert operator (email tertunda, penyimpanan penuh). Default: log berawalan [ALERT]. */
  alert?: (pesan: string) => void;
};

export type JenisPengguna = 'akun' | 'tamu' | 'demo';

export type Akun = {
  id: string;
  jenis: JenisPengguna;
  /** null untuk tamu dan demo. */
  email: string | null;
  emailVerifiedAt: string | null;
  punyaSandi: boolean;
  createdAt: string;
};

export type KonteksPermintaan = { ip: string; userAgent?: string | null | undefined };

type UserRow = {
  id: string;
  jenis: JenisPengguna;
  email: string | null;
  email_verified_at: string | null;
  password_hash: string | null;
  sid_hash: string | null;
  created_at: string;
  expires_at: string | null;
};

const toAkun = (r: UserRow): Akun => ({
  id: r.id,
  jenis: r.jenis,
  email: r.email,
  emailVerifiedAt: r.email_verified_at,
  punyaSandi: r.password_hash !== null,
  createdAt: r.created_at,
});

/** Hash cookie urusin_sid (dipakai juga pengendali Pendamping sebagai hash pemilik sesi). */
export const hashSid = (sid: string): string => sha256Hex(`sid|${sid}`);
/**
 * Kunci pembatas per IP: IPv4 apa adanya, IPv6 dipotong ke /64 (satu pelanggan biasanya memegang seluruh /64,
 * jadi berganti alamat di dalamnya tidak boleh mereset kuota). IPv4-mapped (`::ffff:a.b.c.d`) → IPv4.
 */
export function kunciIp(ip: string): string {
  const v4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (v4) return v4[1]!;
  const bersih = ip.split('%')[0]!.toLowerCase();
  if (!isIPv6(bersih)) return ip;
  const ekor = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(bersih); // IPv4 tertanam = 2 hextet
  const o = ekor ? ekor.slice(1).map(Number) : [];
  const teks = ekor
    ? `${bersih.slice(0, -ekor[0].length)}${((o[0]! << 8) | o[1]!).toString(16)}:${((o[2]! << 8) | o[3]!).toString(16)}`
    : bersih;
  const [kiri, kanan] = teks.split('::') as [string, string | undefined];
  const a = kiri ? kiri.split(':') : [];
  const b = kanan ? kanan.split(':') : [];
  const penuh = kanan === undefined ? a : [...a, ...Array<string>(8 - a.length - b.length).fill('0'), ...b];
  return `${penuh
    .slice(0, 4)
    .map((h) => parseInt(h || '0', 16).toString(16))
    .join(':')}::/64`;
}

const hashIp = (ip: string): string => sha256Hex(`ip|${kunciIp(ip)}`);

/** Hash kanonik daftar write "Izinkan isi": nama field unik, terurut, dipisah baris baru. */
export function hashDaftarWrite(fields: readonly string[]): string {
  return sha256Hex([...new Set(fields)].sort().join('\n'));
}

/**
 * Pengikat ulang pemilik saat rotasi `urusin_sid` (tamu → akun, atau login akun belum terverifikasi).
 * Dijalankan DI DALAM transaksi rotasi (sinkron, better-sqlite3); melempar = seluruh rotasi dibatalkan.
 * Pengendali Pendamping mendaftarkan pengikat untuk tabel sesi miliknya (hash pemilik lama → baru).
 */
export type PengikatPemilik = (p: { hashLama: string; hashBaru: string; userId: string | null }) => void;

export type HasilGoogle =
  | { jenis: 'masuk'; token: string; akun: Akun; next: string; baru: boolean }
  | { jenis: 'perlu-tautkan'; tiket: string; next: string };

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
 * Layanan akun: alur email + sandi dan Google, sesi, pemilik sementara (tamu, demo), kepemilikan urusan,
 * rotasi pemilik, token persetujuan isi, hapus akun, dan penyapu. Tidak ada respons yang membedakan
 * "email terdaftar" dari "tidak terdaftar".
 */
export class AkunService {
  private readonly db: Db;
  private readonly ttl: AkunTtl;
  private readonly kuota: Kuota;
  private readonly now: () => Date;
  private readonly log: (line: string) => void;
  private readonly alert: (pesan: string) => void;
  private readonly lim: Record<Aksi, { ip: Limiter; email?: Limiter | undefined }>;
  private readonly inflight = new Set<Promise<boolean>>();
  private readonly pengikat: PengikatPemilik[] = [];
  /** Hash sandi acak untuk menyamakan waktu respons saat email tidak dikenal. */
  private dummyHash: Promise<string> | undefined;
  private tertundaSampai = 0;

  constructor(private readonly deps: AkunDeps) {
    this.db = deps.db;
    this.ttl = { ...DEFAULT_TTL, ...deps.ttl };
    this.kuota = { ...DEFAULT_KUOTA, ...deps.kuota };
    this.now = deps.now ?? (() => new Date());
    this.log = deps.log ?? (() => undefined);
    this.alert = deps.alert ?? ((p) => this.log(`[ALERT] ${p}`));
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

  /** Mode email aktif (`resend` atau `log`); `memory` hanya di tes. */
  get modeEmail(): Mailer['kind'] {
    return this.deps.mailer.kind;
  }

  /**
   * true bila email ditahan (mode log di produksi: Resend belum dikonfigurasi) atau pengiriman terakhir gagal
   * (kuota habis, DNS/domain belum siap) dalam 15 menit terakhir.
   */
  get emailTertunda(): boolean {
    return this.deps.mailer.ditahan === true || this.now().getTime() < this.tertundaSampai;
  }

  /** Daftarkan pengikat ulang pemilik (Pendamping). */
  daftarPengikatPemilik(fn: PengikatPemilik): void {
    this.pengikat.push(fn);
  }

  // --- utilitas ---

  private iso(offsetSec = 0): string {
    return new Date(this.now().getTime() + offsetSec * 1000).toISOString();
  }

  private tx<T>(fn: () => T): T {
    return this.db.transaction(fn).immediate();
  }

  private batasi(aksi: Aksi, ctx: KonteksPermintaan, email?: string): void {
    const l = this.lim[aksi];
    const hasil = [l.ip.consume(`${aksi}:ip:${kunciIp(ctx.ip)}`)];
    if (email && l.email) hasil.push(l.email.consume(`${aksi}:email:${sha256Hex(email)}`));
    const kena = hasil.find((h) => !h.ok);
    if (kena) throw new AkunError('RATE_LIMITED', kena.retryAfterSec);
  }

  private emailAtauGagal(raw: string): string {
    const email = normalizeEmail(raw);
    if (!email) throw new AkunError('EMAIL_TIDAK_VALID');
    return email;
  }

  private sandiAtauGagal(sandi: string, email?: string | null): void {
    const masalah = periksaSandi(sandi, email ?? undefined);
    if (masalah) throw new AkunError(masalah);
  }

  /**
   * Kirim email di latar (waktu respons tidak bergantung penyedia). Kegagalan (kuota habis, domain belum
   * terverifikasi) menandai email "tertunda" 15 menit + alert operator; tidak ada fallback berbayar.
   */
  private kirim(msg: EmailMessage): Promise<boolean> {
    const p: Promise<boolean> = this.deps.mailer
      .send(msg)
      .then(() => {
        this.tertundaSampai = 0;
        return true;
      })
      .catch((e: unknown) => {
        const baru = !this.emailTertunda;
        this.tertundaSampai = this.now().getTime() + TERTUNDA_MS;
        this.log(`[akun] email ${msg.jenis} ke ${maskEmail(msg.to)} gagal: ${(e as Error).message}`);
        if (baru) this.alert(`email tertunda: ${(e as Error).message}`);
        return false;
      })
      .finally(() => this.inflight.delete(p));
    this.inflight.add(p);
    return p;
  }

  /** Kirim lalu tunggu (paling lama 8 detik). false = tertunda. */
  private async kirimDanTunggu(msg: EmailMessage): Promise<boolean> {
    let t: ReturnType<typeof setTimeout> | undefined;
    const batas = new Promise<boolean>((r) => {
      t = setTimeout(() => r(false), TUNGGU_EMAIL_MS);
      t.unref?.();
    });
    try {
      return await Promise.race([this.kirim(msg), batas]);
    } finally {
      clearTimeout(t);
    }
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
    return this.db.prepare("SELECT * FROM users WHERE email = ? AND jenis = 'akun'").get(email) as
      UserRow | undefined;
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

  /**
   * Pemilik vault yang "sinkron antar perangkat": akun terverifikasi dan salinan demo. Akun yang emailnya
   * belum terverifikasi berperilaku seperti tamu (vault satu perangkat, terikat urusin_sid).
   */
  sinkron(a: Akun | undefined): boolean {
    return a !== undefined && (a.jenis === 'demo' || (a.jenis === 'akun' && a.emailVerifiedAt !== null));
  }

  private async samarkanWaktu(sandi: string): Promise<void> {
    this.dummyHash ??= hashPassword(randomToken());
    await verifyPassword(await this.dummyHash, sandi);
  }

  // --- tamu (dibuat malas) dan salinan demo ---

  /** Tamu milik cookie urusin_sid (belum kedaluwarsa), tanpa membuat. */
  tamuDariSid(sid: string | undefined): string | undefined {
    if (!sid) return undefined;
    const r = this.db
      .prepare("SELECT id FROM users WHERE jenis = 'tamu' AND sid_hash = ? AND expires_at > ?")
      .get(hashSid(sid), this.iso()) as { id: string } | undefined;
    return r?.id;
  }

  /**
   * Tamu milik cookie urusin_sid; dibuat bila belum ada (hanya pada tulis vault pertama atau /turn pertama:
   * menjelajah saja tidak pernah membuat baris). Paling banyak `tamuPerIpHari` tamu baru per IP per 24 jam.
   * Setiap panggilan memperpanjang umur tamu 24 jam sejak aktivitas ini.
   */
  pastikanTamu(sid: string, ctx: KonteksPermintaan): string {
    const sh = hashSid(sid);
    const kedaluwarsa = this.iso(this.ttl.tamuSec);
    return this.tx(() => {
      const ada = this.db
        .prepare("SELECT id, expires_at FROM users WHERE jenis = 'tamu' AND sid_hash = ?")
        .get(sh) as { id: string; expires_at: string } | undefined;
      if (ada && ada.expires_at > this.iso()) return ada.id; // umur mutlak: aktivitas tidak memperpanjang
      if (ada) this.hapusPemilikDb(ada.id); // kedaluwarsa tetapi belum disapu
      const ih = hashIp(ctx.ip);
      const n = (
        this.db
          .prepare(
            "SELECT COUNT(*) AS n FROM users WHERE jenis = 'tamu' AND asal_ip_hash = ? AND created_at > ?",
          )
          .get(ih, this.iso(-24 * 3600)) as { n: number }
      ).n;
      if (n >= this.kuota.tamuPerIpHari) throw new AkunError('TAMU_PENUH');
      const id = newId('tamu');
      this.db
        .prepare(
          `INSERT INTO users (id, jenis, sid_hash, asal_ip_hash, created_at, expires_at)
           VALUES (?, 'tamu', ?, ?, ?, ?)`,
        )
        .run(id, sh, ih, this.iso(), kedaluwarsa);
      return id;
    });
  }

  /**
   * "Masuk sebagai juri": salinan demo terisolasi berisi Data Diri sintetis, berumur 24 jam. Paling banyak
   * `demoPerIpHari` per IP per 24 jam dan `demoAktifMaks` aktif sekaligus. Turnstile diperiksa pemanggil.
   */
  buatDemo(ctx: KonteksPermintaan): { token: string; akun: Akun } {
    const ih = hashIp(ctx.ip);
    const id = this.tx(() => {
      const perIp = (
        this.db
          .prepare(
            "SELECT COUNT(*) AS n FROM users WHERE jenis = 'demo' AND asal_ip_hash = ? AND created_at > ?",
          )
          .get(ih, this.iso(-24 * 3600)) as { n: number }
      ).n;
      if (perIp >= this.kuota.demoPerIpHari) throw new AkunError('DEMO_BATAS_IP');
      const aktif = (
        this.db
          .prepare("SELECT COUNT(*) AS n FROM users WHERE jenis = 'demo' AND expires_at > ?")
          .get(this.iso()) as { n: number }
      ).n;
      if (aktif >= this.kuota.demoAktifMaks) throw new AkunError('DEMO_PENUH');
      const baru = newId('demo');
      this.db
        .prepare(
          `INSERT INTO users (id, jenis, asal_ip_hash, created_at, expires_at) VALUES (?, 'demo', ?, ?, ?)`,
        )
        .run(baru, ih, this.iso(), this.iso(this.ttl.demoSec));
      return baru;
    });
    this.deps.vault.setDataDiri(id, dataDiriSintetis());
    return { token: this.buatSesi(id, ctx), akun: toAkun(this.userById(id)!) };
  }

  // --- token email ---

  private terbitkanToken(
    userId: string,
    purpose: 'verify' | 'reset',
    passwordHash: string | null = null,
  ): string {
    const token = randomToken();
    const ttl = purpose === 'verify' ? this.ttl.verifikasiSec : this.ttl.aturUlangSec;
    this.tx(() => {
      // Hanya tautan terbaru yang berlaku.
      this.db
        .prepare('UPDATE email_tokens SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL')
        .run(this.iso(), userId, purpose);
      this.db
        .prepare(
          `INSERT INTO email_tokens (token_hash, user_id, purpose, password_hash, created_at, expires_at)
           VALUES (?,?,?,?,?,?)`,
        )
        .run(sha256Hex(token), userId, purpose, passwordHash, this.iso(), this.iso(ttl));
    });
    return token;
  }

  private tokenAktif(
    token: string,
    purpose: 'verify' | 'reset',
  ): { user_id: string; password_hash: string | null } | undefined {
    if (!TOKEN_RE.test(token)) return undefined;
    return this.db
      .prepare(
        `SELECT user_id, password_hash FROM email_tokens
         WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?`,
      )
      .get(sha256Hex(token), purpose, this.iso()) as
      { user_id: string; password_hash: string | null } | undefined;
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

  /** Token masih berlaku? (untuk halaman sebelum formulir dikirim; tidak memakai token). */
  tokenBerlaku(token: string, purpose: 'verify' | 'reset'): boolean {
    return this.tokenAktif(token, purpose) !== undefined;
  }

  // --- daftar dan verifikasi ---

  /**
   * Daftar dengan email + sandi. Hasil SELALU sama ("cek email Anda"), apa pun keadaan email:
   * - baru: buat akun belum terverifikasi + kirim tautan verifikasi;
   * - sudah ada tapi belum terverifikasi: TIDAK memblokir. Tautan verifikasi baru membawa sandi yang dipilih
   *   sekarang; sandi lama baru batal saat alamat terverifikasi (pemilik kotak surat + sandi baru);
   * - sudah terverifikasi: kirim email "akun sudah ada" (tanpa mengubah apa pun).
   * Setiap cabang mengirim satu email dan menunggunya: `tertunda` = email gagal/terlambat (pesan jujur).
   */
  async daftar(
    input: { email: string; sandi: string },
    ctx: KonteksPermintaan,
  ): Promise<{ tertunda: boolean }> {
    const email = this.emailAtauGagal(input.email);
    this.sandiAtauGagal(input.sandi, email);
    this.batasi('daftar', ctx, email);
    const hash = await hashPassword(input.sandi); // selalu di-hash: waktu respons sama untuk semua cabang
    const ada = this.userByEmail(email);
    let msg: EmailMessage;
    if (ada?.email_verified_at) {
      msg = emailSudahTerdaftar(email, this.link('/masuk'), this.link('/lupa-sandi'));
    } else {
      let userId: string;
      if (ada) userId = ada.id;
      else {
        userId = newId('akun');
        this.db
          .prepare(
            "INSERT INTO users (id, jenis, email, password_hash, created_at) VALUES (?, 'akun', ?, ?, ?)",
          )
          .run(userId, email, hash, this.iso());
      }
      msg = emailVerifikasi(
        email,
        this.link('/verifikasi-email', this.terbitkanToken(userId, 'verify', hash)),
      );
    }
    return { tertunda: !(await this.kirimDanTunggu(msg)) || this.emailTertunda };
  }

  /**
   * Klik tautan verifikasi + kata sandi. Token sekali pakai (24 jam). Sandi yang diminta = sandi dari daftar
   * yang menerbitkan tautan (atau sandi akun untuk tautan kirim ulang): tautan yang terkirim ke kotak surat
   * korban dari daftar orang lain tidak bisa diselesaikan tanpa sandi orang itu (anti pra-pembajakan).
   * Berhasil → sandi itu berlaku, sandi lain batal, SEMUA sesi akun dihapus, tautan verifikasi lain batal.
   * Sandi salah tidak membakar token dan dihitung ke penguncian email.
   */
  async verifikasiEmail(token: string, sandi: string, ctx: KonteksPermintaan): Promise<Akun> {
    this.batasi('token', ctx);
    const t = this.tokenAktif(token, 'verify');
    if (!t) throw new AkunError('TOKEN_TIDAK_VALID');
    const u = this.userById(t.user_id)!;
    this.periksaKunci(u.email!);
    this.catatPercobaan(u.email!);
    const hash = t.password_hash ?? u.password_hash;
    if (!hash || sandi.length === 0 || sandi.length > 1024 || !(await verifyPassword(hash, sandi)))
      throw new AkunError('KREDENSIAL_SALAH');
    const userId = this.pakaiToken(token, 'verify');
    this.tx(() => {
      this.db
        .prepare(
          'UPDATE users SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?',
        )
        .run(hash, this.iso(), userId);
      this.db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(userId);
      this.db
        .prepare(
          "UPDATE email_tokens SET used_at = ? WHERE user_id = ? AND purpose = 'verify' AND used_at IS NULL",
        )
        .run(this.iso(), userId);
      if (!u.email_verified_at) this.cabutIdentitas(userId); // kepemilikan berpindah ke pemilik kotak surat
    });
    this.bukaKunci(u.email!);
    return toAkun(this.userById(userId)!);
  }

  /** Kirim ulang tautan verifikasi (meminta sandi akun saat ini). Respons selalu sama. */
  async kirimUlangVerifikasi(rawEmail: string, ctx: KonteksPermintaan): Promise<{ tertunda: boolean }> {
    const email = this.emailAtauGagal(rawEmail);
    this.batasi('kirimUlang', ctx, email);
    const u = this.userByEmail(email);
    if (u && !u.email_verified_at && u.password_hash)
      void this.kirim(
        emailVerifikasi(email, this.link('/verifikasi-email', this.terbitkanToken(u.id, 'verify'))),
      );
    return { tertunda: this.emailTertunda };
  }

  // --- masuk, penguncian, sesi ---

  private lockKey(email: string): string {
    return sha256Hex(`lockout|${email}`);
  }

  private bacaKunci(
    email: string,
  ): { failures: number; window_start: string; locked_until: string | null } | undefined {
    const r = this.db
      .prepare('SELECT failures, window_start, locked_until, updated_at FROM auth_lockout WHERE key = ?')
      .get(this.lockKey(email)) as
      { failures: number; window_start: string; locked_until: string | null; updated_at: string } | undefined;
    if (!r) return undefined;
    // 15 menit setelah kegagalan terakhir dan setelah kunci habis: hitungan mulai dari nol.
    const terakhir = r.locked_until && r.locked_until > r.updated_at ? r.locked_until : r.updated_at;
    if (terakhir <= this.iso(-LOCKOUT.jendelaSec)) return undefined;
    return r;
  }

  private periksaKunci(email: string): void {
    const r = this.bacaKunci(email);
    if (r?.locked_until && r.locked_until > this.iso()) {
      const sisa = Math.ceil((Date.parse(r.locked_until) - this.now().getTime()) / 1000);
      throw new AkunError('TERKUNCI', Math.max(1, sisa));
    }
  }

  /** Turnstile wajib untuk email ini (≥ 3 kegagalan dalam jendela). Sama untuk email terdaftar maupun tidak. */
  perluTurnstile(rawEmail: string): boolean {
    const email = normalizeEmail(rawEmail);
    if (!email) return false;
    return (this.bacaKunci(email)?.failures ?? 0) >= LOCKOUT.turnstileSetelah;
  }

  /**
   * Catat percobaan sandi SEBELUM verifikasi (atomik: `UPDATE ... RETURNING`), lalu pasang kunci bila perlu.
   * Percobaan paralel tidak bisa lolos sebelum kegagalan sebelumnya tercatat: percobaan di atas ambang langsung
   * TERKUNCI tanpa verifikasi. Berhasil → `bukaKunci` menghapus hitungan.
   */
  private catatPercobaan(email: string): number {
    const key = this.lockKey(email);
    const now = this.iso();
    if (!this.bacaKunci(email)) this.db.prepare('DELETE FROM auth_lockout WHERE key = ?').run(key);
    const { failures } = this.db
      .prepare(
        `INSERT INTO auth_lockout (key, failures, window_start, locked_until, updated_at) VALUES (?, 1, ?, NULL, ?)
         ON CONFLICT(key) DO UPDATE SET failures = failures + 1, updated_at = excluded.updated_at
         RETURNING failures`,
      )
      .get(key, now, now) as { failures: number };
    if (failures > LOCKOUT.kunciSetelah) {
      const r = this.bacaKunci(email);
      if (r?.locked_until && r.locked_until > now) {
        this.db.prepare('UPDATE auth_lockout SET failures = failures - 1 WHERE key = ?').run(key);
        const sisa = Math.ceil((Date.parse(r.locked_until) - this.now().getTime()) / 1000);
        throw new AkunError('TERKUNCI', Math.max(1, sisa));
      }
    }
    if (failures >= LOCKOUT.kunciSetelah) {
      const detik = Math.min(
        LOCKOUT.kunciMaksSec,
        LOCKOUT.kunciAwalSec * 2 ** (failures - LOCKOUT.kunciSetelah),
      );
      this.db.prepare('UPDATE auth_lockout SET locked_until = ? WHERE key = ?').run(this.iso(detik), key);
    }
    return failures;
  }

  private bukaKunci(email: string): void {
    this.db.prepare('DELETE FROM auth_lockout WHERE key = ?').run(this.lockKey(email));
  }

  /**
   * Masuk dengan email + sandi. Email tak dikenal, akun tanpa sandi (Google saja), dan sandi salah
   * menghasilkan galat dan waktu yang sama. Setelah 3 kegagalan Turnstile wajib (`turnstileOk`), setelah 5
   * sandi email itu dikunci 15 menit. Akun yang belum terverifikasi BOLEH masuk; ia berperilaku seperti tamu
   * (vault satu perangkat) sampai alamatnya terverifikasi.
   */
  async masuk(
    input: { email: string; sandi: string },
    ctx: KonteksPermintaan & { turnstileOk?: boolean },
  ): Promise<{ token: string; akun: Akun }> {
    const email = normalizeEmail(input.email);
    if (!email || input.sandi.length === 0 || input.sandi.length > 1024) {
      throw new AkunError('KREDENSIAL_SALAH');
    }
    this.batasi('masuk', ctx, email);
    this.periksaKunci(email);
    if (this.perluTurnstile(email) && !ctx.turnstileOk) throw new AkunError('TURNSTILE_WAJIB');
    this.catatPercobaan(email);
    const u = this.userByEmail(email);
    const cocok = u?.password_hash
      ? await verifyPassword(u.password_hash, input.sandi)
      : (await this.samarkanWaktu(input.sandi), false);
    if (!u || !cocok) throw new AkunError('KREDENSIAL_SALAH');
    this.bukaKunci(email);
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
        `INSERT INTO auth_sessions (token_hash, user_id, created_at, last_seen_at, expires_at, auth_at, user_agent)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .run(
        sha256Hex(token),
        userId,
        this.iso(),
        this.iso(),
        this.iso(this.ttl.sesiAbsolutSec),
        this.iso(),
        ringkasUserAgent(ctx.userAgent),
      );
    return token;
  }

  /** Validasi token cookie. Kedaluwarsa (idle, absolut, atau pemilik demo habis) → dihapus dan null. */
  sesi(token: string | undefined): {
    akun: Akun;
    tokenHash: string;
    kedaluwarsa: string;
    authAt: string;
    pernahUnduh: boolean;
  } | null {
    if (!token || !TOKEN_RE.test(token)) return null;
    const hash = sha256Hex(token);
    const s = this.db
      .prepare(
        'SELECT user_id, last_seen_at, expires_at, auth_at, pernah_unduh FROM auth_sessions WHERE token_hash = ?',
      )
      .get(hash) as
      | { user_id: string; last_seen_at: string; expires_at: string; auth_at: string; pernah_unduh: number }
      | undefined;
    if (!s) return null;
    const now = this.now().getTime();
    const u = this.userById(s.user_id);
    const idleHabis = Date.parse(s.last_seen_at) + this.ttl.sesiIdleSec * 1000 <= now;
    const pemilikHabis = !u || (u.expires_at !== null && Date.parse(u.expires_at) <= now);
    if (idleHabis || Date.parse(s.expires_at) <= now || pemilikHabis) {
      this.db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(hash);
      return null;
    }
    // Perpanjang idle paling sering sekali per menit (hemat tulisan).
    if (now - Date.parse(s.last_seen_at) > 60_000) {
      this.db.prepare('UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?').run(this.iso(), hash);
    }
    return {
      akun: toAkun(u),
      tokenHash: hash,
      kedaluwarsa: u.expires_at && u.expires_at < s.expires_at ? u.expires_at : s.expires_at,
      authAt: s.auth_at,
      pernahUnduh: s.pernah_unduh === 1,
    };
  }

  /** Konfirmasi sandi untuk sesi ini (re-auth sebelum unduh berkas). Ikut penguncian email. */
  async konfirmasiSandi(userId: string, tokenHash: string, sandi: string): Promise<void> {
    const u = this.userById(userId);
    if (!u || u.jenis !== 'akun') throw new AkunError('HANYA_AKUN');
    if (!u.password_hash) throw new AkunError('PERLU_MASUK_ULANG');
    this.periksaKunci(u.email!);
    this.catatPercobaan(u.email!);
    if (sandi.length === 0 || sandi.length > 1024 || !(await verifyPassword(u.password_hash, sandi)))
      throw new AkunError('KREDENSIAL_SALAH');
    this.bukaKunci(u.email!);
    this.db
      .prepare('UPDATE auth_sessions SET auth_at = ? WHERE token_hash = ? AND user_id = ?')
      .run(this.iso(), tokenHash, userId);
  }

  /**
   * Boleh mengunduh berkas vault di sesi ini? Sesi yang belum pernah mengunduh ("perangkat baru") butuh bukti
   * kredensial ≤ 15 menit (login, konfirmasi sandi, atau Google). Unduhan pertama menandai sesi.
   */
  izinkanUnduh(s: { tokenHash: string; authAt: string; pernahUnduh: boolean; akun: Akun }): void {
    if (s.akun.jenis !== 'akun' || s.pernahUnduh) return;
    if (Date.parse(s.authAt) + this.ttl.reauthSec * 1000 < this.now().getTime())
      throw new AkunError('PERLU_MASUK_ULANG');
    this.db.prepare('UPDATE auth_sessions SET pernah_unduh = 1 WHERE token_hash = ?').run(s.tokenHash);
  }

  keluar(token: string | undefined): void {
    if (!token || !TOKEN_RE.test(token)) return;
    this.db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(sha256Hex(token));
  }

  /** "Keluar dari semua perangkat". Mengembalikan jumlah sesi yang dihapus. */
  keluarSemua(userId: string): number {
    // Tautan Google yang ditambahkan kemudian (mungkin dari sesi curian) ikut dicabut; identitas asal tetap.
    this.db.prepare("DELETE FROM oauth_identities WHERE user_id = ? AND asal = 'tautan'").run(userId);
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
  async lupaSandi(rawEmail: string, ctx: KonteksPermintaan): Promise<{ tertunda: boolean }> {
    const email = this.emailAtauGagal(rawEmail);
    this.batasi('lupa', ctx, email);
    const u = this.userByEmail(email);
    if (u)
      void this.kirim(
        emailAturUlang(email, this.link('/atur-ulang-sandi', this.terbitkanToken(u.id, 'reset'))),
      );
    return { tertunda: this.emailTertunda };
  }

  /**
   * Atur ulang sandi dengan token reset. Sandi diperiksa DULU (token tidak terbakar oleh sandi yang ditolak).
   * Berhasil → semua sesi akun dihapus, email dianggap terverifikasi (pemilik kotak surat memilih sandi),
   * tautan verifikasi lama batal, kunci dibuka.
   */
  async aturUlangSandi(token: string, sandiBaru: string, ctx: KonteksPermintaan): Promise<Akun> {
    this.batasi('token', ctx);
    const t = this.tokenAktif(token, 'reset');
    if (!t) throw new AkunError('TOKEN_TIDAK_VALID');
    this.sandiAtauGagal(sandiBaru, this.userById(t.user_id)!.email);
    const hash = await hashPassword(sandiBaru);
    const userId = this.pakaiToken(token, 'reset');
    this.tx(() => {
      this.db
        .prepare(
          'UPDATE users SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?',
        )
        .run(hash, this.iso(), userId);
      this.db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(userId);
      this.db
        .prepare('UPDATE email_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL')
        .run(this.iso(), userId);
      this.cabutIdentitas(userId); // tautan Google (mungkin milik penyerang) dicabut; warga bisa menautkan lagi
    });
    const u = this.userById(userId)!;
    this.bukaKunci(u.email!);
    return toAkun(u);
  }

  /**
   * Ubah sandi saat sudah masuk (akun saja). Akun bersandi wajib menyebut sandi lama; akun Google-saja boleh
   * membuat sandi. Semua sesi lain dihapus dan sesi ini dirotasi: mengembalikan token baru.
   */
  async ubahSandi(
    userId: string,
    input: { sandiLama?: string | undefined; sandiBaru: string },
    ctx: KonteksPermintaan,
  ): Promise<string> {
    const u = this.userById(userId);
    if (!u) throw new AkunError('BELUM_MASUK');
    if (u.jenis !== 'akun') throw new AkunError('HANYA_AKUN');
    if (u.password_hash) {
      const ok = input.sandiLama ? await verifyPassword(u.password_hash, input.sandiLama) : false;
      if (!ok) throw new AkunError('SANDI_LAMA_SALAH');
    }
    this.sandiAtauGagal(input.sandiBaru, u.email);
    const hash = await hashPassword(input.sandiBaru);
    this.tx(() => {
      this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
      this.db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(userId);
    });
    return this.buatSesi(userId, ctx);
  }

  // --- hapus akun dan penyapu ---

  private hapusUrusanSemua(ids: string[]): void {
    const hapus =
      this.deps.hapusUrusan ?? ((id: string) => this.db.prepare('DELETE FROM urusan WHERE id = ?').run(id));
    for (const id of ids) hapus(id);
  }

  /** Urusan, vault (DB), dan baris pemilik; berkas dihapus terpisah setelah commit. */
  private hapusPemilikDb(userId: string): void {
    const u = this.userById(userId);
    if (!u) return;
    const urusan = (
      this.db
        .prepare(
          'SELECT urusan_id FROM urusan_owner WHERE user_id = ? OR (guest_sid_hash IS NOT NULL AND guest_sid_hash = ?)',
        )
        .all(userId, u.sid_hash) as { urusan_id: string }[]
    ).map((r) => r.urusan_id);
    this.hapusUrusanSemua(urusan);
    this.deps.vault.shredDb(userId);
    this.db.prepare('DELETE FROM users WHERE id = ?').run(userId); // cascade: sesi, token, identitas, izin
  }

  private hapusPemilik(userId: string): void {
    this.tx(() => this.hapusPemilikDb(userId));
    this.deps.vault.hapusBerkas(userId);
  }

  private lipatWal(): void {
    // Lipat WAL ke berkas utama agar halaman lama (berisi baris terhapus) tidak tertinggal di -wal.
    try {
      this.db.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      // DB memori / bukan WAL: tidak ada yang perlu dilipat
    }
  }

  /**
   * Hapus akun (atau salinan demo): urusan milik pemilik (dengan tombstone), vault (crypto-shred DEK + berkas),
   * sesi, token, identitas Google, dan baris pemilik. Akun bersandi wajib menyebut sandinya.
   */
  async hapusAkun(userId: string, input: { konfirmasi: string; sandi?: string | undefined }): Promise<void> {
    const u = this.userById(userId);
    if (!u) throw new AkunError('BELUM_MASUK');
    if (input.konfirmasi !== 'HAPUS') throw new AkunError('KONFIRMASI_SALAH');
    if (u.password_hash) {
      const ok = input.sandi ? await verifyPassword(u.password_hash, input.sandi) : false;
      if (!ok) throw new AkunError('SANDI_LAMA_SALAH');
    }
    this.hapusPemilik(userId);
    if (u.email) this.bukaKunci(u.email);
    this.lipatWal();
  }

  /**
   * Penyapu (dipanggil tiap jam): sesi/token/state kedaluwarsa, tamu 24 jam sejak aktivitas terakhir, salinan
   * demo 24 jam sejak dibuat, dan akun sandi yang tidak terverifikasi 24 jam tanpa tautan verifikasi aktif.
   * Tamu/demo/akun yang disapu kehilangan urusan, vault (crypto-shred), dan berkasnya.
   */
  bersihkan(): { tamu: number; demo: number; belumVerifikasi: number; lain: number } {
    const now = this.iso();
    const idleBatas = this.iso(-this.ttl.sesiIdleSec);
    let lain = 0;
    lain += this.db
      .prepare('DELETE FROM auth_sessions WHERE expires_at <= ? OR last_seen_at <= ?')
      .run(now, idleBatas).changes;
    lain += this.db
      .prepare('DELETE FROM email_tokens WHERE expires_at <= ? OR used_at IS NOT NULL')
      .run(now).changes;
    lain += this.db.prepare('DELETE FROM oauth_states WHERE expires_at <= ?').run(now).changes;
    lain += this.db.prepare('DELETE FROM oauth_link_pending WHERE expires_at <= ?').run(now).changes;
    lain += this.db
      .prepare('DELETE FROM pii_izin WHERE expires_at <= ? OR used_at IS NOT NULL')
      .run(now).changes;
    lain += this.db
      .prepare('DELETE FROM auth_lockout WHERE updated_at <= ?')
      .run(this.iso(-24 * 3600)).changes;
    const sapu = (sql: string, ...args: string[]) => {
      const ids = (this.db.prepare(sql).all(...args) as { id: string }[]).map((r) => r.id);
      for (const id of ids) this.hapusPemilik(id);
      return ids.length;
    };
    const tamu = sapu("SELECT id FROM users WHERE jenis = 'tamu' AND expires_at <= ?", now);
    const demo = sapu("SELECT id FROM users WHERE jenis = 'demo' AND expires_at <= ?", now);
    const belumVerifikasi = sapu(
      `SELECT id FROM users u WHERE jenis = 'akun' AND email_verified_at IS NULL AND created_at <= ?
       AND NOT EXISTS (SELECT 1 FROM email_tokens t WHERE t.user_id = u.id AND t.purpose = 'verify'
                       AND t.used_at IS NULL AND t.expires_at > ?)`,
      this.iso(-this.ttl.belumVerifikasiSec),
      now,
    );
    if (tamu + demo + belumVerifikasi > 0) this.lipatWal();
    return { tamu, demo, belumVerifikasi, lain };
  }

  // --- kepemilikan urusan dan rotasi pemilik ---

  /** Catat pemilik urusan baru: akun sinkron/demo → user_id; selain itu → hash urusin_sid (tamu). */
  catatPemilikUrusan(urusanId: string, pemilik: { akun?: Akun | undefined; sid?: string | undefined }): void {
    const userId = this.sinkron(pemilik.akun) ? pemilik.akun!.id : null;
    const sh = !userId && pemilik.sid ? hashSid(pemilik.sid) : null;
    if (!userId && !sh) return;
    this.db
      .prepare(
        'INSERT OR IGNORE INTO urusan_owner (urusan_id, user_id, guest_sid_hash, created_at) VALUES (?,?,?,?)',
      )
      .run(urusanId, userId, sh, this.iso());
  }

  /**
   * Rotasi `urusin_sid` saat masuk, dalam SATU transaksi:
   * - `userId` (akun terverifikasi): urusan tamu pindah ke akun; vault tamu dienkripsi ulang dengan DEK akun
   *   lalu DEK tamu dihancurkan dan baris tamu dihapus;
   * - `userId = null` (akun belum terverifikasi = tetap seperti tamu): semua yang terikat hash sid lama
   *   diikat ke hash sid baru;
   * - setiap pengikat terdaftar (Pendamping) mengikat ulang hash pemilik lama → baru.
   * Satu kegagalan membatalkan semuanya (berkas baru dibuang); sid lama tidak lagi memiliki apa pun.
   */
  rotasiPemilik(p: { sidLama: string | undefined; sidBaru: string; userId: string | null }): {
    urusanDipindahkan: number;
    vaultDipindahkan: boolean;
  } {
    if (!p.sidLama || p.sidLama === p.sidBaru) return { urusanDipindahkan: 0, vaultDipindahkan: false };
    const hl = hashSid(p.sidLama);
    const hb = hashSid(p.sidBaru);
    const tamu = this.db.prepare("SELECT id FROM users WHERE jenis = 'tamu' AND sid_hash = ?").get(hl) as
      { id: string } | undefined;
    let rencana: RencanaPindah | undefined;
    if (tamu && p.userId) rencana = this.deps.vault.siapkanPindah(tamu.id, p.userId);
    let urusanDipindahkan = 0;
    try {
      this.tx(() => {
        if (p.userId) {
          urusanDipindahkan = this.db
            .prepare('UPDATE urusan_owner SET user_id = ?, guest_sid_hash = NULL WHERE guest_sid_hash = ?')
            .run(p.userId, hl).changes;
          if (tamu) {
            rencana!.terapkan();
            this.db.prepare('DELETE FROM users WHERE id = ?').run(tamu.id);
          }
        } else {
          urusanDipindahkan = this.db
            .prepare('UPDATE urusan_owner SET guest_sid_hash = ? WHERE guest_sid_hash = ?')
            .run(hb, hl).changes;
          if (tamu) this.db.prepare('UPDATE users SET sid_hash = ? WHERE id = ?').run(hb, tamu.id);
        }
        for (const f of this.pengikat) f({ hashLama: hl, hashBaru: hb, userId: p.userId });
      });
    } catch (e) {
      rencana?.batalkan();
      throw e;
    }
    rencana?.selesai();
    return { urusanDipindahkan, vaultDipindahkan: rencana !== undefined };
  }

  urusanMilik(userId: string): string[] {
    return (
      this.db
        .prepare('SELECT urusan_id FROM urusan_owner WHERE user_id = ? ORDER BY created_at DESC')
        .all(userId) as { urusan_id: string }[]
    ).map((r) => r.urusan_id);
  }

  /**
   * Pemilik vault sebuah urusan, HANYA bila `peminta` adalah pemilik itu: akun sinkron yang sama (`user_id`),
   * atau sid yang sama untuk urusan milik tamu. Selain itu (bukan pemilik, urusan tidak dikenal) → undefined.
   * Dipakai jalur isi Pendamping sebelum menerbitkan atau memakai token persetujuan.
   */
  pemilikVaultUrusan(
    urusanId: string,
    peminta: { akun?: Akun | undefined; sid?: string | undefined },
  ): string | undefined {
    const r = this.db
      .prepare('SELECT user_id, guest_sid_hash FROM urusan_owner WHERE urusan_id = ?')
      .get(urusanId) as { user_id: string | null; guest_sid_hash: string | null } | undefined;
    if (!r) return undefined;
    if (r.user_id)
      return this.sinkron(peminta.akun) && peminta.akun!.id === r.user_id ? r.user_id : undefined;
    if (!peminta.sid || r.guest_sid_hash !== hashSid(peminta.sid)) return undefined;
    return this.tamuDariSid(peminta.sid);
  }

  // --- persetujuan "Izinkan isi" ---

  /** Terbitkan token persetujuan (pesan `pendamping.izinkan` dari pemilik): sekali pakai, 5 menit. */
  terbitkanIzin(userId: string, writeListHash: string, targetOrigin: string): string {
    const token = randomToken();
    this.db
      .prepare(
        `INSERT INTO pii_izin (token_hash, user_id, write_list_hash, target_origin, created_at, expires_at)
         VALUES (?,?,?,?,?,?)`,
      )
      .run(sha256Hex(token), userId, writeListHash, targetOrigin, this.iso(), this.iso(this.ttl.izinSec));
    return token;
  }

  /** Pakai token persetujuan; pemilik, hash daftar write, dan origin tujuan harus persis sama. */
  pakaiIzin(token: string, p: { userId: string; writeListHash: string; targetOrigin: string }): void {
    if (!TOKEN_RE.test(token)) throw new AkunError('IZIN_TIDAK_VALID');
    const r = this.db
      .prepare(
        `UPDATE pii_izin SET used_at = ?
         WHERE token_hash = ? AND user_id = ? AND write_list_hash = ? AND target_origin = ?
           AND used_at IS NULL AND expires_at > ?
         RETURNING 1 AS ok`,
      )
      .get(this.iso(), sha256Hex(token), p.userId, p.writeListHash, p.targetOrigin, this.iso());
    if (!r) throw new AkunError('IZIN_TIDAK_VALID');
  }

  // --- Google ---

  /**
   * Mulai login Google: simpan state (hash) → verifier PKCE, nonce, tujuan, dan (bila sedang masuk) akun yang
   * akan ditautkan. Kembalikan URL dan state cookie.
   */
  googleMulai(
    next?: string | null,
    opts: { userId?: string | undefined; authAt?: string | undefined } = {},
  ): { url: string; state: string } {
    const google = this.deps.google;
    if (!google) throw new AkunError('GOOGLE_TIDAK_AKTIF');
    if (opts.userId) {
      // Menautkan hanya untuk akun TERVERIFIKASI dengan bukti kredensial <= 15 menit: akun pra-daftar milik
      // penyerang tidak bisa menanam identitas, dan sesi curian lama tidak bisa dijadikan pintu belakang.
      const u = this.userById(opts.userId);
      if (!u || u.jenis !== 'akun' || !u.email_verified_at) throw new AkunError('EMAIL_BELUM_TERVERIFIKASI');
      if (!opts.authAt || Date.parse(opts.authAt) + this.ttl.reauthSec * 1000 < this.now().getTime())
        throw new AkunError('PERLU_MASUK_ULANG');
    }
    const state = randomToken();
    const nonce = randomToken();
    const codeVerifier = randomToken();
    this.db
      .prepare(
        'INSERT INTO oauth_states (state_hash, code_verifier, nonce, next, user_id, expires_at) VALUES (?,?,?,?,?,?)',
      )
      .run(
        sha256Hex(state),
        codeVerifier,
        nonce,
        amanNext(next),
        opts.userId ?? null,
        this.iso(this.ttl.oauthStateSec),
      );
    return { url: google.authorizationUrl({ state, nonce, codeVerifier }), state };
  }

  private tautkanIdentitas(userId: string, sub: string, asal: 'daftar' | 'tautan'): void {
    this.db
      .prepare(
        "INSERT INTO oauth_identities (provider, sub, user_id, created_at, asal) VALUES ('google',?,?,?,?)",
      )
      .run(sub, userId, this.iso(), asal);
  }

  /** Pindah kepemilikan (verifikasi, atur ulang, ambil alih Google): semua identitas Google lama dicabut. */
  private cabutIdentitas(userId: string): void {
    this.db.prepare('DELETE FROM oauth_identities WHERE user_id = ?').run(userId);
  }

  /** Email "Google ditautkan" ke pemilik: tautan yang tidak dikenalnya bisa dilepas di Pengaturan. */
  private beritahuTautan(userId: string): void {
    const email = this.userById(userId)?.email;
    if (email) void this.kirim(emailGoogleDitautkan(email, `${this.deps.publicOrigin}/pengaturan`));
  }

  /**
   * Lepas semua identitas Google akun. Akun tanpa sandi ditolak (GOOGLE_SATU_SATUNYA) agar tidak terkunci.
   * Mengembalikan jumlah identitas yang dilepas.
   */
  lepasGoogle(userId: string): number {
    const u = this.userById(userId);
    if (!u || u.jenis !== 'akun') throw new AkunError('HANYA_AKUN');
    if (!u.password_hash) throw new AkunError('GOOGLE_SATU_SATUNYA');
    return this.db.prepare('DELETE FROM oauth_identities WHERE user_id = ?').run(userId).changes;
  }

  /**
   * Callback Google. `state` dari query harus sama dengan cookie state (CSRF login), lalu state dipakai sekali.
   * - Sedang masuk saat mulai (`user_id` di state): identitas ditautkan ke akun itu (bukti = sesi).
   * - Identitas (sub) sudah tertaut → akunnya.
   * - Email sama dengan akun yang BELUM terverifikasi (Google `email_verified`) → sandi dan semua sesi akun itu
   *   dihapus, akun diberikan ke identitas Google (anti pra-pembajakan).
   * - Email sama dengan akun TERVERIFIKASI → TIDAK ditautkan otomatis: tiket tautan menunggu bukti sandi.
   * - Tanpa akun → akun baru terverifikasi.
   */
  async googleSelesai(
    p: {
      code: string | null;
      state: string | null;
      cookieState: string | undefined;
      userIdSaatIni?: string | undefined;
    },
    ctx: KonteksPermintaan,
  ): Promise<HasilGoogle> {
    const google = this.deps.google;
    if (!google) throw new AkunError('GOOGLE_TIDAK_AKTIF');
    if (!p.state || !p.cookieState || !p.code || !safeEqual(p.state, p.cookieState))
      throw new AkunError('GOOGLE_GAGAL');
    const st = this.db
      .prepare(
        'DELETE FROM oauth_states WHERE state_hash = ? RETURNING code_verifier, nonce, next, user_id, expires_at',
      )
      .get(sha256Hex(p.state)) as
      | { code_verifier: string; nonce: string; next: string; user_id: string | null; expires_at: string }
      | undefined;
    if (!st || st.expires_at <= this.iso()) throw new AkunError('GOOGLE_GAGAL');
    if (st.user_id && st.user_id !== p.userIdSaatIni) throw new AkunError('GOOGLE_GAGAL');
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
    let tertaut = false;
    const hasil = this.tx((): { userId: string } | { tiket: string } => {
      const ident = this.db
        .prepare("SELECT user_id FROM oauth_identities WHERE provider = 'google' AND sub = ?")
        .get(claims.sub) as { user_id: string } | undefined;
      if (st.user_id) {
        const pemilik = this.userById(st.user_id);
        if (!pemilik?.email_verified_at) throw new AkunError('GOOGLE_GAGAL');
        if (ident && ident.user_id !== st.user_id) throw new AkunError('GOOGLE_SUDAH_DIPAKAI');
        if (!ident) {
          this.tautkanIdentitas(st.user_id, claims.sub, 'tautan');
          tertaut = true;
        }
        return { userId: st.user_id };
      }
      if (ident) return { userId: ident.user_id };
      if (!claims.emailVerified) throw new AkunError('GOOGLE_EMAIL_BELUM_TERVERIFIKASI');
      const ada = this.userByEmail(email);
      if (ada?.email_verified_at) {
        const tiket = randomToken();
        this.db
          .prepare(
            `INSERT INTO oauth_link_pending (ticket_hash, user_id, provider, sub, expires_at)
             VALUES (?, ?, 'google', ?, ?)`,
          )
          .run(sha256Hex(tiket), ada.id, claims.sub, this.iso(this.ttl.oauthStateSec));
        return { tiket };
      }
      let userId: string;
      if (ada) {
        userId = ada.id;
        this.db
          .prepare('UPDATE users SET email_verified_at = ?, password_hash = NULL WHERE id = ?')
          .run(this.iso(), userId);
        this.db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(userId);
        this.db
          .prepare('UPDATE email_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL')
          .run(this.iso(), userId);
        this.cabutIdentitas(userId);
      } else {
        userId = newId('akun');
        baru = true;
        this.db
          .prepare(
            "INSERT INTO users (id, jenis, email, email_verified_at, created_at) VALUES (?, 'akun', ?, ?, ?)",
          )
          .run(userId, email, this.iso(), this.iso());
      }
      this.tautkanIdentitas(userId, claims.sub, 'daftar');
      return { userId };
    });
    if ('tiket' in hasil) return { jenis: 'perlu-tautkan', tiket: hasil.tiket, next: st.next };
    if (tertaut) this.beritahuTautan(hasil.userId);
    if (baru && claims.name)
      this.deps.vault.setDataDiri(hasil.userId, { namaLengkap: claims.name.slice(0, 200) });
    return {
      jenis: 'masuk',
      token: this.buatSesi(hasil.userId, ctx),
      akun: toAkun(this.userById(hasil.userId)!),
      next: st.next,
      baru,
    };
  }

  /**
   * Selesaikan tautan Google yang menunggu bukti sandi: dipanggil SETELAH masuk dengan sandi berhasil.
   * Tiket hanya berlaku untuk akun yang sama dan sekali pakai. true bila identitas ditautkan.
   */
  tautkanGoogle(tiket: string | undefined, userId: string): boolean {
    if (!tiket || !TOKEN_RE.test(tiket)) return false;
    let ok = false;
    let baru = false;
    this.tx(() => {
      const r = this.db
        .prepare('DELETE FROM oauth_link_pending WHERE ticket_hash = ? RETURNING user_id, sub, expires_at')
        .get(sha256Hex(tiket)) as { user_id: string; sub: string; expires_at: string } | undefined;
      if (!r || r.user_id !== userId || r.expires_at <= this.iso()) return;
      const ident = this.db
        .prepare("SELECT user_id FROM oauth_identities WHERE provider = 'google' AND sub = ?")
        .get(r.sub) as { user_id: string } | undefined;
      if (ident) {
        ok = ident.user_id === userId;
        return;
      }
      this.tautkanIdentitas(userId, r.sub, 'tautan');
      ok = baru = true;
    });
    if (baru) this.beritahuTautan(userId);
    return ok;
  }
}
