import { redirect } from '@sveltejs/kit';
import { AkunError } from '@urusin/akun';
import { akunPublik, hapusOauthCookie, konteks, OAUTH_COOKIE, pasangSesi } from '#lib/server/akun.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

/**
 * Callback OAuth Google. URL ini PERSIS `/auth/google/callback` (didaftarkan di Google Cloud Console).
 * state query == cookie state → tukar code (PKCE) → verifikasi ID token → sesi baru → tujuan aman.
 * Profil belum lengkap → ke /lengkapi-profil dulu. Gagal → /masuk?galat=<kode>.
 */
export const GET: RequestHandler = async (event) => {
  const { url, cookies } = event;
  const cookieState = cookies.get(OAUTH_COOKIE);
  hapusOauthCookie(cookies);
  const rt = await getRuntime();
  let hasil;
  try {
    if (url.searchParams.has('error')) throw new AkunError('GOOGLE_GAGAL'); // warga membatalkan di Google
    hasil = await rt.akun.googleSelesai(
      { code: url.searchParams.get('code'), state: url.searchParams.get('state'), cookieState },
      konteks(event),
    );
  } catch (e) {
    if (e instanceof AkunError) redirect(303, `/masuk?galat=${e.kode}`);
    throw e;
  }
  pasangSesi(rt, cookies, hasil.akun.id, hasil.token);
  if (!akunPublik(rt, hasil.akun).profilLengkap)
    redirect(303, `/lengkapi-profil?next=${encodeURIComponent(hasil.next)}`);
  redirect(303, hasil.next);
};
