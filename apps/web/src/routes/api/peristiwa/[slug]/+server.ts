import { KodeKabKotaSchema } from '@urusin/contracts';
import { apiError, apiJson } from '#lib/server/http.js';
import { segarkanJaringanId } from '#lib/server/pendamping.js';
import { peristiwaView } from '#lib/server/referensi.js';
import type { RequestHandler } from './$types';

/** Langkah online/offline sebuah Peristiwa Hidup beserta sumber resmi; `?kodeKabKota=` memilih tier kota. */
export const GET: RequestHandler = async ({ params, url }) => {
  const rawKode = url.searchParams.get('kodeKabKota');
  if (rawKode !== null && !KodeKabKotaSchema.safeParse(rawKode).success)
    return apiError(422, 'KODE_INVALID', 'Kode kabupaten/kota harus empat angka.');
  if (rawKode !== null) await segarkanJaringanId();
  const view = peristiwaView(params.slug, rawKode);
  if (!view) return apiError(404, 'NOT_FOUND', 'Peristiwa ini belum tersedia.');
  return apiJson(view);
};
