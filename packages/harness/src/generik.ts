/**
 * Antarmuka kecil ke registry wilayah (ADR 0030) untuk routing Navigator generik dan allowlist isi vault.
 * Sumber datanya adalah `PORTAL_WILAYAH`/`hostsWilayah` di @urusin/core (dibangkitkan dari data survei wilayah);
 * modul ini TIDAK menyimpan daftar host sendiri. Sampai sumber dipasang, tidak ada wilayah yang punya portal web,
 * sehingga semua urusan tanpa adapter tetap dipandu (gagal tertutup).
 */

/** Adapter yang dikerjakan Navigator generik (bukan adapter tulisan tangan). */
export const ADAPTER_GENERIK = 'generik';

/**
 * Kanal layanan satu kab/kota. Hanya `web` yang dikerjakan Browser Pendamping generik; kanal lain (aplikasi
 * IKD, WhatsApp, kantor) jatuh ke mode dipandu dengan alasan jujur.
 */
export type PortalWilayahRingkas = {
  jenis: string;
  /** Origin https portal (wajib untuk `web`). */
  origin?: string | undefined;
  nama?: string | undefined;
  /** Host persis milik wilayah ini (tanpa wildcard). */
  hosts: readonly string[];
};

export type SumberPortalWilayah = (kode: string) => PortalWilayahRingkas | undefined;

const tanpaSumber: SumberPortalWilayah = () => undefined;
let sumber: SumberPortalWilayah = tanpaSumber;

/** Pasang sumber registry wilayah (tanpa argumen = lepas; dipakai tes). */
export function pasangSumberPortalWilayah(f?: SumberPortalWilayah): void {
  sumber = f ?? tanpaSumber;
}

export function portalWilayah(kode: string | null | undefined): PortalWilayahRingkas | undefined {
  if (!kode || !/^\d{4}$/.test(kode)) return undefined;
  return sumber(kode);
}

/** Host persis milik wilayah `kode` (kosong bila wilayah tidak dikenal). */
export function hostsWilayah(kode: string | null | undefined): readonly string[] {
  return portalWilayah(kode)?.hosts ?? [];
}

/** Portal web yang bisa dikerjakan Navigator generik: jenis `web`, origin https, host origin ada di daftar host. */
export function portalWebWilayah(
  kode: string | null | undefined,
): (PortalWilayahRingkas & { origin: string }) | undefined {
  const p = portalWilayah(kode);
  if (!p || p.jenis !== 'web' || !p.origin) return undefined;
  let url: URL;
  try {
    url = new URL(p.origin);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' || !p.hosts.includes(url.host)) return undefined;
  return { ...p, origin: url.origin };
}

const KANAL_DIPANDU: Readonly<Record<string, string>> = {
  ikd: 'aplikasi Identitas Kependudukan Digital (IKD)',
  aplikasi: 'aplikasi ponsel resmi',
  whatsapp: 'WhatsApp',
  kantor: 'loket di kantor',
};

/**
 * Alasan jujur (templat, bukan keluaran model) saat urusan tidak bisa dikerjakan Browser Pendamping di wilayah
 * ini. `wilayah` = nama pendek kab/kota bila diketahui.
 */
export function alasanDipandu(kode: string | null | undefined, wilayah?: string): string {
  const p = portalWilayah(kode);
  const di = wilayah ? ` ${wilayah}` : '';
  const kanal = p && Object.hasOwn(KANAL_DIPANDU, p.jenis) ? KANAL_DIPANDU[p.jenis] : undefined;
  if (kanal)
    return `Rencana disetujui. Disdukcapil${di} melayani pengajuan lewat ${kanal}, bukan formulir web, jadi Browser Pendamping tidak bisa mengisinya. Ikuti langkahnya bersama saya.`;
  return 'Rencana disetujui. Situs ini belum bisa dibantu Browser Pendamping; ikuti langkahnya bersama saya.';
}
