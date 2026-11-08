import { AKUN_COOKIE, hapusAkunCookie } from '#lib/server/akun.js';
import { apiJson, errorResponse } from '#lib/server/http.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

/** Keluar dari perangkat ini. Idempoten: tamu pun mendapat 200. */
export const POST: RequestHandler = async ({ cookies, locals }) => {
  try {
    const rt = await getRuntime();
    rt.akun.keluar(cookies.get(AKUN_COOKIE));
    hapusAkunCookie(cookies);
    return apiJson({ keluar: true, sesiDihapus: locals.akun ? 1 : 0 });
  } catch (e) {
    return errorResponse(e);
  }
};
