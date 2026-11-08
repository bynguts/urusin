import type { ExecutionResultRequest } from '@urusin/contracts';
import { canTransition, type UrusanRow, type UrusanState } from '@urusin/harness';
import { routeByKode } from '@urusin/registry';
import type { Runtime } from '#lib/server/runtime.js';

type Status = ExecutionResultRequest['status'];
type Sumber = 'Ekstensi' | 'Browser Pendamping';

const label = (sumber: Sumber, status: Status) =>
  ({
    berhasil: `${sumber} melaporkan langkah berhasil.`,
    gagal: `${sumber} melaporkan langkah gagal.`,
    dibatalkan: `Anda membatalkan langkah di ${sumber.toLowerCase()}.`,
    drift: 'Tampilan situs berubah. Kami beralih ke panduan langkah.',
  })[status];

/**
 * Catat hasil sebuah `execution_request` (sekali saja) dan terapkan transisi state: `berhasil` -> TERKIRIM
 * bila state mengizinkan, `drift` -> DIPANDU. Dipakai laporan ekstensi dan sinkron status Browser Pendamping.
 * Mengembalikan null bila hasil untuk executionId ini sudah pernah dicatat.
 */
export function catatHasilEksekusi(
  rt: Runtime,
  u: UrusanRow,
  executionId: string,
  status: Status,
  sumber: Sumber = 'Ekstensi',
  /** Label progres pengganti bila alasan sebenarnya bukan perubahan tampilan (mis. worker wilayah mati). */
  labelKhusus?: string,
): UrusanRow | null {
  if (!rt.store.recordExecutionResult(u.id, executionId, status)) return null;
  const ke: UrusanState | null = status === 'berhasil' ? 'TERKIRIM' : status === 'drift' ? 'DIPANDU' : null;
  rt.publish(u.id, { type: 'progress', label: labelKhusus ?? label(sumber, status) });
  if (status === 'drift') rt.publish(u.id, { type: 'degraded', kapabilitas: ['adapter'], mode: null });
  if (!ke || !canTransition(u.state, ke)) return u;
  const current = rt.store.transition(u.id, u.version, ke);
  const kode = u.kodeKabKota;
  rt.publish(u.id, {
    type: 'state',
    state: ke,
    tier: kode ? routeByKode(kode).entry.tier : null,
    version: current.version,
    dari: u.state,
  });
  return current;
}
