import type { AkunService } from '@urusin/akun';
import type { ButirIngatanTampil, EventPayload } from '@urusin/contracts';
import {
  bacaIngatan,
  bawaDariTamu,
  buangButir,
  buangDariTamu,
  buangTitipanKedaluwarsa,
  daftarTampil,
  IngatanError,
  ingatWilayah,
  jumlahDariTamu,
  ktpDariIngatan,
  titipanAktif,
  setujuiUsulan,
  tampilButir,
  type Ingatan,
  type PenyimpanIngatan,
} from '@urusin/harness';

/**
 * Ingatan warga (ADR 0031) di atas vault akun: pemilik = pemilik vault urusan (akun/demo, atau tamu
 * lewat hash sid; lihat `pemilikIngatanUrusan`). Isi yang tidak bisa dibuka/diurai MELEMPAR (alert operator), tidak
 * dibaca kosong: penulisan berikutnya tidak boleh menimpa ingatan warga. Agen menangkap galat ini dan berjalan
 * tanpa ingatan di turn itu (`muatKonteks`).
 */
export function muatIngatan(akun: AkunService, pemilik: string): Ingatan {
  const raw = akun.vault.getIngatan(pemilik)?.data; // VaultError: alert sudah dikirim vault
  let i: Ingatan;
  try {
    i = bacaIngatan(raw);
  } catch (e) {
    if (e instanceof IngatanError) console.error(`[ALERT] ingatan pemilik ${pemilik} rusak: ${e.message}`);
    throw e;
  }
  // Titipan tamu yang kedaluwarsa dibuang saat dibaca (penyapu `bersihkan()` juga membuangnya).
  const bersih = buangTitipanKedaluwarsa(i);
  if (!bersih) return i;
  simpanAtauHapus(akun, pemilik, bersih);
  return bersih;
}

/** Simpan; ingatan yang kosong seluruhnya dihapus barisnya (bukan disimpan kosong). */
function simpanAtauHapus(akun: AkunService, pemilik: string, i: Ingatan): void {
  if (i.butir.length === 0 && !i.usulan?.length && !i.dariTamu?.length) akun.vault.hapusIngatan(pemilik);
  else akun.vault.setIngatan(pemilik, i);
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

/**
 * Usulan yang menunggu persetujuan, dengan label berupa pertanyaan: "Ingat bahwa Anda tuli?" (aksesibilitas) atau
 * `Ingat ini? "…"` (catatan).
 */
export function daftarUsulan(akun: AkunService, pemilik: string): ButirIngatanTampil[] {
  return (muatIngatan(akun, pemilik).usulan ?? []).map((b) => ({
    ...tampilButir(b),
    label: (b.jenis === 'catatan' ? `Ingat ini? "${b.nilai}"` : `Ingat bahwa Anda ${b.nilai}?`).slice(0, 260),
  }));
}

/** Hapus satu butir ATAU usulan milik pemilik ("Hapus" di Pengaturan, "Batalkan"/"Tidak" di kartu chat). */
export function hapusButirIngatan(akun: AkunService, pemilik: string, id: string): number {
  const sisa = buangButir(muatIngatan(akun, pemilik), id);
  if (!sisa) return 0;
  simpanAtauHapus(akun, pemilik, sisa);
  return 1;
}

/** "Ya, ingat" di kartu persetujuan: usulan menjadi butir. null = usulan tidak ada (sudah dijawab/dihapus). */
export function setujuiIngatan(
  akun: AkunService,
  pemilik: string,
  id: string,
  at: string = new Date().toISOString(),
): ButirIngatanTampil | null {
  const h = setujuiUsulan(muatIngatan(akun, pemilik), id, at);
  if (!h) return null;
  akun.vault.setIngatan(pemilik, h.ingatan);
  return tampilButir(h.butir);
}

/**
 * "Hapus semua ingatan" (hak hapus UU PDP 27/2022): baris vault dihapus, bukan dikosongkan, termasuk usulan dan
 * titipan tamu. Tetap jalan bila isinya rusak (hitungan 0).
 */
export function hapusSemuaIngatan(akun: AkunService, pemilik: string): number {
  let n = 0;
  try {
    const i = muatIngatan(akun, pemilik);
    n = i.butir.length + (i.usulan?.length ?? 0) + jumlahDariTamu(i);
  } catch {
    // isi rusak: tetap dihapus
  }
  akun.vault.hapusIngatan(pemilik);
  return n;
}

/**
 * Hal yang diingat di perangkat ini sebagai tamu sebelum warga masuk (menunggu pilihan), ditampilkan isinya agar
 * warga tahu apa yang akan dibawa. Hanya butir non-sensitif yang belum kedaluwarsa; titipan kedaluwarsa dibuang.
 */
export function titipanIngatanTamu(akun: AkunService, pemilik: string): ButirIngatanTampil[] {
  return daftarTampil({ versi: 1, butir: titipanAktif(muatIngatan(akun, pemilik)) });
}

/** "Bawa ke akun": titipan tamu digabung tanpa menggusur butir akun. */
export function bawaIngatanTamu(akun: AkunService, pemilik: string): void {
  const i = muatIngatan(akun, pemilik);
  if (jumlahDariTamu(i) > 0) simpanAtauHapus(akun, pemilik, bawaDariTamu(i));
}

/** "Buang": titipan tamu dihapus tanpa dipakai. */
export function buangIngatanTamu(akun: AkunService, pemilik: string): void {
  const i = muatIngatan(akun, pemilik);
  if (jumlahDariTamu(i) > 0) simpanAtauHapus(akun, pemilik, buangDariTamu(i));
}

/** Kode kab/kota KTP dari ingatan pemilik urusan (usulan wilayah urusan baru), atau undefined. */
export function ktpIngatanUrusan(akun: AkunService, urusanId: string): string | undefined {
  const pemilik = akun.pemilikIngatanUrusan(urusanId);
  if (!pemilik) return undefined;
  try {
    return ktpDariIngatan(muatIngatan(akun, pemilik))?.kodeKabKota;
  } catch {
    return undefined; // isi rusak (sudah di-alert): urusan baru tanpa usulan dari ingatan
  }
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
