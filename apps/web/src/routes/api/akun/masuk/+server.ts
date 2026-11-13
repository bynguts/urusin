import { MasukRequestSchema, type MasukResponse } from '@urusin/contracts';
import {
  akunErrorResponse,
  akunPublik,
  konteks,
  pasangSesi,
  readAkunBody,
  tujuanMasuk,
  turnstileLolos,
} from '#lib/server/akun.js';
import { apiJson } from '#lib/server/http.js';
import { getRuntime } from '#lib/server/runtime.js';
import { SID_COOKIE } from '#lib/server/sesi.js';
import type { RequestHandler } from './$types';

/**
 * Masuk email + sandi (Turnstile wajib setelah 3 kegagalan). Berhasil: cookie sesi BARU (rotasi), urusin_sid
 * diputar dan data tamu dipindahkan ke akun, Google yang menunggu bukti sandi ditautkan.
 */
export const POST: RequestHandler = async (event) => {
  const body = await readAkunBody(event.request, MasukRequestSchema);
  if (!body.ok) return body.response;
  try {
    const rt = await getRuntime();
    const ctx = konteks(event);
    const turnstileOk = await turnstileLolos(rt, body.data.turnstile, ctx.ip);
    const { token, akun } = await rt.akun.masuk(body.data, { ...ctx, turnstileOk });
    const r = pasangSesi(rt, event.cookies, akun, token, { buktiSandi: true });
    return apiJson({
      akun: akunPublik(rt, akun, event.cookies.get(SID_COOKIE)),
      next: tujuanMasuk(body.data.next),
      ...r,
    } satisfies MasukResponse);
  } catch (e) {
    return akunErrorResponse(e);
  }
};
