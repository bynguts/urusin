import { TetapkanWilayahRequestSchema, type TetapkanWilayahResponse } from '@urusin/contracts';
import {
  TurnInProgressError,
  isTerminal,
  majukan,
  tetapkanWilayah,
  usulkanRencanaOtomatis,
} from '@urusin/harness';
import { apiError, apiJson, errorResponse, readBody } from '#lib/server/http.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

/**
 * Tombol "Ya, betul" di kartu wilayah: warga membenarkan kab/kota KTP (aksi terstruktur, bukan teks yang
 * ditafsirkan model). Wilayah tercatat dengan event audit; bila jenis urusan sudah diketahui, rencana yang benar
 * untuk wilayah itu langsung diusulkan. Model akses sama dengan /rencana/setujui (id urusan).
 */
export const POST: RequestHandler = async ({ request, params }) => {
  const body = await readBody(request, TetapkanWilayahRequestSchema);
  if (!body.ok) return body.response;
  try {
    const rt = await getRuntime();
    const u = rt.store.getUrusan(params.id);
    if (!u) return apiError(404, 'NOT_FOUND', 'Urusan tidak ditemukan.');
    if (isTerminal(u.state)) return apiError(409, 'TERMINAL', 'Urusan ini sudah selesai.');
    if (rt.running.has(u.id) || rt.store.hasRunningTurn(u.id)) throw new TurnInProgressError();
    const publish = (e: Parameters<typeof rt.publish>[1]) => void rt.publish(u.id, e);
    let cur = tetapkanWilayah(
      rt.store,
      { ...u, version: body.data.expectedVersion ?? u.version },
      { ktp: body.data.kodeKabKota },
      publish,
    );
    if (cur.state === 'BARU') cur = majukan(rt.store, cur, ['MEMAHAMI'], publish);
    const sebelum = cur.state;
    cur = usulkanRencanaOtomatis(rt.store, cur, publish, rt.deps.ragDb);
    return apiJson({
      state: cur.state,
      version: cur.version,
      rencana: sebelum !== 'RENCANA_DIUSULKAN' && cur.state === 'RENCANA_DIUSULKAN',
    } satisfies TetapkanWilayahResponse);
  } catch (e) {
    return errorResponse(e);
  }
};
