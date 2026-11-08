import { daftarKota } from '#lib/server/referensi.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({
  kota: daftarKota().map((k) => ({ kodeKabKota: k.kodeKabKota, nama: k.nama })),
});
