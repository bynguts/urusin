import { akunErrorResponse, wajibMasuk } from '#lib/server/akun.js';
import { apiJson } from '#lib/server/http.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

/** Lepas Google dari akun (Pengaturan). Akun tanpa sandi → 409 GOOGLE_SATU_SATUNYA agar tidak terkunci. */
export const POST: RequestHandler = async ({ locals }) => {
  const m = wajibMasuk(locals);
  if (!m.ok) return m.response;
  try {
    const rt = await getRuntime();
    return apiJson({ dilepas: rt.akun.lepasGoogle(m.id) });
  } catch (e) {
    return akunErrorResponse(e);
  }
};
