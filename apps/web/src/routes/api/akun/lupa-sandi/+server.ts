import { LupaSandiRequestSchema } from '@urusin/contracts';
import { akunErrorResponse, konteks, readAkunBody } from '#lib/server/akun.js';
import { apiJson } from '#lib/server/http.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

/** 202 seragam: tautan atur ulang (30 menit) dikirim hanya bila akun ada. */
export const POST: RequestHandler = async (event) => {
  const body = await readAkunBody(event.request, LupaSandiRequestSchema);
  if (!body.ok) return body.response;
  try {
    const rt = await getRuntime();
    await rt.akun.lupaSandi(body.data.email, konteks(event));
    return apiJson({ terkirim: true }, 202);
  } catch (e) {
    return akunErrorResponse(e);
  }
};
