import { mulaiUrusanDariForm } from '#lib/server/mulai-urusan.js';
import type { Actions } from './$types';

export const actions: Actions = {
  /** Mulai urusan dari kotak cerita Beranda atau tombol di halaman peristiwa (jalan tanpa JavaScript). */
  mulai: (event) => mulaiUrusanDariForm(event),
};
