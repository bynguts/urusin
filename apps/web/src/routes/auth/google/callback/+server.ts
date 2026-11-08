import { redirect } from '@sveltejs/kit';
import { AkunError } from '@urusin/akun';
import {
  akunPublik,
  hapusOauthCookie,
  konteks,
  OAUTH_COOKIE,
  pasangSesi,
  setTautkanCookie,
} from '#lib/server/akun.js';
import { getRuntime } from '#lib/server/runtime.js';
import { SID_COOKIE } from '#lib/server/sesi.js';
import type { RequestHandler } from './$types';

/**
 * Callback OAuth Google. URL ini PERSIS `/auth/google/callback` di setiap host (dari DOMAIN runtime).
 * state query == cookie state → tukar code (PKCE) → verifikasi ID token (nonce) → sesi baru → tujuan aman.
 * Email sama dengan akun TERVERIFIKASI yang belum tertaut → tidak ditautkan otomatis: tiket di cookie
 * __Host-urusin_tautkan dan warga diminta masuk dengan sandi dulu. Gagal → /masuk?galat=<kode>.
 */
export const GET: RequestHandler = async (event) => {
  const { url, cookies, locals } = event;
  const cookieState = cookies.get(OAUTH_COOKIE);
  hapusOauthCookie(cookies);
  const rt = await getRuntime();
  let hasil;
  try {
    if (url.searchParams.has('error')) throw new AkunError('GOOGLE_GAGAL'); // warga membatalkan di Google
    hasil = await rt.akun.googleSelesai(
      {
        code: url.searchParams.get('code'),
        state: url.searchParams.get('state'),
        cookieState,
        userIdSaatIni: locals.akun?.id,
      },
      konteks(event),
    );
  } catch (e) {
    if (e instanceof AkunError) redirect(303, `/masuk?galat=${e.kode}`);
    throw e;
  }
  if (hasil.jenis === 'perlu-tautkan') {
    setTautkanCookie(cookies, hasil.tiket);
    redirect(303, `/masuk?galat=GOOGLE_PERLU_SANDI&next=${encodeURIComponent(hasil.next)}`);
  }
  pasangSesi(rt, cookies, hasil.akun, hasil.token);
  if (!akunPublik(rt, hasil.akun, cookies.get(SID_COOKIE)).profilLengkap)
    redirect(303, `/lengkapi-profil?next=${encodeURIComponent(hasil.next)}`);
  redirect(303, hasil.next);
};
