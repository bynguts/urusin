import { akunErrorResponse, pemilikVault, tolakBacaVault } from '#lib/server/akun.js';
import { apiError, apiJson } from '#lib/server/http.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

const tidakAda = () => apiError(404, 'NOT_FOUND', 'Dokumen tidak ditemukan.');

/**
 * Unduh dokumen milik pemilik (didekripsi di server, lampiran no-store). Dokumen pemilik lain = 404. Akun di
 * sesi yang belum pernah mengunduh ("perangkat baru") butuh bukti kredensial <= 15 menit → 401
 * PERLU_MASUK_ULANG (konfirmasi sandi lewat /api/akun/konfirmasi-sandi, atau masuk ulang dengan Google).
 */
export const GET: RequestHandler = async (event) => {
  const tolak = tolakBacaVault(event.request);
  if (tolak) return tolak;
  try {
    const rt = await getRuntime();
    const p = pemilikVault(rt, event, { buat: false });
    if (!p || !rt.akun.vault.listDocuments(p.id).some((d) => d.id === event.params.id)) return tidakAda();
    const { akun, akunSesi } = event.locals;
    if (akun && akunSesi && p.id === akun.id) rt.akun.izinkanUnduh({ ...akunSesi, akun });
    const d = rt.akun.vault.getDocument(p.id, event.params.id);
    if (!d) return tidakAda();
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

export const DELETE: RequestHandler = async (event) => {
  try {
    const rt = await getRuntime();
    const p = pemilikVault(rt, event, { buat: false });
    if (!p || !rt.akun.vault.deleteDocument(p.id, event.params.id)) return tidakAda();
    return apiJson({ terhapus: true });
  } catch (e) {
    return akunErrorResponse(e);
  }
};
