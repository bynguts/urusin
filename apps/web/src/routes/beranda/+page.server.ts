import { redirect } from '@sveltejs/kit';
import { mulaiUrusanDariForm } from '#lib/server/mulai-urusan.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * Beranda (App 01): dashboard utama, memerlukan autentikasi (login / daftar).
 * Pengunjung yang belum terautentikasi dialihkan ke /masuk.
 */
export const load: PageServerLoad = ({ locals, url }) => {
  if (!locals.akun) {
    const lanjut = url.search ? `${url.pathname}${url.search}` : url.pathname;
    redirect(303, `/masuk?lanjut=${encodeURIComponent(lanjut)}`);
  }
};

export const actions: Actions = {
  /** Mulai urusan dari kotak cerita Beranda (jalan tanpa JavaScript). Tanpa sesi → /daftar lalu kembali. */
  mulai: (event) => mulaiUrusanDariForm(event),
};
