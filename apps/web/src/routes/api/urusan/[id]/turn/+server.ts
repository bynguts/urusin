import { TurnRequestSchema, type TurnResponse } from '@urusin/contracts';
import { apiError, apiJson, errorResponse, readBody } from '#lib/server/http.js';
import { getRuntime, startTurnInBackground } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

/** Kirim pesan warga. 202: turn berjalan di latar belakang, hasil mengalir di /stream. 409: turn berjalan / version basi. */
export const POST: RequestHandler = async ({ request, params }) => {
  let rt;
  try {
    rt = await getRuntime();
  } catch (e) {
    return errorResponse(e);
  }
  const body = await readBody(request, TurnRequestSchema, {
    kodeKabKota: rt.store.getUrusan(params.id)?.kodeKabKota ?? null,
  });
  if (!body.ok) return body.response;
  try {
    if (!rt.store.getUrusan(params.id)) return apiError(404, 'NOT_FOUND', 'Urusan tidak ditemukan.');
    const { turnId } = startTurnInBackground(rt, {
      urusanId: params.id,
      userText: body.data.teks,
      ...(body.data.expectedVersion !== undefined ? { expectedVersion: body.data.expectedVersion } : {}),
    });
    return apiJson({ turnId, diterima: true } satisfies TurnResponse, 202);
  } catch (e) {
    return errorResponse(e);
  }
};
