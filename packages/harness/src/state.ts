import { URUSAN_STATES, type UrusanState } from '@urusin/contracts';

export { URUSAN_STATES, type UrusanState };

export const TERMINAL_STATES: ReadonlySet<UrusanState> = new Set(['SELESAI', 'DITOLAK', 'DIBATALKAN']);

/**
 * Tabel transisi (rencana §3.2). Diagram di-generate dari tabel ini (`stateDiagram()`).
 * Transisi samping `* → DIPANDU`, `* → GAGAL_AMAN`, `* → DIBATALKAN` berlaku dari semua state non-terminal.
 */
const FORWARD: Record<UrusanState, readonly UrusanState[]> = {
  BARU: ['MEMAHAMI'],
  MEMAHAMI: ['RENCANA_DIUSULKAN'],
  RENCANA_DIUSULKAN: ['MEMAHAMI', 'RENCANA_DISETUJUI'],
  RENCANA_DISETUJUI: ['MENYIAPKAN_BERKAS'],
  MENYIAPKAN_BERKAS: ['BERKAS_SIAP'],
  BERKAS_SIAP: ['MENUNGGU_LOGIN_WARGA', 'MENUNGGU_PROFIL_WARGA', 'MENGISI'],
  MENUNGGU_LOGIN_WARGA: ['MENUNGGU_PROFIL_WARGA', 'MENGISI'],
  MENUNGGU_PROFIL_WARGA: ['MENGISI'],
  MENGISI: ['MENUNGGU_KONFIRMASI'],
  MENUNGGU_KONFIRMASI: ['MENGISI', 'MENGUNGGAH'],
  MENGUNGGAH: ['MENUNGGU_SUBMIT_WARGA'],
  MENUNGGU_SUBMIT_WARGA: ['TERKIRIM'],
  TERKIRIM: ['DIPANTAU', 'SELESAI', 'DITOLAK'],
  DIPANTAU: ['SELESAI', 'DITOLAK'],
  SELESAI: [],
  DITOLAK: [],
  DIBATALKAN: [],
  // DIPANDU: warga menyelesaikan sendiri; boleh kembali ke alur otomatis bila adapter pulih.
  DIPANDU: ['MENGISI', 'SELESAI'],
  GAGAL_AMAN: ['MEMAHAMI'],
};

const SIDE: readonly UrusanState[] = ['DIPANDU', 'GAGAL_AMAN', 'DIBATALKAN'];

export function allowedTransitions(from: UrusanState): UrusanState[] {
  if (TERMINAL_STATES.has(from)) return [];
  return [...new Set([...FORWARD[from], ...SIDE.filter((s) => s !== from)])];
}

export function canTransition(from: UrusanState, to: UrusanState): boolean {
  return allowedTransitions(from).includes(to);
}

export function isTerminal(state: UrusanState): boolean {
  return TERMINAL_STATES.has(state);
}

export function isUrusanState(value: string): value is UrusanState {
  return (URUSAN_STATES as readonly string[]).includes(value);
}

/** Diagram Mermaid dari tabel transisi (transisi samping digabung jadi satu baris `[*]`). */
export function stateDiagram(): string {
  const lines = ['stateDiagram-v2', '  [*] --> BARU'];
  for (const from of URUSAN_STATES) {
    for (const to of FORWARD[from]) lines.push(`  ${from} --> ${to}`);
  }
  for (const s of SIDE) lines.push(`  note right of ${s}: dari semua state non-terminal`);
  for (const t of TERMINAL_STATES) lines.push(`  ${t} --> [*]`);
  return lines.join('\n');
}
