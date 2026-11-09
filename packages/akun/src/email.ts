/** Batas RFC 5321 untuk alamat lengkap. */
const MAX_EMAIL = 254;
// Sengaja sederhana: satu @, bagian lokal tanpa spasi, domain bertitik. Kebenaran akhir = email verifikasi.
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@.]+(?:\.[^\s@.]+)+$/;

/**
 * Normalisasi email untuk keunikan akun: trim, NFKC, huruf kecil. Titik/plus Gmail TIDAK dibuang (itu
 * aturan satu penyedia, bukan standar). Mengembalikan null bila bentuknya tidak masuk akal.
 */
export function normalizeEmail(raw: string): string | null {
  const e = raw.trim().normalize('NFKC').toLowerCase();
  if (e.length > MAX_EMAIL || !EMAIL_RE.test(e)) return null;
  return e;
}

/** Samarkan email untuk log: `w***@example.com`. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}
