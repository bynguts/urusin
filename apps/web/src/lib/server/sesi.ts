import { randomBytes } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import { apiError } from '#lib/server/http.js';
import type { Runtime } from '#lib/server/runtime.js';

/**
 * Sesi anonim: cookie acak (HttpOnly, SameSite=Lax) sebagai identitas kuota, BUKAN autentikasi. Urusan tetap
 * dilindungi id kapabilitas yang tak bisa ditebak, jadi hilangnya cookie tidak mengunci warga dari urusannya.
 */
export const SID_COOKIE = 'urusin_sid';
const SID_RE = /^[0-9a-f]{32}$/;
const SID_TTL_SEC = 60 * 60 * 24 * 30;

export function ensureSession(cookies: Cookies, publicOrigin: string): string {
  const ada = cookies.get(SID_COOKIE);
  if (ada && SID_RE.test(ada)) return ada;
  const sid = randomBytes(16).toString('hex');
  cookies.set(SID_COOKIE, sid, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: publicOrigin.startsWith('https://'),
    maxAge: SID_TTL_SEC,
  });
  return sid;
}

/**
 * Urusan terakhir yang dibuka di peramban ini, supaya Ringkasan (/beranda) bisa dirender di server tanpa
 * menunggu localStorage. Isinya id kapabilitas, jadi HttpOnly seperti cookie sesi.
 */
export const TERAKHIR_COOKIE = 'urusin_terakhir';
const ID_URUSAN_RE = /^u_[0-9a-f]{32}$/;

export function catatTerakhir(cookies: Cookies, id: string, publicOrigin: string): void {
  if (!ID_URUSAN_RE.test(id)) return;
  cookies.set(TERAKHIR_COOKIE, id, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: publicOrigin.startsWith('https://'),
    maxAge: SID_TTL_SEC,
  });
}

export function bacaTerakhir(cookies: Cookies): string | null {
  const id = cookies.get(TERAKHIR_COOKIE);
  return id && ID_URUSAN_RE.test(id) ? id : null;
}

type Aksi = 'buat' | 'turn';

/** Kuota per-IP dan per-sesi. 429 + Retry-After bila lewat; undefined bila boleh lanjut. Titik pasang Turnstile nanti. */
export function batasi(
  rt: Runtime,
  event: { locals: { sid?: string | undefined }; getClientAddress: () => string },
  aksi: Aksi,
): Response | undefined {
  let ip = 'tak-dikenal';
  try {
    ip = event.getClientAddress();
  } catch {
    // tanpa alamat klien: semuanya berbagi satu kunci (lebih ketat, bukan lebih longgar)
  }
  const sid = event.locals.sid ?? 'tanpa-sesi';
  const lim = rt.limits[aksi];
  const hasil = [lim.ip.consume(`ip:${ip}`), lim.sesi.consume(`sid:${sid}`)];
  const kena = hasil.find((h) => !h.ok);
  if (!kena) return undefined;
  const res = apiError(429, 'RATE_LIMITED', 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.');
  res.headers.set('retry-after', String(kena.retryAfterSec));
  return res;
}
