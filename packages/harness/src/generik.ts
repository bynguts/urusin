import {
  EGRESS_PIHAK_KETIGA_WILAYAH,
  PLATFORM_WILAYAH,
  PORTAL_WILAYAH,
  hostsWilayah,
  petunjukPortal,
  type PortalWilayah,
} from '@urusin/core';
import { kalimatPendampingBerkembang, pendampingAktif, varianDisebut } from '@urusin/registry';

/**
 * Petunjuk peta portal (TEPERCAYA, registry Urusin; ADR 0034) untuk Navigator sesi urusan ini: portal wilayah KTP ×
 * layanan tujuan × varian yang disebut warga. Teks warga tidak ikut; hanya id varian hasil pencocokan kata kunci.
 * undefined bila wilayah/layanan belum dipetakan atau layanannya offline di portal itu.
 */
export function petunjukPortalUrusan(
  jenis: string | null | undefined,
  kodeKabKota: string | null | undefined,
  pesanWarga: readonly string[] = [],
): string | undefined {
  return petunjukPortal(kodeKabKota, jenis, varianDisebut(jenis, pesanWarga));
}

/**
 * Routing Navigator generik dan allowlist isi vault di atas registry wilayah (`PORTAL_WILAYAH`, hasil
 * generator di @urusin/core; ADR 0030). Modul ini tidak menyimpan daftar host sendiri.
 */

/** Adapter yang dikerjakan Navigator generik (bukan adapter tulisan tangan). */
export const ADAPTER_GENERIK = 'generik';

export function portalWilayah(kode: string | null | undefined): PortalWilayah | undefined {
  if (!kode || !/^\d{4}$/.test(kode) || !Object.hasOwn(PORTAL_WILAYAH, kode)) return undefined;
  return PORTAL_WILAYAH[kode];
}

/**
 * Host PORTAL persis milik wilayah (host portal + host platform bersamanya). Tidak termasuk host info
 * Disdukcapil dan host pihak ketiga (tantangan Cloudflare): nilai vault dan aksi AI hanya ke portal.
 */
export function hostsPortalWilayah(kode: string | null | undefined): string[] {
  const p = portalWilayah(kode);
  if (!p || p.jenis !== 'web') return [];
  const platform =
    p.platform && Object.hasOwn(PLATFORM_WILAYAH, p.platform) ? PLATFORM_WILAYAH[p.platform]!.hosts : [];
  return [...new Set([...p.hosts, ...platform])];
}

/**
 * Jalur portal yang benar-benar ada di replika Mode Uji, per host resmi. Replika dipasang di awalan override
 * worker (`resmi=fixture/awalan`); jalur portal asli yang tidak dideklarasikan di sini akan 404 di replika,
 * jadi Mode Uji membuka akar replika (`/`). Tambah baris hanya bila replikanya memang melayani jalur itu.
 */
export const JALUR_REPLIKA: Readonly<Record<string, readonly string[]>> = Object.freeze({});

/**
 * Origin resmi yang punya situs latihan (replika di apps/fixtures) untuk Mode Uji. Harus sama dengan sisi kiri
 * `PENDAMPING_ORIGIN_OVERRIDES` di deploy/compose.prod.yml (dijaga tes). Tamu hanya ditawari Browser Pendamping
 * Mode Uji untuk origin ini; portal lain butuh akun (portal asli) supaya tawarannya tidak palsu.
 */
export const ORIGIN_REPLIKA_UJI: ReadonlySet<string> = new Set([
  'https://telunjuksakti.wonogirikab.go.id',
  'https://wargaklampid-dispendukcapil.surabaya.go.id',
  'https://sidnok.semarangkota.go.id',
  'https://samsat-pkb2.jakarta.go.id',
  'https://oss.go.id',
]);

/** Apakah situs resmi ini punya replika Mode Uji? URL kosong atau tidak sah → false (gagal tertutup). */
export function punyaReplikaUji(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return ORIGIN_REPLIKA_UJI.has(new URL(url).origin);
  } catch {
    return false;
  }
}

/** Jalur awal sesi Mode Uji: jalur portal bila replika host itu mendeklarasikannya, selain itu `/`. */
export function jalurModeUji(
  origin: string,
  jalur: unknown,
  deklarasi: Readonly<Record<string, readonly string[]>> = JALUR_REPLIKA,
): string {
  if (typeof jalur !== 'string') return '/';
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return '/';
  }
  return Object.hasOwn(deklarasi, host) && deklarasi[host]!.includes(jalur) ? jalur : '/';
}

/** Login hanya lewat akun pihak ketiga (OAuth Google): egress sesi tidak bisa menjangkaunya. */
const LOGIN_PIHAK_KETIGA = new Set(['google']);

/** Host yang boleh dikerjakan AI di sesi wilayah ini: host wilayah tanpa host pihak ketiga dan host aset. */
export function hostsAiWilayah(kode: string | null | undefined): string[] {
  const p = portalWilayah(kode);
  if (!p) return [];
  const aset = p.hostAset ?? [];
  return hostsWilayah(kode!).filter((h) => !EGRESS_PIHAK_KETIGA_WILAYAH.includes(h) && !aset.includes(h));
}

/** Portal web yang bisa dikerjakan Navigator generik: jenis `web`, URL https, host URL ada di host portal. */
export function portalWebWilayah(
  kode: string | null | undefined,
): { origin: string; url: string; nama: string } | undefined {
  const p = portalWilayah(kode);
  if (!p || p.jenis !== 'web' || !p.url) return undefined;
  // Portal yang HANYA bisa dimasuki lewat akun pihak ketiga tidak bisa dikerjakan di sesi (OAuth diblokir).
  if (p.login.length > 0 && p.login.every((l) => LOGIN_PIHAK_KETIGA.has(l))) return undefined;
  let url: URL;
  try {
    url = new URL(p.url);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' || !hostsPortalWilayah(kode).includes(url.host)) return undefined;
  return { origin: url.origin, url: url.href, nama: p.nama };
}

const KANAL_DIPANDU: Readonly<Partial<Record<PortalWilayah['jenis'], string>>> = {
  aplikasi: 'aplikasi ponsel resmi',
  whatsapp: 'WhatsApp',
  nasional: 'kanal nasional (aplikasi IKD) atau loket kantor',
};

/**
 * Alasan jujur (templat, bukan keluaran model) saat urusan tidak bisa dikerjakan Browser Pendamping di wilayah
 * ini. `wilayah` = nama pendek kab/kota bila diketahui. Daerah di luar `DAERAH_PENDAMPING_AKTIF` (ADR 0033): kalimat
 * positif "Urusin memandu, Pendamping sedang dikembangkan", bukan jalan buntu.
 */
export function alasanDipandu(kode: string | null | undefined, wilayah?: string): string {
  const p = portalWilayah(kode);
  const di = wilayah ? ` ${wilayah}` : '';
  const kanal = p ? KANAL_DIPANDU[p.jenis] : undefined;
  if (kode && /^\d{4}$/.test(kode) && !pendampingAktif(kode))
    return `Rencana disetujui. ${kalimatPendampingBerkembang(
      wilayah ?? 'wilayah Anda',
      kanal ? `Disdukcapil${di} melayani pengajuan lewat ${kanal}.` : undefined,
    )}`;
  if (kanal)
    return `Rencana disetujui. Disdukcapil${di} melayani pengajuan lewat ${kanal}, bukan formulir web, jadi Browser Pendamping tidak bisa mengisinya. Ikuti langkahnya bersama saya.`;
  if (p?.jenis === 'web' && p.login.length > 0 && p.login.every((l) => LOGIN_PIHAK_KETIGA.has(l)))
    return `Rencana disetujui. Portal Disdukcapil${di} hanya bisa dimasuki dengan akun Google, dan login Google tidak dibuka di Browser Pendamping, jadi AI tidak bisa mengisinya. Ikuti langkahnya bersama saya: Anda membuka portalnya sendiri.`;
  return 'Rencana disetujui. Untuk urusan ini, Urusin memandu Anda langkah demi langkah lewat kanal resmi; ikuti langkahnya bersama saya.';
}
