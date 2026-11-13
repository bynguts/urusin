import { AkunError, amanNext, type Akun as AkunInternal } from '@urusin/akun';
import {
  AnggotaKeluargaSchema,
  DataDiriSchema,
  type Akun,
  type AnggotaKeluarga,
  type DataDiriResponse,
  type LengkapiProfilRequest,
  type StatusEmail,
} from '@urusin/contracts';
import type { Cookies } from '@sveltejs/kit';
import type { ZodType } from 'zod';
import { apiError, errorResponse } from '#lib/server/http.js';
import { publicOrigin, type Runtime } from '#lib/server/runtime.js';
import { ensureSession, rotasiSid, SID_COOKIE } from '#lib/server/sesi.js';

/**
 * Cookie sesi login. Prefiks `__Host-` memaksa Secure, Path=/, tanpa Domain: subdomain lain tidak bisa
 * menimpanya (anti fiksasi lewat subdomain). Isinya token acak; server hanya menyimpan SHA-256-nya.
 * Peramban memperlakukan http://localhost sebagai konteks aman, jadi dev lokal tetap bisa masuk.
 */
export const AKUN_COOKIE = '__Host-urusin_akun';
/** State OAuth Google (10 menit); dibandingkan dengan `state` di callback (anti CSRF login). */
export const OAUTH_COOKIE = '__Host-urusin_oauth';
/** Tiket identitas Google yang menunggu bukti sandi (10 menit); dipakai setelah masuk dengan sandi. */
export const TAUTKAN_COOKIE = '__Host-urusin_tautkan';

const BASE = { path: '/', httpOnly: true, secure: true, sameSite: 'lax' } as const;

/**
 * Tujuan setelah masuk/daftar/lengkapi profil/Google: path aman di situs ini; tanpa tujuan (atau landing `/`)
 * → Beranda. Landing hanya untuk tamu, warga yang baru masuk langsung ke aplikasi.
 */
export function tujuanMasuk(next: string | null | undefined): string {
  const n = amanNext(next, '/beranda');
  return n === '/' ? '/beranda' : n;
}

export function setAkunCookie(cookies: Cookies, token: string, maxAgeSec: number): void {
  cookies.set(AKUN_COOKIE, token, { ...BASE, maxAge: maxAgeSec });
}

export function hapusAkunCookie(cookies: Cookies): void {
  cookies.delete(AKUN_COOKIE, BASE);
}

export function setOauthCookie(cookies: Cookies, state: string): void {
  cookies.set(OAUTH_COOKIE, state, { ...BASE, maxAge: 600 });
}

export function hapusOauthCookie(cookies: Cookies): void {
  cookies.delete(OAUTH_COOKIE, BASE);
}

export function setTautkanCookie(cookies: Cookies, tiket: string): void {
  cookies.set(TAUTKAN_COOKIE, tiket, { ...BASE, maxAge: 600 });
}

type EventLike = {
  request: Request;
  getClientAddress: () => string;
};

/** IP dan ringkasan user-agent untuk pembatas laju dan daftar perangkat. */
export function konteks(event: EventLike): { ip: string; userAgent: string | null } {
  let ip = 'tak-dikenal';
  try {
    ip = event.getClientAddress();
  } catch {
    // tanpa alamat klien: semua berbagi satu kunci (lebih ketat)
  }
  return { ip, userAgent: event.request.headers.get('user-agent') };
}

/** Galat akun → `{kode, pesanWarga}` (+ Retry-After untuk 429). Selain itu tanpa detail. */
export function akunErrorResponse(e: unknown): Response {
  if (e instanceof AkunError) {
    const res = apiError(e.status, e.kode, e.pesanWarga);
    if (e.retryAfterSec) res.headers.set('retry-after', String(e.retryAfterSec));
    return res;
  }
  return errorResponse(e);
}

/**
 * Body JSON akun tervalidasi zod. Berbeda dari `readBody`: email dan Data Diri SAH ada di sini, jadi pemindai
 * PII (untuk teks yang menuju model) tidak dipakai. Body tidak pernah digemakan atau dicatat.
 */
export async function readAkunBody<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: apiError(400, 'BODY_INVALID', 'Permintaan tidak terbaca. Coba lagi.') };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    return {
      ok: false,
      response: apiError(422, 'BODY_INVALID', 'Isi permintaan tidak sesuai. Periksa lagi.'),
    };
  return { ok: true, data: parsed.data };
}

export function statusEmail(rt: Runtime): StatusEmail {
  return { mode: rt.akun.modeEmail === 'resend' ? 'resend' : 'log', tertunda: rt.akun.emailTertunda };
}

/** Bentuk publik akun/demo (kontrak). `sid` = cookie urusin_sid (profil tamu, bila pemilik bukan akun/demo). */
export function akunPublik(rt: Runtime, a: AkunInternal, sid?: string): Akun {
  const sinkron = rt.akun.sinkron(a);
  const pemilikVault = sinkron ? a.id : rt.akun.tamuDariSid(sid);
  const nama = pemilikVault ? rt.akun.vault.getDataDiri(pemilikVault)?.data.namaLengkap : undefined;
  return {
    id: a.id,
    jenis: a.jenis === 'demo' ? 'demo' : 'akun',
    email: a.email,
    emailTerverifikasi: true, // deprecated (ADR 0032): selalu true, tidak ada verifikasi email
    punyaSandi: a.punyaSandi,
    terhubungGoogle: rt.akun.terhubungGoogle(a.id),
    profilLengkap: typeof nama === 'string' && nama.trim().length > 0,
    sinkron,
    dibuatPada: a.createdAt,
  };
}

/**
 * Selesaikan login: hapus sesi lama yang dibawa cookie (rotasi), pasang cookie token baru, putar urusin_sid
 * dan ikat ulang semua yang terikat sid lama dalam satu transaksi (urusan tamu pindah ke akun/demo yang masuk;
 * vault tamu pindah ke akun, untuk demo tetap terikat sid baru), lalu tautkan identitas Google yang menunggu
 * bukti sandi bila ada cookie tiketnya.
 */
export function pasangSesi(
  rt: Runtime,
  cookies: Cookies,
  akun: AkunInternal,
  token: string,
  opts: { buktiSandi?: boolean } = {},
): { urusanDipindahkan: number; vaultDipindahkan: boolean; googleTertaut: boolean } {
  const lama = cookies.get(AKUN_COOKIE);
  if (lama && lama !== token) rt.akun.keluar(lama);
  const s = rt.akun.sesi(token);
  const maxAge = s ? Math.max(60, Math.floor((Date.parse(s.kedaluwarsa) - Date.now()) / 1000)) : 60;
  setAkunCookie(cookies, token, maxAge);
  const sidLama = cookies.get(SID_COOKIE);
  const sidBaru = rotasiSid(cookies);
  const r = rt.akun.rotasiPemilik({
    sidLama,
    sidBaru,
    userId: akun.jenis === 'akun' ? akun.id : null,
    akunId: akun.id,
  });
  let googleTertaut = false;
  const tiket = cookies.get(TAUTKAN_COOKIE);
  if (tiket) {
    if (opts.buktiSandi) googleTertaut = rt.akun.tautkanGoogle(tiket, akun.id);
    cookies.delete(TAUTKAN_COOKIE, BASE);
  }
  return {
    urusanDipindahkan: r.urusanDipindahkan,
    vaultDipindahkan: r.vaultDipindahkan,
    googleTertaut,
  };
}

export type PemilikVault = { id: string; jenis: 'akun' | 'tamu' | 'demo'; sinkron: boolean };

type VaultEvent = EventLike & { locals: App.Locals; cookies: Cookies };

/**
 * Pemilik vault untuk permintaan ini: akun/demo → dirinya (sinkron antar perangkat); tamu → tamu terikat cookie
 * urusin_sid, dibuat malas hanya bila `buat` (tulis pertama). null = belum ada vault (baca saja).
 */
export function pemilikVault(rt: Runtime, event: VaultEvent, opts: { buat: boolean }): PemilikVault | null {
  const a = event.locals.akun;
  if (a && rt.akun.sinkron(a)) return { id: a.id, jenis: a.jenis, sinkron: true };
  let sid = event.locals.sid ?? event.cookies.get(SID_COOKIE);
  if (!sid && opts.buat) sid = ensureSession(event.cookies);
  if (!sid) return null;
  const id = opts.buat ? rt.akun.pastikanTamu(sid, konteks(event)) : rt.akun.tamuDariSid(sid);
  return id ? { id, jenis: 'tamu', sinkron: false } : null;
}

/**
 * Baca nilai vault (GET /api/vault/*): hanya dari halaman kita sendiri. `Sec-Fetch-Site` wajib `same-origin`
 * (fetch/navigasi dari origin kita; peramban mengisinya, situs lain tidak bisa memalsukannya) dan `Origin`, bila
 * ada, harus persis origin publik. Mengembalikan respons 403 bila ditolak.
 */
export function tolakBacaVault(request: Request): Response | undefined {
  const site = request.headers.get('sec-fetch-site');
  const origin = request.headers.get('origin');
  if (site !== 'same-origin' || (origin !== null && origin !== publicOrigin()))
    return apiError(403, 'CSRF', 'Permintaan ditolak karena berasal dari situs yang tidak dikenal.');
  return undefined;
}

/** Anggota keluarga pemilik yang sah menurut kontrak (isi blob yang tidak sah dilewati, bukan dilempar). */
export function anggotaKeluarga(rt: Runtime, ownerId: string): AnggotaKeluarga[] {
  return (rt.akun.vault.getKeluarga(ownerId)?.anggota ?? []).flatMap((a) => {
    const r = AnggotaKeluargaSchema.safeParse(a);
    return r.success ? [r.data] : [];
  });
}

/** Gabungkan nama lengkap (dan HP) ke Data Diri terenkripsi pemilik. */
export function lengkapiProfil(rt: Runtime, ownerId: string, input: LengkapiProfilRequest): DataDiriResponse {
  const dataDiri = DataDiriSchema.parse({ ...rt.akun.vault.getDataDiri(ownerId)?.data, ...input });
  return { dataDiri, diubahPada: rt.akun.vault.setDataDiri(ownerId, dataDiri) };
}

/**
 * Turnstile untuk masuk setelah 3 kegagalan: token sah → true. Turnstile nonaktif (belum dikonfigurasi) tidak
 * bisa diwajibkan, jadi dianggap lolos; penguncian 5× / 15 menit tetap berlaku.
 */
export async function turnstileLolos(rt: Runtime, token: string | undefined, ip: string): Promise<boolean> {
  if (rt.turnstile.mode === 'nonaktif') return true;
  return rt.turnstile.verifikasi(token, ip);
}

/**
 * "Masuk sebagai juri": salinan demo terisolasi. Juri harus selalu bisa masuk, jadi tanpa kunci Turnstile
 * (mode nonaktif, juga di produksi) tombol tetap jalan; batas per IP per hari, batas global salinan aktif,
 * dan kedaluwarsa 24 jam (di `buatDemo`) selalu berlaku. Bila Turnstile aktif, token juga wajib.
 */
export async function masukJuri(rt: Runtime, event: EventLike & { cookies: Cookies }, turnstile?: string) {
  const ctx = konteks(event);
  if (rt.turnstile.mode !== 'nonaktif' && !(await rt.turnstile.verifikasi(turnstile, ctx.ip)))
    throw new AkunError('TURNSTILE_WAJIB');
  const { token, akun } = rt.akun.buatDemo(ctx);
  pasangSesi(rt, event.cookies, akun, token);
  return akun;
}

/** Tombol juri selalu ditampilkan (dengan atau tanpa kunci Turnstile); field tetap ada demi kontrak UI. */
export const juriTersedia = (_rt: Runtime): boolean => true;

/** Akun/demo yang sedang masuk, atau respons 401. */
export function wajibMasuk(
  locals: App.Locals,
): { ok: true; id: string; akun: AkunInternal } | { ok: false; response: Response } {
  if (!locals.akun) return { ok: false, response: apiError(401, 'BELUM_MASUK', 'Silakan masuk dulu.') };
  return { ok: true, id: locals.akun.id, akun: locals.akun };
}

/**
 * Tamu dibuat malas: tulis vault pertama atau turn pertama (bukan sekadar membuka situs). Akun sinkron tidak
 * butuh baris tamu. Melebihi kuota pembuatan tamu per IP per hari → respons 429 TAMU_PENUH.
 */
export function pastikanTamuUntukTurn(
  rt: Runtime,
  event: EventLike & { locals: App.Locals },
): Response | undefined {
  const { akun, sid } = event.locals;
  if ((akun && rt.akun.sinkron(akun)) || !sid) return undefined;
  try {
    rt.akun.pastikanTamu(sid, konteks(event));
    return undefined;
  } catch (e) {
    return akunErrorResponse(e);
  }
}
