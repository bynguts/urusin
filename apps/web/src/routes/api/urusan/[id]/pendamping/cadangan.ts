import { alurSimulasiUntuk, rutePendamping, urusanRute } from '@urusin/harness';
import { routeByKode } from '@urusin/registry';
import { akunDari, peranPendamping } from '#lib/server/pendamping/pemilik.js';
import type { Akses } from './akses';
import type { ExecutionPayload } from './hasil';
import type { z } from 'zod';

/** `executionId` tetap untuk simulasi cadangan (tidak ada `execution_request` yang ditawarkan). */
export const EKSEKUSI_SIMULASI = 'simulasi';

/**
 * Simulasi cadangan demo juri: portal wilayah ini hanya menerima jaringan Indonesia dan worker berjaringan
 * Indonesia sedang mati, jadi rencana dipandu tanpa `execution_request`. Replika uji tidak butuh jaringan
 * Indonesia, jadi juri tetap bisa melihat contoh pengisian. Situs resmi tetap tidak dibuka. Selain itu
 * (bukan juri, rute lain, portal tanpa formulir simulasi) → null.
 */
export async function simulasiCadangan(
  request: Request,
  a: Extract<Akses, { ok: true }>,
): Promise<z.infer<typeof ExecutionPayload> | null> {
  if (peranPendamping(await akunDari(request)) !== 'juri') return null;
  const rute = rutePendamping(urusanRute(a.rt.store, a.u));
  if (rute.jalur !== 'dipandu' || rute.sebab !== 'jaringan_id' || !a.u.kodeKabKota) return null;
  const origin = routeByKode(a.u.kodeKabKota).entry.portal?.origin;
  const sim = origin ? alurSimulasiUntuk(origin) : undefined;
  if (!origin || !sim) return null;
  return { executionId: EKSEKUSI_SIMULASI, adapterId: sim.adapterId, flowId: sim.flowId, params: {}, origin };
}
