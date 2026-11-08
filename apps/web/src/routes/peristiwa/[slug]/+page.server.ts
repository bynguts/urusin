import { error } from '@sveltejs/kit';
import { KodeKabKotaSchema } from '@urusin/contracts';
import { findPeristiwa } from '#lib/peristiwa.js';
import { daftarKota, peristiwaView } from '#lib/server/referensi.js';
import type { PageServerLoad } from './$types';

/** Rencana peristiwa (★2): langkah + sumber resmi untuk kab/kota terpilih (`?kodeKabKota=`), tanpa JS pun jalan. */
export const load: PageServerLoad = ({ params, url }) => {
  const peristiwa = findPeristiwa(params.slug);
  if (!peristiwa) error(404, 'Peristiwa tidak ditemukan');
  const raw = url.searchParams.get('kodeKabKota');
  const kode = raw && KodeKabKotaSchema.safeParse(raw).success ? raw : null;
  const rencana = peristiwa.slug === 'lainnya' ? null : peristiwaView(peristiwa.slug, kode);
  const kota = daftarKota().map((k) => ({ kodeKabKota: k.kodeKabKota, nama: k.nama }));
  return { peristiwa, rencana, kota, kodeDipilih: kode };
};
