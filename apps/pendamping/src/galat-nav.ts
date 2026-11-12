import { KANAL_NASIONAL, PORTAL_WILAYAH } from '@urusin/core';

/**
 * Halaman galat navigasi Chromium (temuan QA prod, siapel.malangkota.go.id): bila navigasi bingkai utama gagal,
 * Chromium meng-commit `chrome-error://chromewebdata/` berisi halaman galatnya sendiri. Untuk galat sertifikat itu
 * layar peringatan TLS dengan tombol "Advanced". Halaman itu TIDAK pernah boleh diserahkan ke warga sebagai
 * giliran ("lanjutkan sendiri"): sesi berakhir ke mode dipandu dengan pesan jujur dan kanal resmi lain.
 */

/** Dokumen utama yang ter-commit adalah halaman galat Chromium (bukan halaman situs). */
export function halamanGalatChrome(url: string): boolean {
  return url.startsWith('chrome-error:');
}

export type JenisGalatNav = 'sertifikat' | 'dns' | 'koneksi' | 'waktu' | 'jalur_keluar' | 'lain';

/**
 * Golongan galat jaringan navigasi (`net::ERR_*`). undefined = bukan kegagalan situs: `ERR_ABORTED` (navigasi
 * dibatalkan, mis. gerbang tulis) dan `ERR_BLOCKED_BY_CLIENT` (lapis rute allowlist menolak host lain).
 */
export function jenisGalatNav(net: string | undefined): JenisGalatNav | undefined {
  if (!net || !/^net::ERR_[A-Z0-9_]{1,64}$/.test(net)) return undefined;
  const k = net.slice('net::ERR_'.length);
  if (k === 'ABORTED' || k === 'BLOCKED_BY_CLIENT') return undefined;
  if (/^(CERT_|SSL_)|_SSL_|^BAD_SSL|^SSL$|_CERT_|^HSTS|PINNING|CERTIFICATE/.test(k)) return 'sertifikat';
  if (/^(NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED|ADDRESS_UNREACHABLE|ADDRESS_INVALID|DNS_)/.test(k))
    return 'dns';
  if (/TIMED_OUT/.test(k)) return 'waktu';
  if (/^(TUNNEL_CONNECTION_FAILED|PROXY_)/.test(k)) return 'jalur_keluar';
  if (
    /^(CONNECTION_(REFUSED|RESET|CLOSED|FAILED|ABORTED)|EMPTY_RESPONSE|SOCKET_NOT_CONNECTED|NETWORK_CHANGED|INVALID_RESPONSE|HTTP2_PROTOCOL_ERROR)$/.test(
      k,
    )
  )
    return 'koneksi';
  return 'lain';
}

/**
 * Galat yang PASTI masalah situs itu sendiri (sertifikat, DNS, koneksi, waktu habis), bukan host di luar
 * allowlist. `jalur_keluar` (proxy menolak/tidak tersambung) bisa berarti redirect ke host lain, jadi tidak di sini.
 */
export function galatSitus(net: string | undefined): boolean {
  const j = jenisGalatNav(net);
  return j === 'sertifikat' || j === 'dns' || j === 'koneksi' || j === 'waktu';
}

function sebab(net: string): string {
  switch (jenisGalatNav(net)) {
    case 'sertifikat':
      return net === 'net::ERR_CERT_AUTHORITY_INVALID'
        ? 'sertifikat keamanannya tidak lengkap atau tidak dikenali'
        : 'sertifikat keamanannya tidak sah';
    case 'dns':
      return 'alamatnya tidak ditemukan';
    case 'waktu':
      return 'tidak menjawab tepat waktu';
    default:
      return 'tidak bisa dihubungi';
  }
}

/** Kanal resmi lain untuk host portal (registry wilayah): situs informasi Disdukcapil, IKD, kantor. */
export function kanalLain(host: string): string[] {
  const h = host.toLowerCase().replace(/:\d+$/, '');
  const portal = Object.values(PORTAL_WILAYAH).find((p) => p.hosts.includes(h));
  const info = portal?.hostInfo.filter((x) => x !== h) ?? [];
  return [
    ...info.slice(0, 1).map((x) => `situs informasi Disdukcapil ${x}`),
    `aplikasi ${KANAL_NASIONAL.ikd?.nama ?? 'Identitas Kependudukan Digital (IKD)'}`,
    'kantor Disdukcapil terdekat',
  ];
}

/** Halaman awal situs resmi dialihkan ke host di luar daftar (ditolak egress): dipandu, bukan halaman galat. */
export function pesanAlihLuar(host: string): string {
  return (
    `Situs ${host} mengalihkan ke alamat di luar daftar situs resmi, jadi AI tidak membukanya demi keamanan. ` +
    `Gunakan kanal resmi lain: ${kanalLain(host).join(', ')}. Tekan Buka panduan untuk langkahnya.`
  );
}

/**
 * Pesan jujur untuk warga saat situs resmi tidak bisa dibuka dengan aman. Tanpa path, nilai, atau PII; kode
 * galat di akhir untuk operator.
 */
export function pesanSitusBermasalah(host: string, net: string): string {
  return (
    `Situs ${host} sedang bermasalah (${sebab(net)}). Demi keamanan, AI tidak membukanya. ` +
    `Gunakan kanal resmi lain: ${kanalLain(host).join(', ')}. Tekan Buka panduan untuk langkahnya. (${net})`
  );
}
