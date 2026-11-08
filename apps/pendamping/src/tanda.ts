import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Tanda tangan HMAC kanal web -> worker pendamping (temuan multi-worker: worker bisa berupa laptop anggota
 * lewat Tailscale, jadi kanal diautentikasi selain jaringan privat). Rahasia bersama =
 * PENDAMPING_INTERNAL_TOKEN. Yang ditandatangani: waktu (ms), metode, jalur, sha256 isi. Permintaan di luar
 * jendela `TOLERANSI_MS` ditolak (membatasi replay). Salinan identik di apps/web (lib/server/pendamping.ts);
 * vektor uji yang sama di kedua sisi menjaga keduanya tetap cocok.
 */
export const TOLERANSI_MS = 60_000;
export const HEADER_WAKTU = 'x-urusin-waktu';
export const HEADER_TANDA = 'x-urusin-tanda';

export function tandaInternal(
  rahasia: string,
  waktu: string,
  metode: string,
  jalur: string,
  isi: string | Uint8Array,
): string {
  const hashIsi = createHash('sha256').update(isi).digest('hex');
  return createHmac('sha256', rahasia)
    .update(`${waktu}\n${metode.toUpperCase()}\n${jalur}\n${hashIsi}`)
    .digest('hex');
}

export function periksaTanda(
  rahasia: string,
  h: { waktu: string | undefined; tanda: string | undefined },
  metode: string,
  jalur: string,
  isi: string | Uint8Array,
  now = Date.now(),
): boolean {
  if (!h.waktu || !h.tanda || !/^\d{13}$/.test(h.waktu) || !/^[0-9a-f]{64}$/.test(h.tanda)) return false;
  if (Math.abs(now - Number(h.waktu)) > TOLERANSI_MS) return false;
  const harap = Buffer.from(tandaInternal(rahasia, h.waktu, metode, jalur, isi), 'hex');
  return timingSafeEqual(harap, Buffer.from(h.tanda, 'hex'));
}
