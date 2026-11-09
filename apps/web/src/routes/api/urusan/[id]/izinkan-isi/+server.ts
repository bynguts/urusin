import { IzinkanIsiRequestSchema } from '@urusin/contracts';
import { akunErrorResponse, readAkunBody } from '#lib/server/akun.js';
import { apiError, apiJson } from '#lib/server/http.js';
import { izinkanIsiUrusan } from '#lib/server/pendamping/isi.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

/**
 * "Izinkan isi" (A-M1): peramban hanya mengirim `{writeList, targetOrigin}`. Server memeriksa pemilik urusan,
 * menerbitkan token persetujuan, dan menyimpannya untuk Pendamping. Respons tidak memuat nilai vault.
 * Bukan pemilik → 404 (tidak membocorkan keberadaan urusan).
 */
export const POST: RequestHandler = async ({ request, params, locals }) => {
  const body = await readAkunBody(request, IzinkanIsiRequestSchema);
  if (!body.ok) return body.response;
  try {
    const rt = await getRuntime();
    const peminta = { akun: locals.akun, sid: locals.sid };
    if (!rt.akun.pemilikVaultUrusan(params.id, peminta))
      return apiError(404, 'NOT_FOUND', 'Urusan tidak ditemukan.');
    const { kurang } = izinkanIsiUrusan(rt, {
      urusanId: params.id,
      peminta,
      writeList: body.data.writeList,
      targetOrigin: body.data.targetOrigin,
    });
    return apiJson({ diizinkan: true, kurang });
  } catch (e) {
    return akunErrorResponse(e);
  }
};
