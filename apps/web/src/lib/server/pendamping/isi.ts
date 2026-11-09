import { AkunError, hashDaftarWrite, type Akun } from '@urusin/akun';
import type { Runtime } from '#lib/server/runtime.js';
import { izinkanIsi, resolusiNilai } from '#lib/server/vault/resolver.js';

/**
 * Jalur isi Pendamping (A-M1): SATU-SATUNYA pemanggil penyelesai nilai PII. Peramban tidak pernah mengirim
 * nilai vault; controller Pendamping memanggil dua fungsi ini di server dan mengetik nilainya ke Chromium lewat
 * kanal internal. Nilai tidak dicatat, tidak dikirim ke model, dan tidak dikembalikan ke peramban.
 *
 * 1. Pesan WS `pendamping.izinkan { urusanId, writeListHash }` dari pemilik → `izinkanIsiUrusan`: peminta
 *    harus pemilik urusan, dan hash yang disetujui warga harus sama dengan daftar write rencana controller.
 *    Token persetujuan (sekali pakai, 5 menit) disimpan controller di sisi server, tidak dikirim ke peramban.
 * 2. Saat mengisi → `nilaiIsiUrusan` dengan token itu: hanya field di daftar write, menuju origin yang sama.
 */

export type Peminta = { akun?: Akun | undefined; sid?: string | undefined };

function pemilik(rt: Runtime, urusanId: string, peminta: Peminta): string {
  const ownerId = rt.akun.pemilikVaultUrusan(urusanId, peminta);
  if (!ownerId) throw new AkunError('IZIN_TIDAK_VALID');
  return ownerId;
}

/** Persetujuan "Izinkan isi" untuk urusan `urusanId` → token persetujuan (tetap di server). */
export function izinkanIsiUrusan(
  rt: Runtime,
  p: {
    urusanId: string;
    peminta: Peminta;
    /** Hash daftar write yang ditampilkan ke warga dan disetujuinya (pesan `pendamping.izinkan`). */
    writeListHash: string;
    /** Daftar write rencana isi controller; hash-nya harus sama persis dengan `writeListHash`. */
    writeList: readonly string[];
    targetOrigin: string;
  },
): string {
  const ownerId = pemilik(rt, p.urusanId, p.peminta);
  if (hashDaftarWrite(p.writeList) !== p.writeListHash) throw new AkunError('IZIN_TIDAK_VALID');
  return izinkanIsi(rt, ownerId, p.writeList, p.targetOrigin);
}

/** Nilai Data Diri untuk diketik Pendamping (kanal internal saja). Token dipakai sekali. */
export function nilaiIsiUrusan(
  rt: Runtime,
  p: {
    urusanId: string;
    peminta: Peminta;
    token: string;
    writeList: readonly string[];
    targetOrigin: string;
  },
): Record<string, string> {
  const ownerId = pemilik(rt, p.urusanId, p.peminta);
  return resolusiNilai(rt, {
    ownerId,
    token: p.token,
    writeList: p.writeList,
    targetOrigin: p.targetOrigin,
  });
}
