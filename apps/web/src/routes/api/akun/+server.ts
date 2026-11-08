import type { SesiAkunResponse } from '@urusin/contracts';
import { akunErrorResponse, akunPublik, juriTersedia, statusEmail } from '#lib/server/akun.js';
import { apiJson } from '#lib/server/http.js';
import { getRuntime } from '#lib/server/runtime.js';
import { SID_COOKIE } from '#lib/server/sesi.js';
import type { RequestHandler } from './$types';

/** Keadaan login saat ini: tamu, atau akun/demo + daftar perangkat yang masuk; status email (tertunda). */
export const GET: RequestHandler = async ({ locals, cookies }) => {
  try {
    const rt = await getRuntime();
    const metode = { email: true as const, google: rt.akun.googleAktif, juri: juriTersedia(rt) };
    const email = statusEmail(rt);
    const a = locals.akun;
    if (!a) return apiJson({ masuk: false, metode, email } satisfies SesiAkunResponse);
    return apiJson({
      masuk: true,
      metode,
      email,
      akun: akunPublik(rt, a, locals.sid ?? cookies.get(SID_COOKIE)),
      perangkat: rt.akun.perangkat(a.id, locals.akunSesi?.tokenHash),
    } satisfies SesiAkunResponse);
  } catch (e) {
    return akunErrorResponse(e);
  }
};
