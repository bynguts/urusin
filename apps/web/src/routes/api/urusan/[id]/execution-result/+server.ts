import { ExecutionResultRequestSchema, type ExecutionResultResponse } from '@urusin/contracts';
import { canTransition, isTerminal, type UrusanState } from '@urusin/harness';
import { routeByKode } from '@urusin/registry';
import { apiError, apiJson, errorResponse, readBody } from '#lib/server/http.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

const LABEL = {
  berhasil: 'Ekstensi melaporkan langkah berhasil.',
  gagal: 'Ekstensi melaporkan langkah gagal.',
  dibatalkan: 'Anda membatalkan langkah di ekstensi.',
  drift: 'Tampilan situs berubah. Kami beralih ke panduan langkah.',
} as const;

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
    if (!rt.store.recordExecutionResult(u.id, executionId, status))
      return apiError(409, 'EKSEKUSI_SUDAH_DILAPORKAN', 'Hasil untuk langkah ini sudah tercatat.');

    const ke: UrusanState | null = status === 'berhasil' ? 'TERKIRIM' : status === 'drift' ? 'DIPANDU' : null;
    rt.publish(u.id, { type: 'progress', label: LABEL[status] });
    if (status === 'drift') rt.publish(u.id, { type: 'degraded', kapabilitas: ['adapter'], mode: null });
    let current = u;
    if (ke && canTransition(u.state, ke)) {
      current = rt.store.transition(u.id, u.version, ke);
      const kode = u.kodeKabKota;
      rt.publish(u.id, {
        type: 'state',
        state: ke,
        tier: kode ? routeByKode(kode).entry.tier : null,
        version: current.version,
        dari: u.state,
      });
    }
    return apiJson({
      diterima: true,
      state: current.state,
      version: current.version,
    } satisfies ExecutionResultResponse);
  } catch (e) {
    return errorResponse(e);
  }
};
