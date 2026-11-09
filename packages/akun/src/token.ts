import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Token acak 256-bit, base64url tanpa padding (43 karakter). Hanya hash-nya yang pernah disimpan. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Bentuk token yang diterbitkan `randomToken()` (dipakai untuk menolak masukan aneh sebelum menyentuh DB). */
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Perbandingan waktu-konstan untuk string (panjang berbeda = tidak sama, tanpa membocorkan isi). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Id baru berawalan, mis. `akun_<32 hex>`. */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(16).toString('hex')}`;
}
