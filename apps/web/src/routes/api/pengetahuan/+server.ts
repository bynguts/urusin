import { KodeKabKotaSchema, type PengetahuanResponse } from '@urusin/contracts';
import { cariPengetahuanTool } from '@urusin/rag';
import { apiError, apiJson, errorResponse } from '#lib/server/http.js';
import { perluDicekUlang } from '#lib/server/referensi.js';
import { getRuntime } from '#lib/server/runtime.js';
import { detectPii } from '@urusin/core';
import type { RequestHandler } from './$types';

/** Pencarian pengetahuan resmi untuk layar "cari". Tanpa LLM; kueri berisi data pribadi ditolak. */
export const GET: RequestHandler = async ({ url }) => {
  const q = (url.searchParams.get('q') ?? '').trim();
  if (q.length < 2 || q.length > 200)
    return apiError(422, 'QUERY_INVALID', 'Tulis kata kunci 2 sampai 200 huruf.');
  if (detectPii(q).length > 0)
    return apiError(
      422,
      'PII_IN_PAYLOAD',
      'Kata kunci berisi nomor pribadi. Hapus nomornya, lalu coba lagi.',
    );
  const kode = url.searchParams.get('kodeKabKota');
  if (kode !== null && !KodeKabKotaSchema.safeParse(kode).success)
    return apiError(422, 'KODE_INVALID', 'Kode kabupaten/kota harus empat angka.');
  try {
    const rt = await getRuntime();
    if (!rt.deps.ragDb)
      return apiJson({ hasil: [], abstain: { alasan: 'di_luar_cakupan' } } satisfies PengetahuanResponse);
    const out = cariPengetahuanTool.execute(rt.deps.ragDb, {
      query: q,
      ...(kode ? { kodeKabKota: kode } : {}),
      k: 5,
    });
    const now = new Date();
    return apiJson({
      hasil: out.hasil.map((h) => ({
        refId: h.id,
        judul: h.kutipan.judul,
        instansi: h.kutipan.instansi,
        url: h.kutipan.url,
        cuplikan: h.text.slice(0, 280),
        verifiedAt: h.verifiedAt,
        perluDicekUlang: perluDicekUlang(h.verifiedAt, now),
      })),
      abstain: out.tanpaHasil
        ? { alasan: out.alasan === 'skor_rendah' ? 'skor_rendah' : 'di_luar_cakupan' }
        : null,
    } satisfies PengetahuanResponse);
  } catch (e) {
    return errorResponse(e);
  }
};
