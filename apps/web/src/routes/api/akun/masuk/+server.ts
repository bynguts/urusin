import { amanNext } from '@urusin/akun';
import { MasukRequestSchema, type MasukResponse } from '@urusin/contracts';
import { akunErrorResponse, akunPublik, konteks, pasangSesi, readAkunBody } from '#lib/server/akun.js';
import { apiJson } from '#lib/server/http.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

/** Masuk email + sandi. Berhasil: cookie sesi BARU (rotasi) + urusan tamu dipindahkan ke akun. */
export const POST: RequestHandler = async (event) => {
  const body = await readAkunBody(event.request, MasukRequestSchema);
  if (!body.ok) return body.response;
  try {
    const rt = await getRuntime();
    const { token, akun } = await rt.akun.masuk(body.data, konteks(event));
    const urusanDipindahkan = pasangSesi(rt, event.cookies, akun.id, token);
    return apiJson({
      akun: akunPublik(rt, akun),
      next: amanNext(body.data.next),
      urusanDipindahkan,
    } satisfies MasukResponse);
  } catch (e) {
    return akunErrorResponse(e);
  }
};
