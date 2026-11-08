import { AkunError, hashDaftarWrite } from '@urusin/akun';
import { originFixtures } from '#lib/server/hosts.js';
import type { Runtime } from '#lib/server/runtime.js';

/**
 * PENYELESAI NILAI PII SATU-SATUNYA di server (ADR 0028, arsitek v13 #1). Satu-satunya pemanggil yang sah
 * adalah jalur isi Pendamping (`src/lib/server/pendamping/**`); tes impor (`resolver.test.ts`) menolak impor
 * dari tempat lain. Alurnya:
 * 1. Warga menekan "Izinkan isi" (pesan `pendamping.izinkan`) → `izinkanIsi` menerbitkan token sekali pakai
 *    (5 menit) yang terikat ke pemilik, hash daftar field yang akan ditulis, dan origin tujuan.
 * 2. Jalur isi memanggil `resolusiNilai` dengan token itu; daftar field + origin harus PERSIS sama.
 * Nilai tidak pernah dicatat, tidak pernah dikembalikan ke model, dan hanya field di daftar write yang keluar.
 * Salinan demo (data sintetis) hanya boleh menuju situs latihan, tidak pernah ke situs pemerintah sungguhan.
 */

const asalTujuan = (targetOrigin: string): string => {
  try {
    return new URL(targetOrigin).origin;
  } catch {
    throw new AkunError('IZIN_TIDAK_VALID');
  }
};

function pastikanTujuanBoleh(rt: Runtime, ownerId: string, origin: string): void {
  if (rt.akun.akun(ownerId)?.jenis === 'demo' && !originFixtures().has(origin))
    throw new AkunError('NILAI_SINTETIS_DITOLAK');
}

/** Terbitkan token persetujuan "Izinkan isi" untuk daftar field `writeList` menuju `targetOrigin`. */
export function izinkanIsi(
  rt: Runtime,
  ownerId: string,
  writeList: readonly string[],
  targetOrigin: string,
): string {
  const origin = asalTujuan(targetOrigin);
  pastikanTujuanBoleh(rt, ownerId, origin);
  return rt.akun.terbitkanIzin(ownerId, hashDaftarWrite(writeList), origin);
}

/**
 * Pakai token persetujuan (sekali) lalu kembalikan nilai Data Diri HANYA untuk field di `writeList`. Field yang
 * tidak ada di Data Diri tidak ikut. Token salah/kedaluwarsa/terpakai, daftar berbeda, atau origin berbeda →
 * AkunError IZIN_TIDAK_VALID.
 */
export function resolusiNilai(
  rt: Runtime,
  p: { ownerId: string; token: string; writeList: readonly string[]; targetOrigin: string },
): Record<string, string> {
  const origin = asalTujuan(p.targetOrigin);
  pastikanTujuanBoleh(rt, p.ownerId, origin);
  rt.akun.pakaiIzin(p.token, {
    userId: p.ownerId,
    writeListHash: hashDaftarWrite(p.writeList),
    targetOrigin: origin,
  });
  const data = rt.akun.vault.getDataDiri(p.ownerId)?.data ?? {};
  const nilai: Record<string, string> = {};
  for (const field of new Set(p.writeList)) {
    const v = data[field];
    if (typeof v === 'string' && v !== '') nilai[field] = v;
  }
  return nilai;
}
