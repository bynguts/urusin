import { errorResponse } from '#lib/server/http.js';
import { panggilPemilik, pendampingConfig, skema, teruskan } from '#lib/server/pendamping.js';
import { akses } from '../akses';
import type { RequestHandler } from './$types';

/** Serahkan kendali ke warga (takeover): AI berhenti setelah langkah yang sedang berjalan. */
export const POST: RequestHandler = async ({ request, params }) => {
  try {
    const a = await akses(request, params.id);
    if (!a.ok) return a.response;
    const owner = { urusanId: a.u.id, sidHash: a.sidHash };
    return teruskan(await panggilPemilik(pendampingConfig(), '/internal/sesi/serahkan', skema.sesi, owner));
  } catch (e) {
    return errorResponse(e);
  }
};
