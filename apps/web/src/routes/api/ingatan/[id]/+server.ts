import { IdButirIngatanSchema, type HapusIngatanResponse } from '@urusin/contracts';
import { akunErrorResponse, pemilikVault } from '#lib/server/akun.js';
import { apiError, apiJson } from '#lib/server/http.js';
import { hapusButirIngatan } from '#lib/server/ingatan.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

/** Hapus satu butir ingatan (tombol "Batalkan" di kartu chat, "Hapus" di Pengaturan). Bukan milik = 404. */
export const DELETE: RequestHandler = async (event) => {
  if (!IdButirIngatanSchema.safeParse(event.params.id).success)
    return apiError(404, 'NOT_FOUND', 'Ingatan tidak ditemukan.');
  try {
    const rt = await getRuntime();
    const p = pemilikVault(rt, event, { buat: false });
    const dihapus = p ? hapusButirIngatan(rt.akun, p.id, event.params.id) : 0;
    if (dihapus === 0) return apiError(404, 'NOT_FOUND', 'Ingatan tidak ditemukan.');
    return apiJson({ dihapus } satisfies HapusIngatanResponse);
  } catch (e) {
    return akunErrorResponse(e);
  }
};
