import type { StatusUrusanResponse } from '@urusin/contracts';
import { apiError, apiJson, errorResponse } from '#lib/server/http.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

/** Status ringan urusan (versi + apakah ada turn berjalan); dipakai klien untuk pulih dari 409. */
export const GET: RequestHandler = async ({ params }) => {
  try {
    const rt = await getRuntime();
    const u = rt.store.getUrusan(params.id);
    if (!u) return apiError(404, 'NOT_FOUND', 'Urusan tidak ditemukan.');
    return apiJson({
      id: u.id,
      state: u.state,
      version: u.version,
      berjalan: rt.running.has(u.id) || rt.store.hasRunningTurn(u.id),
    } satisfies StatusUrusanResponse);
  } catch (e) {
    return errorResponse(e);
  }
};
