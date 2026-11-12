import { DAFTAR_PENDAMPING_AKTIF } from '@urusin/registry';
import type { PageServerLoad } from './$types';

/** Halaman cara kerja statis (frame Web "Cara kerja"): tanpa hidrasi, nol JS di halaman ini. */
export const csr = false;

/** Cakupan Browser Pendamping dari satu sumber kebenaran (ADR 0032), supaya klaim halaman ini jujur. */
export const load: PageServerLoad = () => ({ daerahPendamping: DAFTAR_PENDAMPING_AKTIF });
