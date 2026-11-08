import { akunErrorResponse, wajibMasuk } from '#lib/server/akun.js';
import { apiError, apiJson } from '#lib/server/http.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

/** Unduh dokumen milik akun (didekripsi di server, dikirim no-store sebagai lampiran). */
export const GET: RequestHandler = async ({ locals, params }) => {
  const m = wajibMasuk(locals);
  if (!m.ok) return m.response;
  try {
    const rt = await getRuntime();
    const d = rt.akun.vault.getDocument(m.id, params.id);
    if (!d) return apiError(404, 'NOT_FOUND', 'Dokumen tidak ditemukan.');
    return new Response(new Uint8Array(d.bytes), {
      headers: {
        'content-type': d.meta.mime,
        'content-length': String(d.bytes.length),
        'content-disposition': `attachment; filename="${d.meta.id}"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (e) {
    return akunErrorResponse(e);
  }
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  const m = wajibMasuk(locals);
  if (!m.ok) return m.response;
  try {
    const rt = await getRuntime();
    if (!rt.akun.vault.deleteDocument(m.id, params.id))
      return apiError(404, 'NOT_FOUND', 'Dokumen tidak ditemukan.');
    return apiJson({ terhapus: true });
  } catch (e) {
    return akunErrorResponse(e);
  }
};
