import { isTerminal, type UrusanState } from '@urusin/harness';
import type { RingkasanUrusan } from '@urusin/contracts';

const MENUNGGU_WARGA: ReadonlySet<UrusanState> = new Set([
  'RENCANA_DIUSULKAN',
  'BERKAS_SIAP',
  'MENUNGGU_LOGIN_WARGA',
  'MENUNGGU_PROFIL_WARGA',
  'MENUNGGU_KONFIRMASI',
  'MENUNGGU_SUBMIT_WARGA',
  'DIPANDU',
]);

/** Menunggu siapa, untuk layar /lacak. Terminal = tidak menunggu siapa pun. */
export function menungguSiapa(state: UrusanState): RingkasanUrusan['menunggu'] {
  if (isTerminal(state)) return null;
  if (MENUNGGU_WARGA.has(state)) return 'warga';
  if (state === 'TERKIRIM' || state === 'DIPANTAU') return 'instansi';
  return 'sistem';
}
