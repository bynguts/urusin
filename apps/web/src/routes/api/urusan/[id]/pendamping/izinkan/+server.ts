import { IzinkanIsiRequestSchema } from '@urusin/contracts';
import { errorResponse, readBody } from '#lib/server/http.js';
import { pendampingConfig, sidDariRequest, teruskan } from '#lib/server/pendamping.js';
import { izinkanIsiSesi } from '#lib/server/pendamping/izinkan.js';
import { akses } from '../akses';
import type { RequestHandler } from './$types';

/**
 * Warga menekan "Izinkan isi": body hanya hash daftar write yang ditampilkan. Nilai Data Diri/Dokumen
 * diselesaikan dan dikirim ke sesi di server (A-M1); jawabannya hanya label yang harus warga isi sendiri.
 */
export const POST: RequestHandler = async ({ request, params }) => {
  const body = await readBody(request, IzinkanIsiRequestSchema);
  if (!body.ok) return body.response;
  try {
    const a = await akses(request, params.id);
    if (!a.ok) return a.response;
    const r = await izinkanIsiSesi(pendampingConfig(), {
      owner: { urusanId: a.u.id, sidHash: a.sidHash },
      // akses() sudah memastikan cookie sesi ada dan sah.
      peminta: { sid: sidDariRequest(request)! },
      writeListHash: body.data.writeListHash,
    });
    return teruskan(r.ok ? { ...r, status: 200 } : r);
  } catch (e) {
    return errorResponse(e);
  }
};
