import { AturUlangSandiRequestSchema } from '@urusin/contracts';
import { akunErrorResponse, hapusAkunCookie, konteks, readAkunBody } from '#lib/server/akun.js';
import { apiJson } from '#lib/server/http.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

/** Atur ulang sandi dengan token. Semua sesi akun dihapus; warga masuk lagi dengan sandi baru. */
export const POST: RequestHandler = async (event) => {
  const body = await readAkunBody(event.request, AturUlangSandiRequestSchema);
  if (!body.ok) return body.response;
  try {
    const rt = await getRuntime();
    await rt.akun.aturUlangSandi(body.data.token, body.data.sandi, konteks(event));
    hapusAkunCookie(event.cookies);
    return apiJson({ berhasil: true });
  } catch (e) {
    return akunErrorResponse(e);
  }
};
