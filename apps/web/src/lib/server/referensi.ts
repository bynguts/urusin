import type { Kota } from '@urusin/contracts';
import type { CityEntry } from '@urusin/registry';

export const STALE_HARI = 30;

export function kotaView(e: CityEntry): Kota {
  return {
    kodeKabKota: e.kodeKabKota,
    nama: e.nama,
    tier: e.tier,
    validasi: e.validasi,
    verifiedAt: e.verifiedAt,
  };
}

/** true bila belum pernah diverifikasi atau lebih dari 30 hari: UI menampilkan lencana "perlu dicek ulang". */
export function perluDicekUlang(verifiedAt: string | null, now: Date = new Date()): boolean {
  if (!verifiedAt) return true;
  const t = Date.parse(verifiedAt);
  return Number.isNaN(t) || now.getTime() - t > STALE_HARI * 86_400_000;
}
