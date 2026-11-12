import { redirect } from '@sveltejs/kit';
import { DAERAH_PENDAMPING_AKTIF } from '@urusin/registry';
import { mulaiUrusanDariForm } from '#lib/server/mulai-urusan.js';
import { getRuntime } from '#lib/server/runtime.js';
import { bacaTerakhir, SID_COOKIE } from '#lib/server/sesi.js';
import { urusanMilik } from '#lib/server/urusan-akses.js';
import type { Actions, PageServerLoad } from './$types';

/** Landing tetap publik; akun yang punya urusan terakhir di perangkat ini langsung ke Beranda. */
export const load: PageServerLoad = async ({ cookies, locals }) => {
  // Klaim cakupan Browser Pendamping dari satu sumber kebenaran (ADR 0033).
  const data = { jumlahDaerahPendamping: DAERAH_PENDAMPING_AKTIF.length };
  if (!locals.akun) return data;
  const id = bacaTerakhir(cookies);
  if (!id) return data;
  const rt = await getRuntime();
  if (urusanMilik(rt, id, { akun: locals.akun, sid: cookies.get(SID_COOKIE) })) redirect(303, '/beranda');
  return data;
};

export const actions: Actions = {
  /**
   * Mulai urusan dari kartu landing/katalog atau tombol di halaman peristiwa (jalan tanpa JavaScript). Wajib akun:
   * tanpa sesi → /daftar?next=/peristiwa/<slug>, lalu warga kembali ke rencana itu setelah daftar.
   */
  mulai: (event) => mulaiUrusanDariForm(event),
};

/** Landing statis (frame n2rpg): tanpa hidrasi, nol JS di halaman ini; formulir tetap jalan lewat POST. */
export const csr = false;
