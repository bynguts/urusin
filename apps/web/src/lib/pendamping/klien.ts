import type { PabrikViewer } from './tipe.js';

/**
 * Titik colok klien Browser Pendamping. Paket `@urusin/pendamping-client` masih di branch feat/browser-pendamping,
 * jadi di main fungsi ini mengembalikan null dan layar menampilkan keadaan "belum tersedia". Setelah merge,
 * ganti isinya dengan (dimuat malas agar tidak masuk JS awal rute lain):
 *
 *   const m = await import('@urusin/pendamping-client');
 *   return (canvas, wsUrl, opsi) => m.createPendampingViewer(canvas, wsUrl, opsi);
 */
export async function muatPabrikViewer(): Promise<PabrikViewer | null> {
  return null;
}
