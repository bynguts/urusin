import type { ExecutionResultRequest } from '@urusin/contracts';
import { canTransition, tierEksekusi, type UrusanRow, type UrusanState } from '@urusin/harness';
import type { Runtime } from '#lib/server/runtime.js';

type Status = ExecutionResultRequest['status'];
type Sumber = 'Browser Pendamping';

const label = (sumber: Sumber, status: Status) =>
  ({
    berhasil: `${sumber} melaporkan langkah berhasil.`,
    gagal: `${sumber} melaporkan langkah gagal.`,
    dibatalkan: `Anda membatalkan langkah di ${sumber.toLowerCase()}.`,
    drift: 'Tampilan situs berubah. Kami beralih ke panduan langkah.',
  })[status];

/**
 * Catat hasil sebuah `execution_request` (sekali saja) dan terapkan transisi state: `berhasil` -> TERKIRIM
 * bila state mengizinkan, `drift` -> DIPANDU. Satu-satunya pelapor: status tepercaya dari worker Browser
 * Pendamping (GET /api/urusan/[id]/pendamping); endpoint laporan ekstensi sudah dihapus bersama ekstensinya.
 * Alur baca-saja (cek status, PKB, NIB) tidak mengirim apa pun: hasilnya dicatat tanpa transisi state.
 * Mengembalikan null bila hasil untuk executionId ini sudah pernah dicatat.
 */
export function catatHasilEksekusi(
  rt: Runtime,
  u: UrusanRow,
  executionId: string,
  status: Status,
  sumber: Sumber = 'Browser Pendamping',
  opsi: {
    /** Label progres pengganti bila alasan sebenarnya bukan perubahan tampilan (mis. worker wilayah mati). */
    labelKhusus?: string;
    bacaSaja?: boolean;
  } = {},
): UrusanRow | null {
  if (!rt.store.recordExecutionResult(u.id, executionId, status)) return null;
  const ke: UrusanState | null = opsi.bacaSaja
    ? null
    : status === 'berhasil'
      ? 'TERKIRIM'
      : status === 'drift'
        ? 'DIPANDU'
        : null;
  const teks =
    opsi.bacaSaja && status === 'berhasil'
      ? `${sumber} selesai membuka hasilnya. Tidak ada yang dikirim.`
      : label(sumber, status);
  rt.publish(u.id, { type: 'progress', label: opsi.labelKhusus ?? teks });
  if (status === 'drift') rt.publish(u.id, { type: 'degraded', kapabilitas: ['adapter'], mode: null });
  if (!ke || !canTransition(u.state, ke)) return u;
  const current = rt.store.transition(u.id, u.version, ke);
  rt.publish(u.id, {
    type: 'state',
    state: ke,
    // Tier dibekukan per eksekusi (saat ditawarkan), bukan kesehatan worker ID saat hasil tiba.
    tier: tierEksekusi(rt.store, u),
    version: current.version,
    dari: u.state,
  });
  return current;
}
