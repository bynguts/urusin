/**
 * Deteksi WAF / bot wall pada respons dokumen utama. Urusin TIDAK mencoba menembus (tanpa stealth, tanpa
 * pemecah CAPTCHA). Tantangan yang bisa diselesaikan manusia (Cloudflare challenge, DDoS-Guard) diserahkan
 * ke warga sebagai takeover `verifikasi_situs` (verifikasi.ts); blokir keras (tanpa apa pun yang bisa
 * diselesaikan warga) langsung beralih ke mode dipandu.
 * CAPTCHA biasa di formulir login (diketik warga) BUKAN bot wall.
 */
export type ResponseInfo = {
  status: number;
  headers: Record<string, string>;
  /** Potongan awal isi HTML (opsional; hanya dibaca bila status/header mencurigakan). */
  body?: string | undefined;
};

/**
 * Urutan penting: blokir keras Cloudflare diperiksa SEBELUM tantangan, karena halaman blokir (dan halaman biasa)
 * di belakang Cloudflare ikut memuat skrip telemetri `/cdn-cgi/challenge-platform/scripts/jsd/main.js` (probe
 * gel4 7371: "you have been blocked" tidak boleh dikira tantangan yang bisa diselesaikan warga). Penanda
 * tantangan hanya yang khas halaman tantangan (`_cf_chl_opt`, orkestrasi `/challenge-platform/h/`, judul
 * interstitial), bukan sekadar kata `challenge-platform`.
 */
const MARKERS: { re: RegExp; nama: string }[] = [
  {
    re: /Attention Required! \| Cloudflare|cf-error-details|Sorry, you have been blocked|you have been blocked/i,
    nama: 'cloudflare-block',
  },
  {
    re: /cf_chl_opt|cf-chl-|\/cdn-cgi\/challenge-platform\/h\/|<title>\s*(?:Just a moment|Tunggu sebentar|Melakukan verifikasi keamanan|Performing security verification)/i,
    nama: 'cloudflare-challenge',
  },
  { re: /Incapsula incident ID|_Incapsula_Resource/i, nama: 'imperva' },
  { re: /Request unsuccessful\. Incapsula/i, nama: 'imperva' },
  { re: /Access Denied[\s\S]{0,200}Reference #[0-9a-f.]+/i, nama: 'akamai' },
  { re: /The requested URL was rejected\. Please consult with your administrator/i, nama: 'f5-asm' },
  {
    re: /<title>\s*(?:Access denied|Forbidden|Blocked)[^<]*<\/title>[\s\S]{0,2000}(?:bot|automated|robot)/i,
    nama: 'generic-bot',
  },
  { re: /ddos-guard|DDoS-Guard/i, nama: 'ddos-guard' },
  { re: /sucuri_cloudproxy|Sucuri WebSite Firewall/i, nama: 'sucuri' },
];

/** Status/header yang pantas membuat isi respons dibaca untuk diperiksa. */
export function suspicious(r: Pick<ResponseInfo, 'status' | 'headers'>): boolean {
  const mitigated = Object.keys(r.headers).some((k) => k.toLowerCase() === 'cf-mitigated');
  return r.status === 403 || r.status === 429 || r.status === 503 || mitigated;
}

/** Nama penanda bila respons adalah bot wall, selain itu null. */
export function detectBotWall(r: ResponseInfo): string | null {
  const mitigated = r.headers['cf-mitigated'];
  if (mitigated && /challenge/i.test(mitigated)) return 'cloudflare-challenge';
  if (mitigated && /block/i.test(mitigated)) return 'cloudflare-block';
  if (!suspicious(r)) return null;
  const body = r.body ?? '';
  for (const m of MARKERS) if (m.re.test(body)) return m.nama;
  if (r.status === 429) return 'rate-limit';
  return null;
}

/** Bot wall berupa tantangan yang bisa diselesaikan warga sendiri (bukan blokir keras). */
export function wallBisaDiverifikasi(nama: string): boolean {
  return nama === 'cloudflare-challenge' || nama === 'ddos-guard';
}
