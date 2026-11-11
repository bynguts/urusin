import type { AkunService } from '@urusin/akun';
import type { ButirIngatanTampil } from '@urusin/contracts';
import {
  bacaIngatan,
  daftarTampil,
  ingatanKosong,
  ingatWilayah,
  ktpDariIngatan,
  type Ingatan,
  type PenyimpanIngatan,
} from '@urusin/harness';
import type { EventPayload } from '@urusin/contracts';

/**
 * Ingatan warga (ADR 0031) di atas vault akun: pemilik = pemilik vault urusan (akun terverifikasi/demo, atau tamu
 * lewat hash sid; lihat `pemilikIngatanUrusan`). Isi vault yang rusak/tidak bisa dibuka dibaca sebagai kosong:
 * agen tetap jalan tanpa ingatan, tidak pernah menebak.
 */
export function muatIngatan(akun: AkunService, pemilik: string): Ingatan {
  try {
    return bacaIngatan(akun.vault.getIngatan(pemilik)?.data);
  } catch {
    return ingatanKosong();
  }
}

/** Penyimpan untuk harness; `akun` dibaca malas karena AkunService dirakit setelah harness. */
export function penyimpanIngatan(akun: () => AkunService): PenyimpanIngatan {
  return {
    pemilik: (urusanId) => akun().pemilikIngatanUrusan(urusanId),
    muat: (pemilik) => muatIngatan(akun(), pemilik),
    simpan: (pemilik, ingatan) => void akun().vault.setIngatan(pemilik, ingatan),
    jenisDokumen: (pemilik) =>
      akun()
        .vault.listDocuments(pemilik)
        .map((d) => d.jenis),
    urusanMilik: (pemilik) => akun().urusanPemilikVault(pemilik),
  };
}

/** Daftar butir untuk Pengaturan / GET /api/ingatan. */
export function daftarIngatan(akun: AkunService, pemilik: string): ButirIngatanTampil[] {
  return daftarTampil(muatIngatan(akun, pemilik));
}

/** Hapus satu butir milik pemilik (tombol "Hapus" di Pengaturan, "Batalkan" di kartu chat). */
export function hapusButirIngatan(akun: AkunService, pemilik: string, id: string): number {
  const i = muatIngatan(akun, pemilik);
  const sisa = i.butir.filter((b) => b.id !== id);
  if (sisa.length === i.butir.length) return 0;
  if (sisa.length === 0) akun.vault.hapusIngatan(pemilik);
  else akun.vault.setIngatan(pemilik, { ...i, butir: sisa });
  return 1;
}

/** "Hapus semua ingatan" (hak hapus UU PDP 27/2022): baris vault dihapus, bukan dikosongkan. */
export function hapusSemuaIngatan(akun: AkunService, pemilik: string): number {
  const n = muatIngatan(akun, pemilik).butir.length;
  akun.vault.hapusIngatan(pemilik);
  return n;
}

/** Kode kab/kota KTP dari ingatan pemilik urusan (usulan wilayah urusan baru), atau undefined. */
export function ktpIngatanUrusan(akun: AkunService, urusanId: string): string | undefined {
  const pemilik = akun.pemilikIngatanUrusan(urusanId);
  return pemilik ? ktpDariIngatan(muatIngatan(akun, pemilik))?.kodeKabKota : undefined;
}

/**
 * Wilayah yang dibenarkan lewat kartu "Ya, betul" (di luar turn agen) juga dicatat ke ingatan, sama dengan
 * wilayah__tetapkan di dalam turn. Gagal simpan tidak menggagalkan penetapan wilayah.
 */
export function ingatWilayahUrusan(
  akun: AkunService,
  urusan: { id: string; jenis: string | null },
  w: { ktp: string; domisili?: string | null; tujuan?: string | null },
  publish: (e: EventPayload) => void,
  at: string = new Date().toISOString(),
): void {
  const pemilik = akun.pemilikIngatanUrusan(urusan.id);
  if (!pemilik) return;
  try {
    for (const e of ingatWilayah({ pemilik, penyimpan: penyimpanIngatan(() => akun) }, urusan.jenis, w, at))
      publish(e);
  } catch {
    // vault tidak tersedia: wilayah urusan tetap tercatat
  }
}
