import { AkunError, type Akun as AkunInternal } from '@urusin/akun';
import {
  DataDiriSchema,
  type Akun,
  type DataDiriResponse,
  type LengkapiProfilRequest,
} from '@urusin/contracts';
import type { Cookies } from '@sveltejs/kit';
import type { ZodType } from 'zod';
import { apiError, errorResponse } from '#lib/server/http.js';
import type { Runtime } from '#lib/server/runtime.js';
import { SID_COOKIE } from '#lib/server/sesi.js';

/**
 * Cookie sesi login. Prefiks `__Host-` memaksa Secure, Path=/, tanpa Domain: subdomain lain tidak bisa
 * menimpanya (anti fiksasi lewat subdomain). Isinya token acak; server hanya menyimpan SHA-256-nya.
 * Peramban memperlakukan http://localhost sebagai konteks aman, jadi dev lokal tetap bisa masuk.
 */
export const AKUN_COOKIE = '__Host-urusin_akun';
/** State OAuth Google (10 menit); dibandingkan dengan `state` di callback (anti CSRF login). */
export const OAUTH_COOKIE = '__Host-urusin_oauth';

const BASE = { path: '/', httpOnly: true, secure: true, sameSite: 'lax' } as const;

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

/** Bentuk publik akun (kontrak). */
export function akunPublik(rt: Runtime, a: AkunInternal): Akun {
  const nama = rt.akun.vault.getDataDiri(a.id)?.data.namaLengkap;
  return {
    id: a.id,
    email: a.email,
    emailTerverifikasi: a.emailVerifiedAt !== null,
    punyaSandi: a.punyaSandi,
    terhubungGoogle: rt.akun.terhubungGoogle(a.id),
    profilLengkap: typeof nama === 'string' && nama.trim().length > 0,
    dibuatPada: a.createdAt,
  };
}

/**
 * Selesaikan login: hapus sesi lama yang dibawa cookie (rotasi), pasang cookie token baru, dan pindahkan
 * urusan tamu (cookie urusin_sid) ke akun. Mengembalikan jumlah urusan yang dipindahkan.
 */
export function pasangSesi(rt: Runtime, cookies: Cookies, userId: string, token: string): number {
  const lama = cookies.get(AKUN_COOKIE);
  if (lama && lama !== token) rt.akun.keluar(lama);
  const s = rt.akun.sesi(token);
  const maxAge = s ? Math.max(60, Math.floor((Date.parse(s.kedaluwarsa) - Date.now()) / 1000)) : 60;
  setAkunCookie(cookies, token, maxAge);
  return rt.akun.migrasiTamu(userId, cookies.get(SID_COOKIE));
}

/** Gabungkan nama lengkap (dan HP) ke Data Diri terenkripsi akun. */
export function lengkapiProfil(rt: Runtime, userId: string, input: LengkapiProfilRequest): DataDiriResponse {
  const dataDiri = DataDiriSchema.parse({ ...rt.akun.vault.getDataDiri(userId)?.data, ...input });
  return { dataDiri, diubahPada: rt.akun.vault.setDataDiri(userId, dataDiri) };
}

/** Akun yang sedang masuk, atau respons 401. */
export function wajibMasuk(locals: App.Locals): { ok: true; id: string } | { ok: false; response: Response } {
  if (!locals.akun) return { ok: false, response: apiError(401, 'BELUM_MASUK', 'Silakan masuk dulu.') };
  return { ok: true, id: locals.akun.id };
}
