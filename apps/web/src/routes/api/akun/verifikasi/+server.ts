import { VerifikasiEmailRequestSchema } from '@urusin/contracts';
import { akunErrorResponse, konteks, readAkunBody } from '#lib/server/akun.js';
import { apiJson } from '#lib/server/http.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

/**
 * Pakai token verifikasi email (sekali pakai, 24 jam) + kata sandi saat mendaftar. Semua sesi akun dicabut;
 * warga masuk lagi (akun kini sinkron antar perangkat).
 */
export const POST: RequestHandler = async (event) => {
  const body = await readAkunBody(event.request, VerifikasiEmailRequestSchema);
  if (!body.ok) return body.response;
  try {
    const rt = await getRuntime();
    await rt.akun.verifikasiEmail(body.data.token, body.data.sandi, konteks(event));
    return apiJson({ terverifikasi: true });
  } catch (e) {
    return akunErrorResponse(e);
  }
};
