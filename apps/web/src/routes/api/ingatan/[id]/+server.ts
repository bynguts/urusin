import {
  IdButirIngatanSchema,
  type HapusIngatanResponse,
  type SetujuiIngatanResponse,
} from '@urusin/contracts';
import { akunErrorResponse, pemilikVault } from '#lib/server/akun.js';
import { apiError, apiJson } from '#lib/server/http.js';
import { hapusButirIngatan, setujuiIngatan } from '#lib/server/ingatan.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

/** "Ya, ingat" di kartu persetujuan (butir sensitif): usulan menjadi butir. Bukan milik/sudah dijawab = 404. */
export const POST: RequestHandler = async (event) => {
  if (!IdButirIngatanSchema.safeParse(event.params.id).success)
    return apiError(404, 'NOT_FOUND', 'Usulan ingatan tidak ditemukan.');
  try {
    const rt = await getRuntime();
    const p = pemilikVault(rt, event, { buat: false });
    const butir = p ? setujuiIngatan(rt.akun, p.id, event.params.id) : null;
    if (!butir) return apiError(404, 'NOT_FOUND', 'Usulan ingatan tidak ditemukan.');
    return apiJson({ disetujui: 1, butir } satisfies SetujuiIngatanResponse);
  } catch (e) {
    return akunErrorResponse(e);
  }
};

/** Hapus satu butir/usulan (tombol "Batalkan"/"Tidak" di kartu chat, "Hapus" di Pengaturan). Bukan milik = 404. */
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
