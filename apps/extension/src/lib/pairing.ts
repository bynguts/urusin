import { err, type ErrorReply } from './protocol';

/** Penyimpanan kunci-nilai minimal (chrome.storage.session di produksi, Map di tes). */
export type KV = {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
};

export const PAIR_TTL_MS = 5 * 60 * 1000;
const PENDING = 'pairing.pending';
const PAIRED = 'pairing.paired';

type Pending = { nonce: string; createdAt: number };
export type Paired = { origin: string; nonce: string; pairedAt: number };

export function randomNonce(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Perbandingan waktu-konstan untuk string nonce. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Dipanggil dari popup (user gesture): terbitkan nonce sekali pakai. */
export async function startPairing(kv: KV, now: number, nonce = randomNonce()): Promise<string> {
  await kv.set(PENDING, { nonce, createdAt: now } satisfies Pending);
  return nonce;
}

/** Web app mengirim nonce dari fragment URL. Nonce habis dipakai (sekali pakai), berhasil atau tidak. */
export async function completePairing(
  kv: KV,
  senderOrigin: string | undefined,
  allowedOrigins: readonly string[],
  nonce: string,
  now: number,
): Promise<{ ok: true; origin: string } | ErrorReply> {
  if (!senderOrigin || !allowedOrigins.includes(senderOrigin)) {
    return err('ORIGIN_NOT_ALLOWED', 'origin pengirim tidak diizinkan');
  }
  const pending = await kv.get<Pending>(PENDING);
  if (!pending) return err('PAIR_NOT_STARTED', 'pairing belum dimulai dari popup ekstensi');
  await kv.remove(PENDING);
  if (now - pending.createdAt > PAIR_TTL_MS) return err('PAIR_EXPIRED', 'nonce pairing kedaluwarsa');
  if (!safeEqual(pending.nonce, nonce)) return err('NONCE_MISMATCH', 'nonce tidak cocok');
  await kv.set(PAIRED, { origin: senderOrigin, nonce, pairedAt: now } satisfies Paired);
  return { ok: true, origin: senderOrigin };
}

/** Pesan lain diterima hanya dari origin yang ter-pairing DAN membawa nonce yang cocok. */
export async function authorize(
  kv: KV,
  senderOrigin: string | undefined,
  nonce: string,
): Promise<{ ok: true; paired: Paired } | ErrorReply> {
  const paired = await kv.get<Paired>(PAIRED);
  if (!paired) return err('NOT_PAIRED', 'belum ter-pairing');
  if (!senderOrigin || senderOrigin !== paired.origin) {
    return err('ORIGIN_NOT_PAIRED', 'origin tidak sesuai pairing');
  }
  if (!safeEqual(paired.nonce, nonce)) return err('NONCE_MISMATCH', 'nonce tidak cocok');
  return { ok: true, paired };
}

export async function getPaired(kv: KV): Promise<Paired | undefined> {
  return kv.get<Paired>(PAIRED);
}

export async function unpair(kv: KV): Promise<void> {
  await kv.remove(PAIRED);
  await kv.remove(PENDING);
}
