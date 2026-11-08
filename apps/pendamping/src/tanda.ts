import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Tanda tangan HMAC kanal web -> worker pendamping (dan pendamping -> edge). Worker bisa berada di host lain
 * lewat Tailscale, jadi kanal diautentikasi selain jaringan privat. Yang ditandatangani: waktu (ms), nonce
 * acak, metode, jalur, sha256 isi. Permintaan di luar jendela `TOLERANSI_MS` ditolak, dan nonce yang sudah
 * terlihat dalam jendela itu ditolak (`createPenjagaUlang`), jadi permintaan yang disadap tidak bisa diputar
 * ulang. Salinan identik di apps/web (lib/server/pendamping.ts); vektor uji yang sama di kedua sisi menjaga
 * keduanya tetap cocok.
 */
export const TOLERANSI_MS = 60_000;
export const HEADER_WAKTU = 'x-urusin-waktu';
export const HEADER_NONCE = 'x-urusin-nonce';
export const HEADER_TANDA = 'x-urusin-tanda';

export function tandaInternal(
  rahasia: string,
  waktu: string,
  nonce: string,
  metode: string,
  jalur: string,
  isi: string | Uint8Array,
): string {
  const hashIsi = createHash('sha256').update(isi).digest('hex');
  return createHmac('sha256', rahasia)
    .update(`${waktu}\n${nonce}\n${metode.toUpperCase()}\n${jalur}\n${hashIsi}`)
    .digest('hex');
}

/** Header bertanda untuk satu permintaan (waktu sekarang, nonce acak 128 bit). */
export function headerTanda(
  rahasia: string,
  metode: string,
  jalur: string,
  isi: string | Uint8Array = '',
  now = Date.now(),
): Record<string, string> {
  const waktu = String(now);
  const nonce = randomBytes(16).toString('hex');
  return {
    [HEADER_WAKTU]: waktu,
    [HEADER_NONCE]: nonce,
    [HEADER_TANDA]: tandaInternal(rahasia, waktu, nonce, metode, jalur, isi),
  };
}

export type HeaderTanda = { waktu: string | undefined; nonce: string | undefined; tanda: string | undefined };

/** Periksa tanda tangan + jendela waktu (tanpa memeriksa pemutaran ulang; lihat `createPenjagaUlang`). */
export function periksaTanda(
  rahasia: string,
  h: HeaderTanda,
  metode: string,
  jalur: string,
  isi: string | Uint8Array,
  now = Date.now(),
): boolean {
  if (!h.waktu || !h.nonce || !h.tanda) return false;
  if (!/^\d{13}$/.test(h.waktu) || !/^[0-9a-f]{32}$/.test(h.nonce) || !/^[0-9a-f]{64}$/.test(h.tanda))
    return false;
  if (Math.abs(now - Number(h.waktu)) > TOLERANSI_MS) return false;
  const harap = Buffer.from(tandaInternal(rahasia, h.waktu, h.nonce, metode, jalur, isi), 'hex');
  return timingSafeEqual(harap, Buffer.from(h.tanda, 'hex'));
}

/**
 * Pemeriksa lengkap: tanda tangan sah DAN nonce belum pernah dipakai dalam jendela waktu. Nonce disimpan
 * selama 2 x TOLERANSI_MS (cukup untuk menolak ulang apa pun yang masih lolos jendela waktu), dibatasi
 * `maks` entri agar tidak bisa dipakai menghabiskan memori.
 */
export function createPenjagaUlang(rahasia: string, maks = 50_000) {
  const terlihat = new Map<string, number>();
  return (
    h: HeaderTanda,
    metode: string,
    jalur: string,
    isi: string | Uint8Array,
    now = Date.now(),
  ): boolean => {
    if (!periksaTanda(rahasia, h, metode, jalur, isi, now)) return false;
    for (const [n, t] of terlihat) {
      if (now - t <= 2 * TOLERANSI_MS) break;
      terlihat.delete(n);
    }
    const nonce = h.nonce as string;
    if (terlihat.has(nonce) || terlihat.size >= maks) return false;
    terlihat.set(nonce, now);
    return true;
  };
}
