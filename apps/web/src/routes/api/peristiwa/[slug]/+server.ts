import { KodeKabKotaSchema, type PeristiwaResponse } from '@urusin/contracts';
import { findBundel, routeByKode } from '@urusin/registry';
import { apiError, apiJson } from '#lib/server/http.js';
import { kotaView } from '#lib/server/referensi.js';
import type { RequestHandler } from './$types';

/** Langkah online/offline sebuah Peristiwa Hidup beserta sumber resmi; `?kodeKabKota=` memilih tier kota. */
export const GET: RequestHandler = ({ params, url }) => {
  const bundel = findBundel(params.slug);
  if (!bundel) return apiError(404, 'NOT_FOUND', 'Peristiwa ini belum tersedia.');

  const rawKode = url.searchParams.get('kodeKabKota');
  let kota: ReturnType<typeof kotaView> | null = null;
  if (rawKode !== null) {
    if (!KodeKabKotaSchema.safeParse(rawKode).success)
      return apiError(422, 'KODE_INVALID', 'Kode kabupaten/kota harus empat angka.');
    kota = kotaView(routeByKode(rawKode).entry);
  }

  return apiJson({
    slug: bundel.slug,
    judul: bundel.judul,
    tier: kota?.tier ?? bundel.tier,
    kodeKabKota: kota?.kodeKabKota ?? null,
    kota,
    keluaran: bundel.keluaran,
    ...(bundel.peringatan ? { peringatan: bundel.peringatan } : {}),
    catatan: bundel.catatan,
    langkah: bundel.langkah.map((l) => ({
      id: l.id,
      judul: l.judul,
      jenis: l.jenis,
      ...(l.lokasi ? { lokasi: l.lokasi } : {}),
      dependsOn: l.dependsOn,
      dokumen: l.dokumen,
      bawa: l.bawa,
      keterangan: l.keterangan,
      sumber: l.sourceRef,
      verifiedAt: l.verifiedAt,
    })),
  } satisfies PeristiwaResponse);
};
