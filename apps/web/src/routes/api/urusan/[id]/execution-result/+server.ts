import { ExecutionResultRequestSchema, type ExecutionResultResponse } from '@urusin/contracts';
import { isTerminal } from '@urusin/harness';
import { catatHasilEksekusi } from '#lib/server/eksekusi.js';
import { apiError, apiJson, errorResponse, readBody } from '#lib/server/http.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

/**
 * Ekstensi melaporkan hasil sebuah `execution_request`. Hanya executionId yang memang pernah kami kirim ke
 * urusan ini yang diterima, dan sekali saja (laporan ganda 409). `berhasil` memajukan ke TERKIRIM bila state
 * mengizinkan; `drift` mengalihkan ke DIPANDU. Hasil lain hanya dicatat.
 */
export const POST: RequestHandler = async ({ request, params }) => {
  const body = await readBody(request, ExecutionResultRequestSchema);
  if (!body.ok) return body.response;
  try {
    const rt = await getRuntime();
    const u = rt.store.getUrusan(params.id);
    if (!u) return apiError(404, 'NOT_FOUND', 'Urusan tidak ditemukan.');
    if (isTerminal(u.state)) return apiError(409, 'TERMINAL', 'Urusan ini sudah selesai.');
    const { executionId, status } = body.data;
    if (!rt.store.findOffered(u.id, 'execution_request', { executionId }))
      return apiError(404, 'EKSEKUSI_TIDAK_DITEMUKAN', 'Permintaan eksekusi ini tidak dikenal.');
    const current = catatHasilEksekusi(rt, u, executionId, status);
    if (!current)
      return apiError(409, 'EKSEKUSI_SUDAH_DILAPORKAN', 'Hasil untuk langkah ini sudah tercatat.');
    return apiJson({
      diterima: true,
      state: current.state,
      version: current.version,
    } satisfies ExecutionResultResponse);
  } catch (e) {
    return errorResponse(e);
  }
};
