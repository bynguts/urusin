import { MulaiPendampingRequestSchema } from '@urusin/contracts';
import { matchOfficialOrigin } from '@urusin/core';
import { ADAPTER_GENERIK, mulaiPengajuan } from '@urusin/harness';
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
import { hentikanNavigator, mulaiNavigator } from '#lib/server/pendamping/navigator.js';
import { modeUjiPendamping } from '#lib/server/pendamping/pemilik.js';
import { akses } from './akses';
import type { RequestHandler } from './$types';

const ExecutionPayload = z.object({
  executionId: z.string(),
  adapterId: z.string().min(1),
  flowId: z.string().min(1),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  origin: z.url().optional(),
  bacaSaja: z.boolean().optional(),
});

/**
 * Mulai Browser Pendamping untuk `execution_request` yang sudah disetujui warga (layar konfirmasi). Langkah
 * berasal dari adapter bawaan di layanan pendamping, bukan dari model. Origin: yang dibawa permintaan (tool
 * baca-saja non-dukcapil, mis. Samsat/OSS; ditulis kode tool, tersimpan di event) atau portal kota dari registry.
 * Layanan pendamping menolak origin yang tidak sama dengan origin adapter.
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
    const origin =
      offered.data.origin ??
      (a.u.kodeKabKota ? routeByKode(a.u.kodeKabKota).entry.portal?.origin : undefined);
    if (!origin || !matchOfficialOrigin(origin).ok)
      return apiError(422, 'ADAPTER_TIDAK_ADA', 'Kota ini belum mendukung Browser Pendamping.');
    // Juri (salinan demo) dan tamu selalu ke replika uji; situs resmi asli hanya untuk akun warga pemiliknya.
    const modeUji = await modeUjiPendamping(request, a.u);
    const cfg = pendampingConfig();
    const r = await mulaiSesi(cfg, {
      urusanId: a.u.id,
      sidHash: a.sidHash,
      executionId: offered.data.executionId,
      adapterId: offered.data.adapterId,
      flowId: offered.data.flowId,
      origin,
      params: offered.data.params,
      modeUji,
      ...(body.data.viewport ? { viewport: body.data.viewport } : {}),
    });
    if (r.ok) {
      a.rt.publish(a.u.id, { type: 'progress', label: 'Browser Pendamping disiapkan.' });
      if (offered.data.bacaSaja !== true)
        mulaiPengajuan(a.rt.store, a.u.id, (e) => void a.rt.publish(a.u.id, e));
      // Portal wilayah tanpa adapter: otak Navigator generik di web menggerakkan sesi lewat kanal internal.
      if (offered.data.adapterId === ADAPTER_GENERIK)
        mulaiNavigator(
          a.rt,
          {
            urusan: a.u,
            executionId: offered.data.executionId,
            owner: { urusanId: a.u.id, sidHash: a.sidHash },
            modeUji,
          },
          { cfg },
        );
    }
    // Situs khusus jaringan Indonesia tanpa worker wilayah yang hidup: jujur, lalu beralih ke panduan langkah.
    else if (r.dipandu)
      catatHasilEksekusi(a.rt, a.u, offered.data.executionId, 'drift', 'Browser Pendamping', {
        labelKhusus: r.dipandu,
        bacaSaja: offered.data.bacaSaja === true,
      });
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
    const offered = hasil
      ? ExecutionPayload.safeParse(
          a.rt.store.findOffered(a.u.id, 'execution_request', { executionId: r.data.executionId }),
        )
      : undefined;
    if (
      hasil &&
      offered?.success &&
      catatHasilEksekusi(a.rt, a.u, r.data.executionId, hasil, 'Browser Pendamping', {
        bacaSaja: offered.data.bacaSaja === true,
      })
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
    hentikanNavigator(a.u.id);
    return teruskan(await panggilPemilik(pendampingConfig(), '/internal/sesi/akhiri', skema.sesi, owner));
  } catch (e) {
    return errorResponse(e);
  }
};
