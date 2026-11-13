import { redirect } from '@sveltejs/kit';
import { DAERAH_PENDAMPING_AKTIF } from '@urusin/registry';
import { mulaiUrusanDariForm } from '#lib/server/mulai-urusan.js';
import { getRuntime } from '#lib/server/runtime.js';
import { bacaTerakhir, SID_COOKIE } from '#lib/server/sesi.js';
import { urusanMilik } from '#lib/server/urusan-akses.js';
import type { Actions, PageServerLoad } from './$types';

/** Asal tautan sama dengan situs ini (mis. logo di aplikasi): warga sengaja membuka landing. */
function dariSitusSendiri(request: Request, url: URL): boolean {
  const ref = request.headers.get('referer');
  if (!ref) return false;
  try {
    return new URL(ref).host === url.host;
  } catch {
    return false;
  }
}

/**
 * Landing tetap publik; akun yang punya urusan terakhir di perangkat ini langsung ke Beranda saat membuka situs
 * dari luar. Logo di aplikasi sengaja membawa ke landing, jadi tautan dari situs sendiri tidak dialihkan.
 */
export const load: PageServerLoad = async ({ cookies, locals, request, url }) => {
  // Klaim cakupan Browser Pendamping dari satu sumber kebenaran (ADR 0033).
  const data = { jumlahDaerahPendamping: DAERAH_PENDAMPING_AKTIF.length };
  if (!locals.akun || dariSitusSendiri(request, url)) return data;
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
