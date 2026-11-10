import {
  EGRESS_PIHAK_KETIGA_WILAYAH,
  PLATFORM_WILAYAH,
  PORTAL_WILAYAH,
  hostsWilayah,
  type PortalWilayah,
} from '@urusin/core';

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
 * Host sesi peramban generik wilayah ini (`params.hosts` ke worker): host portal + platform, ditambah host
 * tantangan pihak ketiga (Cloudflare) HANYA bila portal tercatat memakai proteksi itu. Tanpa host info
 * Disdukcapil: sesi Navigator hanya untuk portal.
 */
export function hostsSesiWilayah(kode: string | null | undefined): string[] {
  const p = portalWilayah(kode);
  const portal = hostsPortalWilayah(kode);
  if (!p || portal.length === 0) return [];
  const tantangan = p.proteksi.some((x) => x === 'cloudflare' || x === 'turnstile');
  return [...new Set([...portal, ...(tantangan ? EGRESS_PIHAK_KETIGA_WILAYAH : [])])];
}

/** Login hanya lewat akun pihak ketiga (OAuth Google): egress sesi tidak bisa menjangkaunya. */
const LOGIN_PIHAK_KETIGA = new Set(['google']);

/** Host yang boleh dikerjakan AI di sesi wilayah ini: host wilayah tanpa host pihak ketiga. */
export function hostsAiWilayah(kode: string | null | undefined): string[] {
  if (!portalWilayah(kode)) return [];
  return hostsWilayah(kode!).filter((h) => !EGRESS_PIHAK_KETIGA_WILAYAH.includes(h));
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
 * ini. `wilayah` = nama pendek kab/kota bila diketahui.
 */
export function alasanDipandu(kode: string | null | undefined, wilayah?: string): string {
  const p = portalWilayah(kode);
  const di = wilayah ? ` ${wilayah}` : '';
  const kanal = p ? KANAL_DIPANDU[p.jenis] : undefined;
  if (kanal)
    return `Rencana disetujui. Disdukcapil${di} melayani pengajuan lewat ${kanal}, bukan formulir web, jadi Browser Pendamping tidak bisa mengisinya. Ikuti langkahnya bersama saya.`;
  return 'Rencana disetujui. Situs ini belum bisa dibantu Browser Pendamping; ikuti langkahnya bersama saya.';
}
