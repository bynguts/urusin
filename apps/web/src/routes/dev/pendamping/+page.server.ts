import { error } from '@sveltejs/kit';
import { isDev } from '#lib/server/dev.js';
import type { PageServerLoad } from './$types';

/** Pratinjau keadaan Browser Pendamping (frame rFa2b/UGOeh). HANYA mode dev: di produksi 404. */
export const load: PageServerLoad = () => {
  if (!isDev()) error(404, 'Halaman tidak ditemukan');
};
