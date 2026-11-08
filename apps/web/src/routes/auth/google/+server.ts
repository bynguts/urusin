import { redirect } from '@sveltejs/kit';
import { AkunError, GOOGLE_ENDPOINTS } from '@urusin/akun';
import { setOauthCookie } from '#lib/server/akun.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

/**
 * Mulai "Masuk dengan Google": simpan state di cookie __Host- (10 menit), verifier PKCE + nonce + tujuan di
 * server, lalu alihkan ke Google. `?next=/path` = tujuan setelah berhasil (hanya path di situs ini).
 */
export const GET: RequestHandler = async ({ url, cookies }) => {
  const rt = await getRuntime();
  let mulai;
  try {
    mulai = rt.akun.googleMulai(url.searchParams.get('next'));
  } catch (e) {
    if (e instanceof AkunError) redirect(303, `/masuk?galat=${e.kode}`);
    throw e;
  }
  setOauthCookie(cookies, mulai.state);
  // Hanya origin otorisasi Google yang boleh jadi tujuan eksternal (allowlist SvelteKit).
  redirect(302, mulai.url, { external: [new URL(GOOGLE_ENDPOINTS.authorization).origin] });
};
