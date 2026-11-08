import { errorResponse } from '#lib/server/http.js';
import { panggil, pendampingConfig, skema, teruskan } from '#lib/server/pendamping.js';
import { akses } from '../akses';
import type { RequestHandler } from './$types';

/** Tiket WebSocket sekali pakai (maks 30 detik) untuk sesi milik cookie ini; dikirim klien sebagai pesan `halo`. */
export const POST: RequestHandler = async ({ request, params }) => {
  try {
    const a = await akses(request, params.id);
    if (!a.ok) return a.response;
    const owner = { urusanId: a.u.id, sidHash: a.sidHash };
    return teruskan(await panggil(pendampingConfig(), '/internal/sesi/tiket', skema.tiket, owner));
  } catch (e) {
    return errorResponse(e);
  }
};
