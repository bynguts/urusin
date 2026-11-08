import type { PabrikViewer } from './tipe.js';

/**
 * Titik colok klien Browser Pendamping. Paket dimuat malas agar tidak masuk JS awal rute lain.
 */
export async function muatPabrikViewer(): Promise<PabrikViewer | null> {
  const m = await import('@urusin/pendamping-client');
  return (canvas, wsUrl, opsi) => m.createPendampingViewer(canvas, wsUrl, opsi);
}
