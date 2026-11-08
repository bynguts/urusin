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

/**
 * Putar cookie urusin_sid (anti fiksasi saat naik hak tamu → akun, §3.26.6). Pemanggil wajib mengikat ulang
 * semua yang terikat hash sid lama dalam satu transaksi (`AkunService.rotasiPemilik`).
 */
export function rotasiSid(cookies: Cookies, publicOrigin: string): string {
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
