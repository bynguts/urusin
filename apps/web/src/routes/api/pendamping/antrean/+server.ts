import { errorResponse } from '#lib/server/http.js';
import { panggil, pendampingConfig, skema, teruskan } from '#lib/server/pendamping.js';
import type { RequestHandler } from './$types';

/** Ringkasan antrean Browser Pendamping (tanpa data warga): aktif, maks, menunggu. */
export const GET: RequestHandler = async () => {
  try {
    return teruskan(await panggil(pendampingConfig(), '/internal/antrean', skema.antrean));
  } catch (e) {
    return errorResponse(e);
  }
};
