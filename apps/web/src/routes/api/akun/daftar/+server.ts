import { DaftarRequestSchema } from '@urusin/contracts';
import { akunErrorResponse, konteks, readAkunBody } from '#lib/server/akun.js';
import { apiJson } from '#lib/server/http.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

/** 202 seragam: "cek email Anda", baik email baru maupun sudah terdaftar (anti-enumerasi). */
export const POST: RequestHandler = async (event) => {
  const body = await readAkunBody(event.request, DaftarRequestSchema);
  if (!body.ok) return body.response;
  try {
    const rt = await getRuntime();
    await rt.akun.daftar(body.data, konteks(event));
    return apiJson({ terkirim: true }, 202);
  } catch (e) {
    return akunErrorResponse(e);
  }
};
