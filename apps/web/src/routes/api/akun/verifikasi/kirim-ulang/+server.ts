import { KirimUlangVerifikasiRequestSchema } from '@urusin/contracts';
import { akunErrorResponse, konteks, readAkunBody } from '#lib/server/akun.js';
import { apiJson } from '#lib/server/http.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

/** 202 seragam; email hanya terkirim bila akun ada dan belum terverifikasi. */
export const POST: RequestHandler = async (event) => {
  const body = await readAkunBody(event.request, KirimUlangVerifikasiRequestSchema);
  if (!body.ok) return body.response;
  try {
    const rt = await getRuntime();
    await rt.akun.kirimUlangVerifikasi(body.data.email, konteks(event));
    return apiJson({ terkirim: true }, 202);
  } catch (e) {
    return akunErrorResponse(e);
  }
};
