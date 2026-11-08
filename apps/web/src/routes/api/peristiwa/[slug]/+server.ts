import { KodeKabKotaSchema } from '@urusin/contracts';
import { apiError, apiJson } from '#lib/server/http.js';
import { peristiwaView } from '#lib/server/referensi.js';
import type { RequestHandler } from './$types';

/** Langkah online/offline sebuah Peristiwa Hidup beserta sumber resmi; `?kodeKabKota=` memilih tier kota. */
export const GET: RequestHandler = ({ params, url }) => {
  const rawKode = url.searchParams.get('kodeKabKota');
  if (rawKode !== null && !KodeKabKotaSchema.safeParse(rawKode).success)
    return apiError(422, 'KODE_INVALID', 'Kode kabupaten/kota harus empat angka.');
  const view = peristiwaView(params.slug, rawKode);
  if (!view) return apiError(404, 'NOT_FOUND', 'Peristiwa ini belum tersedia.');
  return apiJson(view);
};
