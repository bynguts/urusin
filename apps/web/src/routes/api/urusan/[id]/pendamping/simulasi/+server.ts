import { apiJson, errorResponse } from '#lib/server/http.js';
import { akses } from '../akses';
import { simulasiCadangan } from '../cadangan';
import type { RequestHandler } from './$types';

/**
 * Apakah demo juri boleh membuka simulasi cadangan untuk urusan ini (portal khusus jaringan Indonesia, worker
 * berjaringan Indonesia mati)? Dipakai halaman urusan untuk menampilkan tombol "Lihat contoh pengisian".
 */
export const GET: RequestHandler = async ({ request, params }) => {
  try {
    const a = await akses(request, params.id);
    if (!a.ok) return a.response;
    return apiJson({ tersedia: (await simulasiCadangan(request, a)) !== null });
  } catch (e) {
    return errorResponse(e);
  }
};
