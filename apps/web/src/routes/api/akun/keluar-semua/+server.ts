import { hapusAkunCookie, wajibMasuk } from '#lib/server/akun.js';
import { apiJson, errorResponse } from '#lib/server/http.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

/** "Keluar dari semua perangkat": hapus semua sesi akun, termasuk perangkat ini. */
export const POST: RequestHandler = async ({ cookies, locals }) => {
  const m = wajibMasuk(locals);
  if (!m.ok) return m.response;
  try {
    const rt = await getRuntime();
    const sesiDihapus = rt.akun.keluarSemua(m.id);
    hapusAkunCookie(cookies);
    return apiJson({ keluar: true, sesiDihapus });
  } catch (e) {
    return errorResponse(e);
  }
};
