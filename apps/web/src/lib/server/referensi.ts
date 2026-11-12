import type { Kota, PeristiwaResponse } from '@urusin/contracts';
import { rencanaPeristiwa } from '@urusin/harness';
import { BROWSER_PENDAMPING_TERSEDIA } from '#lib/fitur.js';
import { SEMUA_WILAYAH, kanalWilayah, routeByKode, type CityEntry } from '@urusin/registry';

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
 * Langkah sebuah Peristiwa Hidup untuk wilayah KTP `kodeKabKota` (sudah divalidasi formatnya). Bundel khusus
 * kab/kota hanya dipakai untuk kab/kota itu sendiri; wilayah lain mendapat persyaratan nasional dengan kanal
 * resminya sendiri, dan tier `semi` hanya bila Browser Pendamping benar-benar tersedia. Tanpa kode: persyaratan
 * nasional tanpa kanal kab/kota. Dipakai GET /api/peristiwa/[slug] dan halaman /peristiwa/[slug]. null bila slug
 * tidak dikenal.
 */
export function peristiwaView(slug: string, kodeKabKota: string | null): PeristiwaResponse | null {
  const r = rencanaPeristiwa(slug, { ktp: kodeKabKota }, BROWSER_PENDAMPING_TERSEDIA);
  if (!r) return null;
  const kota = r.ktp ? kotaView(routeByKode(r.ktp.kodeKabKota).entry) : null;
  return {
    slug: r.slug,
    judul: r.judul,
    tier: r.tier,
    kodeKabKota: kota?.kodeKabKota ?? null,
    kota,
    keluaran: r.keluaran,
    ...(r.peringatan ? { peringatan: r.peringatan } : {}),
    catatan: r.catatan,
    langkah: r.langkah.map((l) => ({
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

/**
 * Semua 514 kab/kota untuk pemilih wilayah (urut nama) + kanal resmi kab/kota itu sendiri bila tercatat
 * (portal layanan di registry, situs Disdukcapil, atau situs resmi pemda kab/kota terverifikasi); null bila hanya ada
 * situs provinsi atau nasional.
 */
export function daftarKota(): KotaPilihan[] {
  return SEMUA_WILAYAH.map((w) => {
    const k = kanalWilayah(w.kodeKabKota);
    return {
      kodeKabKota: w.kodeKabKota,
      nama: w.nama,
      situs: k.jenis === 'nasional' || k.jenis === 'provinsi' ? null : { url: k.url, nama: k.judul },
    };
  }).sort((a, b) => a.nama.localeCompare(b.nama));
}
