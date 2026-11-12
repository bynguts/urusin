import { redirect } from '@sveltejs/kit';
import { AkunError, GOOGLE_ENDPOINTS } from '@urusin/akun';
import { setOauthCookie } from '#lib/server/akun.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

/**
 * Mulai "Masuk dengan Google": simpan state di cookie __Host- (10 menit), verifier PKCE + nonce + tujuan di
 * server, lalu alihkan ke Google. `?next=/path` = tujuan setelah berhasil (hanya path di situs ini).
 * Bila akun sedang masuk, alur ini MENAUTKAN Google ke akun itu, dan butuh bukti kredensial <= 15 menit
 * (selain itu → masuk ulang dulu, lalu kembali ke sini). `?ulang=1` (tombol Google di masuk ulang) = masuk biasa.
 */
export const GET: RequestHandler = async ({ url, cookies, locals }) => {
  const rt = await getRuntime();
  const a = locals.akun;
  const tautkan = a?.jenis === 'akun' && url.searchParams.get('ulang') !== '1';
  let mulai;
  try {
    mulai = rt.akun.googleMulai(
      url.searchParams.get('next'),
      tautkan ? { userId: a.id, authAt: locals.akunSesi?.authAt } : {},
    );
  } catch (e) {
    if (e instanceof AkunError && e.kode === 'PERLU_MASUK_ULANG')
      redirect(303, `/masuk?ulang=1&lanjut=${encodeURIComponent(url.pathname + url.search)}`);
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
