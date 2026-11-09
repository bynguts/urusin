import type { DaftarUrusanResponse } from '@urusin/contracts';
import { akunErrorResponse, wajibMasuk } from '#lib/server/akun.js';
import { apiJson } from '#lib/server/http.js';
import { menungguSiapa } from '#lib/server/ringkasan.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

/** Urusan milik akun (termasuk urusan tamu yang dipindahkan saat masuk): sama di HP dan laptop. */
export const GET: RequestHandler = async ({ locals }) => {
  const m = wajibMasuk(locals);
  if (!m.ok) return m.response;
  try {
    const rt = await getRuntime();
    return apiJson({
      urusan: rt.store.listUrusan(rt.akun.urusanMilik(m.id)).map((u) => ({
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
    return akunErrorResponse(e);
  }
};
