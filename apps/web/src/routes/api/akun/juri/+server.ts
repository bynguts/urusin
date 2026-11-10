import { JuriRequestSchema } from '@urusin/contracts';
import { akunErrorResponse, akunPublik, masukJuri, readAkunBody } from '#lib/server/akun.js';
import { apiJson } from '#lib/server/http.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

/**
 * "Masuk sebagai juri": salinan demo terisolasi berisi Data Diri sintetis (24 jam), tanpa sandi yang bisa
 * dikunci orang lain. Turnstile (bila dikonfigurasi) + batas per IP per hari (tahan NAT aula) + batas global.
 */
export const POST: RequestHandler = async (event) => {
  const body = await readAkunBody(event.request, JuriRequestSchema);
  if (!body.ok) return body.response;
  try {
    const rt = await getRuntime();
    const akun = await masukJuri(rt, event, body.data.turnstile);
    return apiJson({ akun: akunPublik(rt, akun), next: '/beranda' });
  } catch (e) {
    return akunErrorResponse(e);
  }
};
