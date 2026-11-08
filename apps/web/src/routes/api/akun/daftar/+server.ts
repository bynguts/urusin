import { DaftarRequestSchema } from '@urusin/contracts';
import { akunErrorResponse, konteks, readAkunBody } from '#lib/server/akun.js';
import { apiJson } from '#lib/server/http.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

/**
 * 202 seragam: "cek email Anda", baik email baru maupun sudah terdaftar (anti-enumerasi). `tertunda` = email
 * gagal/terlambat (kuota Resend habis, DNS belum siap); akun tetap bisa dipakai seperti tamu.
 */
export const POST: RequestHandler = async (event) => {
  const body = await readAkunBody(event.request, DaftarRequestSchema);
  if (!body.ok) return body.response;
  try {
    const rt = await getRuntime();
    const { tertunda } = await rt.akun.daftar(body.data, konteks(event));
    return apiJson({ terkirim: true, tertunda }, 202);
  } catch (e) {
    return akunErrorResponse(e);
  }
};
