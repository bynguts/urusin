import { TetapkanWilayahRequestSchema, type TetapkanWilayahResponse } from '@urusin/contracts';
import {
  TurnInProgressError,
  isTerminal,
  majukan,
  tetapkanWilayah,
  usulkanRencanaOtomatis,
  wilayahUrusan,
} from '@urusin/harness';
import { pastikanTamuUntukTurn } from '#lib/server/akun.js';
import { apiError, apiJson, errorResponse, readBody } from '#lib/server/http.js';
import { getRuntime, startTurnInBackground } from '#lib/server/runtime.js';
import { batasi } from '#lib/server/sesi.js';
import { urusanMilik } from '#lib/server/urusan-akses.js';
import type { RequestHandler } from './$types';

/**
 * Tombol "Ya, betul" di kartu wilayah: warga membenarkan kab/kota KTP (aksi terstruktur, bukan teks yang
 * ditafsirkan model). Wilayah tercatat dengan event audit; bila jenis urusan sudah diketahui, rencana yang benar
 * untuk wilayah itu langsung diusulkan. Hanya pemilik urusan (urusanMilik), sama dengan /rencana/setujui.
 *
 * Kartu bisa basi (perangkat lain, atau warga sudah menyebut wilayahnya di obrolan), jadi endpoint ini hanya
 * MENETAPKAN, tidak pernah mengganti: wilayah KTP yang sama → 200 tanpa perubahan; wilayah lain yang sudah
 * dipastikan → 409 WILAYAH_SUDAH_DITETAPKAN (ganti lewat obrolan); hanya di BARU/MEMAHAMI.
 *
 * Urusan tanpa rencana Peristiwa Hidup (KTP rusak, KK, SKCK, ...) yang sudah punya percakapan: agen langsung
 * melanjutkan pertanyaan warga untuk wilayah ini, agar menekan "Ya, betul" tidak berakhir buntu.
 */
export const POST: RequestHandler = async (event) => {
  const { request, params } = event;
  const body = await readBody(request, TetapkanWilayahRequestSchema);
  if (!body.ok) return body.response;
  try {
    const rt = await getRuntime();
    const ditolak = batasi(rt, event, 'turn');
    if (ditolak) return ditolak;
    // Bukan pemilik = sama dengan tidak ada (404): wilayah urusan orang lain tidak bisa ditetapkan.
    const u = urusanMilik(rt, params.id, event.locals);
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
    const rencana = sebelum !== 'RENCANA_DIUSULKAN' && cur.state === 'RENCANA_DIUSULKAN';
    const nama = wilayahUrusan(rt.store, cur).ktp?.nama;
    const lanjut =
      !rencana && nama && rt.store.loadHistory(cur.id).length > 0 && !pastikanTamuUntukTurn(rt, event)
        ? startTurnInBackground(rt, {
            urusanId: cur.id,
            userText: `Ya, KTP saya terdaftar di ${nama}.`,
            expectedVersion: cur.version,
          })
        : undefined;
    return apiJson({
      state: cur.state,
      version: cur.version,
      rencana,
      ...(lanjut ? { turnId: lanjut.turnId } : {}),
    } satisfies TetapkanWilayahResponse);
  } catch (e) {
    return errorResponse(e);
  }
};
