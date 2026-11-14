import { ErrorCode } from './errors.js';
import { DOMAIN_WILAYAH } from './registry-wilayah.js';

/**
 * Registry domain resmi (rencana §3.8). Pencocokan EXACT origin `https://<host>`:
 * tanpa http, tanpa userinfo, tanpa port non-standar, tanpa punycode yang tidak terdaftar,
 * tanpa sufiks/subdomain jebakan. Salinan di ekstensi adalah yang otoritatif.
 */
export type OfficialDomain = {
  host: string;
  instansi: string;
  layanan: string;
  /** Kode wilayah Kemendagri (kab/kota) bila layanan bersifat daerah. */
  wilayah?: string;
  /** Tanggal verifikasi manual (ISO). null = seed dari rencana, verifikasi manual belum dicatat. */
  verifiedAt: string | null;
  /**
   * Syarat jaringan Browser Pendamping (diukur dari server produksi, IP pusat data Singapura, Chromium headed biasa):
   * - `id-only`: situs MEMBLOKIR KERAS IP luar negeri (mis. halaman "Akses Terbatas - Khusus Indonesia", tanpa
   *   apa pun yang bisa diselesaikan warga), jadi hanya worker berwilayah `id` yang bisa membukanya; tanpa worker
   *   `id` yang sehat urusan beralih ke mode dipandu.
   * - `id-utama`: dari server muncul tantangan INTERAKTIF (kotak centang Turnstile) yang diselesaikan warga
   *   sendiri lewat takeover `verifikasi_situs`; worker `id` yang sehat didahulukan (biasanya tanpa tantangan),
   *   selain itu worker mana pun (server tetap melayani 24/7).
   * Kosong = worker mana pun (worker non-`id` didahulukan).
   */
  aksesWilayah?: 'id-only' | 'id-utama';
};

const DOMAIN_SEED: readonly OfficialDomain[] = [
  {
    host: 'telunjuksakti.wonogirikab.go.id',
    instansi: 'Disdukcapil Kabupaten Wonogiri',
    layanan: 'Telunjuk Sakti (layanan adminduk daring)',
    wilayah: '3312',
    verifiedAt: null,
    // 2026-11-10 dari server produksi: 403 cf-mitigated: challenge + kotak centang Turnstile (bukan blokir keras).
    aksesWilayah: 'id-utama',
  },
  {
    host: 'disdukcapil.wonogirikab.go.id',
    instansi: 'Disdukcapil Kabupaten Wonogiri',
    layanan: 'Situs informasi Disdukcapil',
    wilayah: '3312',
    verifiedAt: null,
  },
  { host: 'www.lapor.go.id', instansi: 'SP4N-LAPOR!', layanan: 'Pengaduan publik', verifiedAt: null },
  {
    host: 'prod.lapor.go.id',
    instansi: 'SP4N-LAPOR!',
    layanan: 'Pengaduan publik (aplikasi)',
    verifiedAt: null,
  },
  {
    host: 'samsat-pkb2.jakarta.go.id',
    instansi: 'Bapenda Provinsi DKI Jakarta',
    layanan: 'Info pajak kendaraan bermotor',
    wilayah: '31',
    verifiedAt: null,
  },
  { host: 'cekdptonline.kpu.go.id', instansi: 'KPU', layanan: 'Cek DPT online', verifiedAt: null },
  {
    host: 'cekbansos.kemensos.go.id',
    instansi: 'Kementerian Sosial',
    layanan: 'Cek bansos',
    verifiedAt: null,
  },
  {
    host: 'oss.go.id',
    instansi: 'Kementerian Investasi/BKPM',
    layanan: 'OSS perizinan berusaha',
    verifiedAt: null,
  },
  // Dipanggil halaman oss.go.id sendiri (recon rea-samsat-oss): API Cari NIB, CMS portal, aset gambar.
  {
    host: 'api-prd.oss.go.id',
    instansi: 'Kementerian Investasi/BKPM',
    layanan: 'API OSS (Cari NIB dari halaman oss.go.id)',
    verifiedAt: null,
  },
  {
    host: 'gw.oss.go.id',
    instansi: 'Kementerian Investasi/BKPM',
    layanan: 'Gateway konten portal OSS',
    verifiedAt: null,
  },
  {
    host: 's3.oss.go.id',
    instansi: 'Kementerian Investasi/BKPM',
    layanan: 'Aset portal OSS',
    verifiedAt: null,
  },
  {
    host: 'klampid-disdukcapil.surabaya.go.id',
    instansi: 'Dispendukcapil Kota Surabaya',
    layanan: 'Klampid (layanan adminduk daring)',
    wilayah: '3578',
    verifiedAt: null,
  },
  {
    host: 'wargaklampid-dispendukcapil.surabaya.go.id',
    instansi: 'Dispendukcapil Kota Surabaya',
    layanan: 'Klampid warga',
    wilayah: '3578',
    verifiedAt: null,
  },
  {
    host: 'sidnok.semarangkota.go.id',
    instansi: 'Disdukcapil Kota Semarang',
    layanan: 'Sidnok (layanan adminduk daring)',
    wilayah: '3374',
    verifiedAt: null,
    // 2026-11-10 dari server produksi: 403 "Akses Terbatas - Khusus Indonesia" (WAF ESA), tanpa tantangan.
    aksesWilayah: 'id-only',
  },
];

/** Seed tangan + host persis wilayah (registry-wilayah.ts, hasil generator); seed menang bila host sama. */
export const OFFICIAL_DOMAINS: readonly OfficialDomain[] = Object.freeze([
  ...DOMAIN_SEED,
  ...DOMAIN_WILAYAH.filter((d) => !DOMAIN_SEED.some((s) => s.host === d.host)),
]);

const BY_HOST = new Map(OFFICIAL_DOMAINS.map((d) => [d.host, d]));

export type MatchResult = { ok: true; domain: OfficialDomain; url: URL } | { ok: false; code: ErrorCode };

/** Periksa URL lengkap terhadap registry. */
export function matchOfficialUrl(
  input: string,
  registry: ReadonlyMap<string, OfficialDomain> = BY_HOST,
): MatchResult {
  // Spasi/kontrol di awal-akhir dibuang oleh parser URL secara diam-diam; tolak agar eksplisit.
  // eslint-disable-next-line no-control-regex -- sengaja menolak karakter kontrol yang dibuang diam-diam oleh parser URL
  if (input !== input.trim() || /[\u0000-\u001f\u007f\s]/.test(input))
    return { ok: false, code: ErrorCode.URL_INVALID };
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, code: ErrorCode.URL_INVALID };
  }
  if (url.protocol !== 'https:') return { ok: false, code: ErrorCode.URL_NOT_HTTPS };
  if (url.username !== '' || url.password !== '' || /^[^/]*\/\/[^/?#]*@/.test(input)) {
    return { ok: false, code: ErrorCode.URL_HAS_USERINFO };
  }
  if (url.port !== '') return { ok: false, code: ErrorCode.URL_NONSTANDARD_PORT };
  const host = url.hostname;
  const domain = registry.get(host);
  if (!domain) {
    if (host.split('.').some((label) => label.startsWith('xn--'))) {
      return { ok: false, code: ErrorCode.URL_PUNYCODE };
    }
    return { ok: false, code: ErrorCode.DOMAIN_NOT_OFFICIAL };
  }
  return { ok: true, domain, url };
}

/** Periksa origin persis `https://<host>` (tanpa path, tanpa slash akhir). */
export function matchOfficialOrigin(origin: string): MatchResult {
  const result = matchOfficialUrl(origin);
  if (!result.ok) return result;
  if (result.url.origin !== origin) return { ok: false, code: ErrorCode.DOMAIN_NOT_OFFICIAL };
  return result;
}

export function isOfficialUrl(input: string): boolean {
  return matchOfficialUrl(input).ok;
}

export function getOfficialDomain(host: string): OfficialDomain | undefined {
  return BY_HOST.get(host);
}

/**
 * Host pihak ketiga yang lazim dibutuhkan situs resmi agar warga bisa menyelesaikan login (CAPTCHA,
 * Turnstile) dan memuat aset (CDN). Dipakai allowlist egress Browser Pendamping bersama `OFFICIAL_DOMAINS`:
 * HANYA https:443, host persis (tanpa wildcard). Tambah baris hanya dari recon situs nyata.
 */
export type EgressPihakKetiga = { host: string; alasan: string };

export const EGRESS_PIHAK_KETIGA: readonly EgressPihakKetiga[] = Object.freeze([
  { host: 'challenges.cloudflare.com', alasan: 'Cloudflare Turnstile' },
  { host: 'brunhild.challenges.cloudflare.com', alasan: 'Cloudflare Turnstile (flow, probe portal nyata)' },
  { host: 'www.google.com', alasan: 'reCAPTCHA (www.google.com/recaptcha)' },
  { host: 'www.gstatic.com', alasan: 'aset reCAPTCHA' },
  { host: 'www.recaptcha.net', alasan: 'reCAPTCHA (domain alternatif)' },
  { host: 'js.hcaptcha.com', alasan: 'hCaptcha' },
  { host: 'api.hcaptcha.com', alasan: 'hCaptcha' },
  { host: 'newassets.hcaptcha.com', alasan: 'hCaptcha' },
  { host: 'cdn.jsdelivr.net', alasan: 'CDN pustaka umum' },
  { host: 'cdnjs.cloudflare.com', alasan: 'CDN pustaka umum' },
  { host: 'code.jquery.com', alasan: 'CDN jQuery' },
  { host: 'ajax.googleapis.com', alasan: 'CDN pustaka umum' },
  { host: 'fonts.googleapis.com', alasan: 'Google Fonts (CSS)' },
  { host: 'fonts.gstatic.com', alasan: 'Google Fonts (berkas)' },
  { host: 'unpkg.com', alasan: 'CDN pustaka umum (probe portal nyata)' },
  { host: 'cdn.tailwindcss.com', alasan: 'CDN Tailwind (probe portal nyata)' },
  { host: 'stackpath.bootstrapcdn.com', alasan: 'CDN Bootstrap (probe portal nyata)' },
  { host: 'maxcdn.bootstrapcdn.com', alasan: 'CDN Bootstrap' },
  { host: 'cdn.datatables.net', alasan: 'CDN DataTables (probe portal nyata)' },
  { host: 'fonts.bunny.net', alasan: 'fon web (probe portal nyata)' },
]);

/**
 * Aset umum (CDN pustaka, fon) yang ikut BAWAAN setiap sesi wilayah: probe portal nyata (65 portal) menunjukkan
 * tampilan rusak/"loading..." bila jQuery/Bootstrap/Tailwind/fon diblokir. Hanya subresource GET; gerbang tulis
 * tetap memblokir tulis dari aksi AI. Semua anggota wajib terdaftar di `EGRESS_PIHAK_KETIGA`.
 */
export const EGRESS_ASET_UMUM: readonly string[] = Object.freeze([
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com',
  'code.jquery.com',
  'ajax.googleapis.com',
  'unpkg.com',
  'cdn.tailwindcss.com',
  'stackpath.bootstrapcdn.com',
  'maxcdn.bootstrapcdn.com',
  'cdn.datatables.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'fonts.bunny.net',
]);

/** Semua host https yang boleh dihubungi peramban pendamping: domain resmi + pihak ketiga terdaftar. */
export function egressAllowedHosts(): string[] {
  return [...new Set([...OFFICIAL_DOMAINS.map((d) => d.host), ...EGRESS_PIHAK_KETIGA.map((e) => e.host)])];
}
