import { HapusAkunRequestSchema } from '@urusin/contracts';
import { akunErrorResponse, hapusAkunCookie, readAkunBody, wajibMasuk } from '#lib/server/akun.js';
import { apiJson } from '#lib/server/http.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

/** Hapus akun beserta semua datanya (urusan, Data Diri, dokumen; DEK dihancurkan). Tidak bisa dibatalkan. */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
  const m = wajibMasuk(locals);
  if (!m.ok) return m.response;
  const body = await readAkunBody(request, HapusAkunRequestSchema);
  if (!body.ok) return body.response;
  try {
    const rt = await getRuntime();
    await rt.akun.hapusAkun(m.id, body.data);
    hapusAkunCookie(cookies);
    return apiJson({ terhapus: true });
  } catch (e) {
    return akunErrorResponse(e);
  }
};
