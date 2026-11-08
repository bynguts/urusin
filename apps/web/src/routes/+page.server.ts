import { redirect } from '@sveltejs/kit';
import { mulaiUrusanDariForm } from '#lib/server/mulai-urusan.js';
import { getRuntime } from '#lib/server/runtime.js';
import { bacaTerakhir } from '#lib/server/sesi.js';
import type { Actions, PageServerLoad } from './$types';

/** Landing untuk pengunjung baru; peramban yang punya urusan berjalan langsung ke Ringkasan. */
export const load: PageServerLoad = async ({ cookies }) => {
  const id = bacaTerakhir(cookies);
  if (!id) return;
  const rt = await getRuntime();
  if (rt.store.getUrusan(id)) redirect(303, '/beranda');
};

export const actions: Actions = {
  /** Mulai urusan dari kotak cerita Beranda atau tombol di halaman peristiwa (jalan tanpa JavaScript). */
  mulai: (event) => mulaiUrusanDariForm(event),
};
