import { DaftarRequestSchema, type MasukResponse } from '@urusin/contracts';
import { akunErrorResponse, akunPublik, konteks, pasangSesi, readAkunBody } from '#lib/server/akun.js';
import { apiJson } from '#lib/server/http.js';
import { getRuntime } from '#lib/server/runtime.js';
import { SID_COOKIE } from '#lib/server/sesi.js';
import type { RequestHandler } from './$types';

/**
 * Daftar email + sandi (ADR 0032): akun langsung penuh dan sesi langsung dipasang (cookie baru, urusin_sid
 * diputar, data tamu pindah ke akun), respons sama dengan masuk. Email sudah terdaftar → 409
 * `EMAIL_SUDAH_TERDAFTAR`.
 */
export const POST: RequestHandler = async (event) => {
  const body = await readAkunBody(event.request, DaftarRequestSchema);
  if (!body.ok) return body.response;
  try {
    const rt = await getRuntime();
    const { token, akun } = await rt.akun.daftar(body.data, konteks(event));
    const r = pasangSesi(rt, event.cookies, akun, token);
    return apiJson({
      akun: akunPublik(rt, akun, event.cookies.get(SID_COOKIE)),
      next: '/beranda',
      ...r,
    } satisfies MasukResponse);
  } catch (e) {
    return akunErrorResponse(e);
  }
};
