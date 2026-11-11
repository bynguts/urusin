import { error } from '@sveltejs/kit';
import { KodeKabKotaSchema } from '@urusin/contracts';
import { wilayahByKode } from '@urusin/registry';
import { findPeristiwa } from '#lib/peristiwa.js';
import { pemilikVault } from '#lib/server/akun.js';
import { segarkanJaringanId } from '#lib/server/pendamping.js';
import { daftarKota, peristiwaView } from '#lib/server/referensi.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { PageServerLoad } from './$types';

/**
 * Rencana peristiwa (★2): langkah + sumber resmi untuk kab/kota terpilih (`?kodeKabKota=`), tanpa JS pun jalan.
 * Tanpa pilihan: kab/kota KTP di Data Diri akun (bila ada) diisikan sebagai usulan; di urusan tetap dikonfirmasi.
 */
export const load: PageServerLoad = async (event) => {
  const { params, url } = event;
  const peristiwa = findPeristiwa(params.slug);
  if (!peristiwa) error(404, 'Peristiwa tidak ditemukan');
  const raw = url.searchParams.get('kodeKabKota');
  let kode = raw && KodeKabKotaSchema.safeParse(raw).success && wilayahByKode(raw) ? raw : null;
  let dariDataDiri = false;
  if (!kode && raw === null) {
    const rt = await getRuntime();
    const p = pemilikVault(rt, event, { buat: false });
    const k = p ? rt.akun.vault.getDataDiri(p.id)?.data.kodeKabKota : undefined;
    if (typeof k === 'string' && wilayahByKode(k)) {
      kode = k;
      dariDataDiri = true;
    }
  }
  if (kode) await segarkanJaringanId();
  const rencana = peristiwa.slug === 'lainnya' ? null : peristiwaView(peristiwa.slug, kode);
  const kota = daftarKota().map((k) => ({ kodeKabKota: k.kodeKabKota, nama: k.nama }));
  return { peristiwa, rencana, kota, kodeDipilih: kode, dariDataDiri };
};
