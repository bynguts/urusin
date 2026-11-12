import { GantiJudulRequestSchema, type GantiJudulResponse } from '@urusin/contracts';
import { kodeUntukPii } from '@urusin/harness';
import { apiError, apiJson, errorResponse, readBody } from '#lib/server/http.js';
import { getRuntime } from '#lib/server/runtime.js';
import { batasi } from '#lib/server/sesi.js';
import { urusanMilik } from '#lib/server/urusan-akses.js';
import type { RequestHandler } from './$types';

/**
 * Ganti nama urusan oleh warga (sidebar/Urusanku). Nama warga menang atas judul AI dan tidak pernah ditimpa.
 * NIK/HP/email ditolak readBody (422 PII_IN_PAYLOAD); bukan pemilik = 404.
 */
export const PUT: RequestHandler = async (event) => {
  let rt;
  try {
    rt = await getRuntime();
  } catch (e) {
    return errorResponse(e);
  }
  const ditolak = batasi(rt, event, 'turn');
  if (ditolak) return ditolak;
  const u = urusanMilik(rt, event.params.id, event.locals);
  if (!u) return apiError(404, 'NOT_FOUND', 'Urusan tidak ditemukan.');
  const body = await readBody(event.request, GantiJudulRequestSchema, {
    kodeKabKota: kodeUntukPii(rt.store, u),
  });
  if (!body.ok) return body.response;
  try {
    if (!rt.store.simpanJudul(u.id, body.data.judul, 'warga'))
      return apiError(422, 'BODY_INVALID', 'Nama urusan belum bisa disimpan. Coba nama lain.');
    const judul = rt.store.getUrusan(u.id)?.judul ?? body.data.judul;
    return apiJson({ judul } satisfies GantiJudulResponse);
  } catch (e) {
    return errorResponse(e);
  }
};
