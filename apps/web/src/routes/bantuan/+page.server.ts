import { daftarKota } from '#lib/server/referensi.js';
import type { PageServerLoad } from './$types';

/** Bantuan (App 13): kontak Disdukcapil diambil dari registri kab/kota, bukan teks tetap. */
export const load: PageServerLoad = () => ({ kota: daftarKota() });
