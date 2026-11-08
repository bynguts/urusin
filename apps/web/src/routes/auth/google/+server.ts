import { redirect } from '@sveltejs/kit';
import { AkunError, GOOGLE_ENDPOINTS } from '@urusin/akun';
import { setOauthCookie } from '#lib/server/akun.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

/**
 * Mulai "Masuk dengan Google": simpan state di cookie __Host- (10 menit), verifier PKCE + nonce + tujuan di
 * server, lalu alihkan ke Google. `?next=/path` = tujuan setelah berhasil (hanya path di situs ini). Bila sudah
 * masuk, alur ini MENAUTKAN Google ke akun yang sedang masuk (bukti = sesi).
 */
export const GET: RequestHandler = async ({ url, cookies, locals }) => {
  const rt = await getRuntime();
  let mulai;
  try {
    const userId = locals.akun?.jenis === 'akun' ? locals.akun.id : undefined;
    mulai = rt.akun.googleMulai(url.searchParams.get('next'), { userId });
  } catch (e) {
    if (e instanceof AkunError) redirect(303, `/masuk?galat=${e.kode}`);
    throw e;
  }
  setOauthCookie(cookies, mulai.state);
  // Hanya origin otorisasi Google (atau IdP tiruan e2e di origin ini) yang boleh jadi tujuan eksternal.
  const otorisasi = rt.oidcFixture
    ? new URL(mulai.url).origin
    : new URL(GOOGLE_ENDPOINTS.authorization).origin;
  redirect(302, mulai.url, { external: [otorisasi] });
};
