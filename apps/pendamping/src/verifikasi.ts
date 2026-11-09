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
  return /^\s*(?:just a moment|checking your browser|verifying you are human|one more step|tunggu sebentar|ddos-guard)/i.test(
    title,
  );
}

export type HasilPantau = 'tidak_ada' | 'mulai' | 'masih' | 'ulang' | 'lolos' | 'gagal';

/**
 * Mesin status tantangan. `amati(ada, navKe)` dipanggil setiap pemeriksaan; `navKe` = nomor dokumen utama
 * (naik pada setiap respons navigasi lintas-dokumen, bukan history API).
 * - tantangan muncul -> `mulai`; masih di dokumen yang sama -> `masih`;
 * - tantangan dimuat ulang (dokumen baru, masih tantangan) -> satu kegagalan (`ulang`);
 * - tantangan muncul lagi setelah sempat lolos -> satu kegagalan (loop);
 * - kegagalan ke-`maksGagal` -> `gagal` (beralih ke dipandu); tantangan hilang -> `lolos`.
 */
export function createPantauTantangan(maksGagal = 2) {
  let aktif = false;
  let nav = -1;
  let gagal = 0;
  let pernahLolos = false;
  let selesai = false;
  return {
    get aktif() {
      return aktif;
    },
    get gagal() {
      return gagal;
    },
    amati(ada: boolean, navKe: number): HasilPantau {
      if (selesai) return 'gagal';
      if (!ada) {
        if (!aktif) return 'tidak_ada';
        aktif = false;
        pernahLolos = true;
        return 'lolos';
      }
      if (aktif && navKe === nav) return 'masih';
      const ulang = aktif || pernahLolos;
      aktif = true;
      nav = navKe;
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
