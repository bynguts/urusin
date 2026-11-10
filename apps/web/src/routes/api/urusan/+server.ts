import {
  BuatUrusanRequestSchema,
  type BuatUrusanResponse,
  type DaftarUrusanResponse,
} from '@urusin/contracts';
import { pastikanTamuUntukTurn } from '#lib/server/akun.js';
import { apiError, apiJson, errorResponse, readBody } from '#lib/server/http.js';
import { getRuntime, startTurnInBackground } from '#lib/server/runtime.js';
import { usulkanWilayahAwal } from '#lib/server/mulai-urusan.js';
import { menungguSiapa } from '#lib/server/ringkasan.js';
import { batasi } from '#lib/server/sesi.js';
import type { RequestHandler } from './$types';

/** Buat urusan baru; bila `pesan` diberikan, turn pertama langsung berjalan (ikuti lewat stream). */
export const POST: RequestHandler = async (event) => {
  const body = await readBody(event.request, BuatUrusanRequestSchema);
  if (!body.ok) return body.response;
  try {
    const rt = await getRuntime();
    const ditolak = batasi(rt, event, 'buat');
    if (ditolak) return ditolak;
    if (body.data.pesan) {
      const tamu = pastikanTamuUntukTurn(rt, event);
      if (tamu) return tamu;
    }
    const jenis = body.data.peristiwa && body.data.peristiwa !== 'lainnya' ? body.data.peristiwa : undefined;
    // Wilayah belum ditetapkan saat dibuat: kodeKabKota dari klien hanya usulan (lihat usulkanWilayahAwal).
    const u = rt.store.createUrusan({ jenis });
    // Pemilik: akun/demo yang masuk, atau hash sid (dipindah ke akun saat warga masuk).
    rt.akun.catatPemilikUrusan(u.id, { akun: event.locals.akun, sid: event.locals.sid });
    // kodeKabKota dari klien hanya usulan; wilayah KTP ditetapkan setelah warga mengonfirmasi.
    usulkanWilayahAwal(rt, event, u.id, body.data.kodeKabKota, body.data.pesan);
    const turn = body.data.pesan
      ? startTurnInBackground(rt, { urusanId: u.id, userText: body.data.pesan })
      : undefined;
    const current = rt.store.getUrusanOrThrow(u.id);
    return apiJson(
      {
        id: u.id,
        state: current.state,
        version: current.version,
        chainHead: rt.store.chainHead(u.id),
        ...(turn ? { turnId: turn.turnId } : {}),
      } satisfies BuatUrusanResponse,
      201,
    );
  } catch (e) {
    return errorResponse(e);
  }
};

/**
 * Daftar urusan untuk /lacak. Klien menyebut id urusan yang tercatat di perangkatnya (`?ids=a,b`); hanya urusan
 * milik peminta (akun yang masuk atau cookie sesi ini) yang dijawab. Id lain diabaikan begitu saja.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
  const ids = (url.searchParams.get('ids') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^u_[0-9a-f]{32}$/.test(s));
  if (ids.length > 50)
    return apiError(422, 'TERLALU_BANYAK', 'Terlalu banyak urusan sekaligus. Maksimal 50.');
  try {
    const rt = await getRuntime();
    return apiJson({
      urusan: rt.store
        .listUrusan([...new Set(ids)].filter((id) => rt.akun.adalahPemilikUrusan(id, locals)))
        .map((u) => ({
          id: u.id,
          state: u.state,
          version: u.version,
          kodeKabKota: u.kodeKabKota,
          menunggu: menungguSiapa(u.state),
          dibuatPada: u.createdAt,
          diubahPada: u.updatedAt,
        })),
    } satisfies DaftarUrusanResponse);
  } catch (e) {
    return errorResponse(e);
  }
};
