import { errorResponse } from '#lib/server/http.js';
import { antreanGabungan, pendampingConfig, teruskan } from '#lib/server/pendamping.js';
import type { RequestHandler } from './$types';

/** Ringkasan antrean Browser Pendamping gabungan semua worker sehat (tanpa data warga): aktif, maks, menunggu. */
export const GET: RequestHandler = async () => {
  try {
    return teruskan(await antreanGabungan(pendampingConfig()));
  } catch (e) {
    return errorResponse(e);
  }
};
