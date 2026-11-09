import { mulaiUrusanDariForm } from '#lib/server/mulai-urusan.js';
import type { Actions } from './$types';

/**
 * Beranda (App 01): kotak cerita, peristiwa hidup, dan urusan berjalan dari daftar di peramban ini.
 * Urusan berjalan dimuat di klien lewat /api/urusan; formulir cerita jalan tanpa JavaScript.
 */
export const actions: Actions = {
  /** Mulai urusan dari kotak cerita Beranda atau tombol di halaman peristiwa (jalan tanpa JavaScript). */
  mulai: (event) => mulaiUrusanDariForm(event),
};
