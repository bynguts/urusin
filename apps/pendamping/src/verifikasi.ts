/**
 * Verifikasi situs (temuan arsitek B-b): halaman tantangan bot (Cloudflare "Just a moment", kotak centang
 * Turnstile) diserahkan ke WARGA sebagai takeover `verifikasi_situs`. Urusin tidak pernah menyelesaikannya
 * sendiri: AI berhenti, tidak ada pemecah CAPTCHA, tidak ada stealth. Hanya setelah tantangan gagal/berulang
 * `maksGagal` kali urusan beralih ke mode dipandu.
 */

/** Host widget Turnstile/tantangan Cloudflare; jalur `/cdn-cgi/challenge-platform/` dipakai di origin situs. */
export const HOST_TANTANGAN = 'challenges.cloudflare.com';

/** URL frame milik tantangan bot (iframe Turnstile atau platform tantangan di origin situs). */
export function isChallengeFrameUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === HOST_TANTANGAN || u.pathname.startsWith('/cdn-cgi/challenge-platform/');
  } catch {
    return false;
  }
}

/** Judul halaman antara (interstitial) tantangan bot. */
export function isInterstitialTitle(title: string): boolean {
  return /^\s*(?:just a moment|checking your browser|verifying you are human|verify you are human|performing security verification|one more step|tunggu sebentar|melakukan verifikasi keamanan|ddos-guard)/i.test(
    title,
  );
}

export type HasilPantau = 'tidak_ada' | 'mulai' | 'masih' | 'ulang' | 'lolos' | 'gagal';

/** Tantangan yang muncul lagi di halaman yang sama dalam jendela ini setelah lolos = loop (ditolak situs). */
export const JENDELA_ULANG_MS = 10_000;

/** Halaman yang sama = origin + jalur sama (query/hash diabaikan: token tantangan sering ditempel di query). */
function halaman(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}

/**
 * Mesin status tantangan. `amati(ada, navKe, url, now)` dipanggil setiap pemeriksaan; `navKe` = nomor dokumen
 * utama (naik pada setiap respons navigasi lintas-dokumen, bukan history API), `url` = URL halaman utama.
 * - tantangan muncul -> `mulai`; masih di dokumen yang sama -> `masih`;
 * - tantangan dimuat ulang (dokumen baru, masih tantangan) -> satu kegagalan (`ulang`);
 * - tantangan muncul lagi setelah sempat lolos, di halaman yang SAMA dalam `JENDELA_ULANG_MS` -> satu
 *   kegagalan (loop: situs menolak hasil verifikasi);
 * - tantangan muncul lagi di halaman lain atau setelah jendela lewat -> tantangan baru (`mulai`, hitungan
 *   kegagalan mulai dari nol): situs boleh menantang lagi di langkah berikutnya;
 * - kegagalan ke-`maksGagal` -> `gagal` (beralih ke dipandu); tantangan hilang -> `lolos`.
 */
export function createPantauTantangan(maksGagal = 2) {
  let aktif = false;
  let nav = -1;
  let gagal = 0;
  /** Halaman tempat tantangan terakhir aktif. */
  let halamanTantangan = '';
  let lolosPada: number | undefined;
  let selesai = false;
  return {
    get aktif() {
      return aktif;
    },
    get gagal() {
      return gagal;
    },
    amati(ada: boolean, navKe: number, url: string, now = Date.now()): HasilPantau {
      if (selesai) return 'gagal';
      if (!ada) {
        if (!aktif) return 'tidak_ada';
        aktif = false;
        lolosPada = now;
        return 'lolos';
      }
      if (aktif && navKe === nav) return 'masih';
      const loop =
        !aktif &&
        lolosPada !== undefined &&
        now - lolosPada <= JENDELA_ULANG_MS &&
        halaman(url) === halamanTantangan;
      const ulang = aktif || loop;
      if (!aktif && !loop) gagal = 0;
      aktif = true;
      nav = navKe;
      halamanTantangan = halaman(url);
      if (!ulang) return 'mulai';
      gagal++;
      if (gagal >= maksGagal) {
        selesai = true;
        return 'gagal';
      }
      return 'ulang';
    },
  };
}
