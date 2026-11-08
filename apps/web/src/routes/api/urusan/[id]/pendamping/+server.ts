import { MulaiPendampingRequestSchema } from '@urusin/contracts';
import { routeByKode } from '@urusin/registry';
import { z } from 'zod';
import { catatHasilEksekusi } from '#lib/server/eksekusi.js';
import { apiError, apiJson, errorResponse, readBody } from '#lib/server/http.js';
import {
  hasilAkhir,
  labelBukti,
  mulaiSesi,
  panggilPemilik,
  pendampingConfig,
  skema,
  teruskan,
} from '#lib/server/pendamping.js';
import { akses } from './akses';
import type { RequestHandler } from './$types';

const ExecutionPayload = z.object({
  executionId: z.string(),
  adapterId: z.string().min(1),
  flowId: z.string().min(1),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});

/**
 * Mulai Browser Pendamping untuk `execution_request` yang sudah disetujui warga (layar konfirmasi). Langkah
 * berasal dari adapter bawaan di layanan pendamping, bukan dari model; origin dari registry kota.
 */
export const POST: RequestHandler = async ({ request, params }) => {
  const body = await readBody(request, MulaiPendampingRequestSchema);
  if (!body.ok) return body.response;
  try {
    const a = await akses(request, params.id);
    if (!a.ok) return a.response;
    const offered = ExecutionPayload.safeParse(
      a.rt.store.findOffered(a.u.id, 'execution_request', { executionId: body.data.executionId }),
    );
    if (!offered.success)
      return apiError(404, 'EKSEKUSI_TIDAK_DITEMUKAN', 'Permintaan eksekusi ini tidak dikenal.');
    const origin = a.u.kodeKabKota ? routeByKode(a.u.kodeKabKota).entry.portal?.origin : undefined;
    if (!origin) return apiError(422, 'ADAPTER_TIDAK_ADA', 'Kota ini belum mendukung Browser Pendamping.');
    const r = await mulaiSesi(pendampingConfig(), {
      urusanId: a.u.id,
      sidHash: a.sidHash,
      executionId: offered.data.executionId,
      adapterId: offered.data.adapterId,
      flowId: offered.data.flowId,
      origin,
      params: offered.data.params,
      ...(body.data.viewport ? { viewport: body.data.viewport } : {}),
    });
    if (r.ok) a.rt.publish(a.u.id, { type: 'progress', label: 'Browser Pendamping disiapkan.' });
    // Situs khusus jaringan Indonesia tanpa worker wilayah yang hidup: jujur, lalu beralih ke panduan langkah.
    else if (r.dipandu)
      catatHasilEksekusi(a.rt, a.u, offered.data.executionId, 'drift', 'Browser Pendamping', r.dipandu);
    return teruskan(r);
  } catch (e) {
    return errorResponse(e);
  }
};

/**
 * Status sesi (layar antrean, banner mode). Saat execution berakhir (sesi selesai atau siaga), hasilnya
 * dicatat ke urusan sekali, beserta bukti dari halaman konfirmasi (nomor registrasi/status) bila ada.
 */
export const GET: RequestHandler = async ({ request, params }) => {
  try {
    const a = await akses(request, params.id, true);
    if (!a.ok) return a.response;
    const r = await panggilPemilik(pendampingConfig(), '/internal/sesi/status', skema.sesi, {
      urusanId: a.u.id,
      sidHash: a.sidHash,
    });
    if (!r.ok) return r.response;
    const hasil = hasilAkhir(r.data);
    if (
      hasil &&
      a.rt.store.findOffered(a.u.id, 'execution_request', { executionId: r.data.executionId }) &&
      catatHasilEksekusi(a.rt, a.u, r.data.executionId, hasil, 'Browser Pendamping')
    ) {
      const bukti = labelBukti(r.data);
      if (bukti) a.rt.publish(a.u.id, { type: 'progress', label: bukti });
    }
    return apiJson(r.data);
  } catch (e) {
    return errorResponse(e);
  }
};

/** Akhiri sesi sekarang: peramban dan semua data di memorinya dihancurkan. */
export const DELETE: RequestHandler = async ({ request, params }) => {
  try {
    const a = await akses(request, params.id, true);
    if (!a.ok) return a.response;
    const owner = { urusanId: a.u.id, sidHash: a.sidHash };
    return teruskan(await panggilPemilik(pendampingConfig(), '/internal/sesi/akhiri', skema.sesi, owner));
  } catch (e) {
    return errorResponse(e);
  }
};
