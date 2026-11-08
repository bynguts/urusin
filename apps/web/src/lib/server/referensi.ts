import type { Kota, PeristiwaResponse } from '@urusin/contracts';
import { SEED_ENTRIES, findBundel, routeByKode, type CityEntry } from '@urusin/registry';

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

/**
 * Langkah sebuah Peristiwa Hidup beserta sumber resmi; `kodeKabKota` (sudah divalidasi) memilih tier kota.
 * Dipakai GET /api/peristiwa/[slug] dan halaman /peristiwa/[slug]. null bila slug tidak dikenal.
 */
export function peristiwaView(slug: string, kodeKabKota: string | null): PeristiwaResponse | null {
  const bundel = findBundel(slug);
  if (!bundel) return null;
  const kota = kodeKabKota !== null ? kotaView(routeByKode(kodeKabKota).entry) : null;
  return {
    slug: bundel.slug,
    judul: bundel.judul,
    tier: kota?.tier ?? bundel.tier,
    kodeKabKota: kota?.kodeKabKota ?? null,
    kota,
    keluaran: bundel.keluaran,
    ...(bundel.peringatan ? { peringatan: bundel.peringatan } : {}),
    catatan: bundel.catatan,
    langkah: bundel.langkah.map((l) => ({
      id: l.id,
      judul: l.judul,
      jenis: l.jenis,
      ...(l.lokasi ? { lokasi: l.lokasi } : {}),
      dependsOn: l.dependsOn,
      dokumen: l.dokumen,
      bawa: l.bawa,
      keterangan: l.keterangan,
      sumber: l.sourceRef,
      verifiedAt: l.verifiedAt,
    })),
  };
}

export type KotaPilihan = { kodeKabKota: string; nama: string; situs: { url: string; nama: string } | null };

/** Daftar kab/kota untuk pemilih wilayah (urut nama) + situs resmi Disdukcapil bila tercatat. */
export function daftarKota(): KotaPilihan[] {
  return SEED_ENTRIES.map((e) => ({
    kodeKabKota: e.kodeKabKota,
    nama: e.nama,
    situs: e.portal
      ? { url: e.portal.origin, nama: e.portal.nama }
      : e.sourceRef[0]
        ? { url: e.sourceRef[0].url, nama: e.sourceRef[0].instansi }
        : null,
  })).sort((a, b) => a.nama.localeCompare(b.nama));
}
