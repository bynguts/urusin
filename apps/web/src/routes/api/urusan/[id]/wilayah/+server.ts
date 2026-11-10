import { TetapkanWilayahRequestSchema, type TetapkanWilayahResponse } from '@urusin/contracts';
import {
  TurnInProgressError,
  isTerminal,
  majukan,
  tetapkanWilayah,
  usulkanRencanaOtomatis,
  wilayahUrusan,
} from '@urusin/harness';
import { apiError, apiJson, errorResponse, readBody } from '#lib/server/http.js';
import { getRuntime } from '#lib/server/runtime.js';
import { batasi } from '#lib/server/sesi.js';
import type { RequestHandler } from './$types';

/**
 * Tombol "Ya, betul" di kartu wilayah: warga membenarkan kab/kota KTP (aksi terstruktur, bukan teks yang
 * ditafsirkan model). Wilayah tercatat dengan event audit; bila jenis urusan sudah diketahui, rencana yang benar
 * untuk wilayah itu langsung diusulkan. Model akses sama dengan /rencana/setujui (id urusan).
 *
 * Kartu bisa basi (perangkat lain, atau warga sudah menyebut wilayahnya di obrolan), jadi endpoint ini hanya
 * MENETAPKAN, tidak pernah mengganti: wilayah KTP yang sama → 200 tanpa perubahan; wilayah lain yang sudah
 * dipastikan → 409 WILAYAH_SUDAH_DITETAPKAN (ganti lewat obrolan); hanya di BARU/MEMAHAMI.
 */
export const POST: RequestHandler = async (event) => {
  const { request, params } = event;
  const body = await readBody(request, TetapkanWilayahRequestSchema);
  if (!body.ok) return body.response;
  try {
    const rt = await getRuntime();
    const ditolak = batasi(rt, event, 'turn');
    if (ditolak) return ditolak;
    const u = rt.store.getUrusan(params.id);
    if (!u) return apiError(404, 'NOT_FOUND', 'Urusan tidak ditemukan.');
    if (isTerminal(u.state)) return apiError(409, 'TERMINAL', 'Urusan ini sudah selesai.');
    const sudah = wilayahUrusan(rt.store, u).ktp;
    if (sudah?.kodeKabKota === body.data.kodeKabKota)
      return apiJson({
        state: u.state,
        version: u.version,
        rencana: false,
      } satisfies TetapkanWilayahResponse);
    if (sudah)
      return apiError(
        409,
        'WILAYAH_SUDAH_DITETAPKAN',
        `Wilayah KTP urusan ini sudah dipastikan: ${sudah.nama}. Untuk menggantinya, sampaikan di obrolan.`,
      );
    if (u.state !== 'BARU' && u.state !== 'MEMAHAMI')
      return apiError(409, 'WILAYAH_TERKUNCI', 'Wilayah tidak bisa ditetapkan lewat kartu pada tahap ini.');
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
