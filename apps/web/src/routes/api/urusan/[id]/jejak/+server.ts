import { jejakView } from '@urusin/harness';
import { apiError, apiJson, errorResponse } from '#lib/server/http.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

/**
 * Timeline per urusan (event audit + span). `?head=<chainHead>` = head yang dipegang klien: rantai server
 * yang valid tetapi berujung berbeda ditandai tidak valid (manipulasi/pemotongan terdeteksi).
 */
export const GET: RequestHandler = async ({ params, url }) => {
  try {
    const rt = await getRuntime();
    if (!rt.store.getUrusan(params.id)) return apiError(404, 'NOT_FOUND', 'urusan tidak ditemukan');
    return apiJson(jejakView(rt.store, params.id, url.searchParams.get('head') ?? undefined));
  } catch (e) {
    return errorResponse(e);
  }
};
