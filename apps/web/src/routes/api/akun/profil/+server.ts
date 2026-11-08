import { LengkapiProfilRequestSchema, type DataDiriResponse } from '@urusin/contracts';
import { akunErrorResponse, lengkapiProfil, readAkunBody, wajibMasuk } from '#lib/server/akun.js';
import { apiJson } from '#lib/server/http.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

/** Lengkapi profil: gabungkan nama lengkap (dan HP opsional) ke Data Diri terenkripsi. */
export const POST: RequestHandler = async ({ request, locals }) => {
  const m = wajibMasuk(locals);
  if (!m.ok) return m.response;
  const body = await readAkunBody(request, LengkapiProfilRequestSchema);
  if (!body.ok) return body.response;
  try {
    const rt = await getRuntime();
    return apiJson(lengkapiProfil(rt, m.id, body.data) satisfies DataDiriResponse);
  } catch (e) {
    return akunErrorResponse(e);
  }
};
