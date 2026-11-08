import type { SesiAkunResponse } from '@urusin/contracts';
import { akunErrorResponse, akunPublik } from '#lib/server/akun.js';
import { apiJson } from '#lib/server/http.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

/** Keadaan login saat ini: tamu, atau akun + daftar perangkat yang masuk. */
export const GET: RequestHandler = async ({ locals }) => {
  try {
    const rt = await getRuntime();
    const metode = { email: true as const, google: rt.akun.googleAktif };
    const a = locals.akun ? rt.akun.akun(locals.akun.id) : undefined;
    if (!a) return apiJson({ masuk: false, metode } satisfies SesiAkunResponse);
    return apiJson({
      masuk: true,
      metode,
      akun: akunPublik(rt, a),
      perangkat: rt.akun.perangkat(a.id, locals.akunTokenHash),
    } satisfies SesiAkunResponse);
  } catch (e) {
    return akunErrorResponse(e);
  }
};
