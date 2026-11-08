import { KonfirmasiRequestSchema, type KonfirmasiResponse } from '@urusin/contracts';
import { isTerminal } from '@urusin/harness';
import { apiError, apiJson, errorResponse, readBody } from '#lib/server/http.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

/**
 * Warga menyetujui tindakan yang tadi ditampilkan di layar konfirmasi (event `gate` jenis `konfirmasi`, yang
 * membawa `tool` dan `paramsHash`). Hanya pasangan yang memang pernah kami tawarkan pada urusan ini yang diterima.
 * Persetujuan berlaku sekali pakai dan kedaluwarsa dalam 10 menit; AI hanya diberi tahu id-nya, tidak bisa membuatnya.
 */
export const POST: RequestHandler = async ({ request, params }) => {
  const body = await readBody(request, KonfirmasiRequestSchema);
  if (!body.ok) return body.response;
  try {
    const rt = await getRuntime();
    const u = rt.store.getUrusan(params.id);
    if (!u) return apiError(404, 'NOT_FOUND', 'Urusan tidak ditemukan.');
    if (isTerminal(u.state)) return apiError(409, 'TERMINAL', 'Urusan ini sudah selesai.');
    const { tool, paramsHash } = body.data;
    if (!rt.store.findOffered(u.id, 'gate', { tool, paramsHash }))
      return apiError(
        404,
        'KONFIRMASI_TIDAK_DITAWARKAN',
        'Tidak ada tindakan yang menunggu persetujuan Anda.',
      );
    const c = rt.store.createConfirmationByHash(u.id, tool, paramsHash);
    rt.publish(u.id, { type: 'progress', label: 'Persetujuan Anda tercatat.' });
    return apiJson({ confirmationId: c.id, kedaluwarsa: c.expiresAt } satisfies KonfirmasiResponse, 201);
  } catch (e) {
    return errorResponse(e);
  }
};
