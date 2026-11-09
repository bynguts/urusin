import type http from 'node:http';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Tanda tangan HMAC kanal web -> worker pendamping (dan pendamping -> edge). Worker bisa berada di host lain
 * lewat Tailscale, jadi kanal diautentikasi selain jaringan privat. Yang ditandatangani: waktu (ms), nonce
 * acak, metode, jalur, panjang isi (Content-Length) dan sha256 isi yang DIDEKLARASIKAN di header
 * `x-urusin-isi-sha256`. Karena semua itu ada di header, tanda tangan diperiksa SEBELUM satu byte isi dibaca;
 * isi lalu dibaca dengan batas dan di-hash sambil jalan, dan ditolak bila tidak cocok dengan deklarasinya.
 * Permintaan di luar jendela `TOLERANSI_MS` ditolak, dan nonce yang sudah terlihat dalam jendela itu ditolak
 * (`createPenjagaUlang`), jadi permintaan yang disadap tidak bisa diputar ulang. Salinan identik di apps/web
 * (lib/server/pendamping.ts); vektor uji yang sama di kedua sisi menjaga keduanya tetap cocok.
 */
export const TOLERANSI_MS = 60_000;
export const HEADER_WAKTU = 'x-urusin-waktu';
export const HEADER_NONCE = 'x-urusin-nonce';
export const HEADER_TANDA = 'x-urusin-tanda';
export const HEADER_ISI = 'x-urusin-isi-sha256';

const sha256 = (isi: string | Uint8Array) => createHash('sha256').update(isi).digest('hex');

/** HMAC atas header saja (panjang + hash isi yang dideklarasikan): bisa diperiksa sebelum isi dibaca. */
export function tandaDariHeader(
  rahasia: string,
  waktu: string,
  nonce: string,
  metode: string,
  jalur: string,
  panjang: number,
  hashIsi: string,
): string {
  return createHmac('sha256', rahasia)
    .update(`${waktu}\n${nonce}\n${metode.toUpperCase()}\n${jalur}\n${panjang}\n${hashIsi}`)
    .digest('hex');
}

/** Tanda untuk isi tertentu (panjang byte + sha256 dihitung dari isi). */
export function tandaInternal(
  rahasia: string,
  waktu: string,
  nonce: string,
  metode: string,
  jalur: string,
  isi: string | Uint8Array,
): string {
  const panjang = typeof isi === 'string' ? Buffer.byteLength(isi) : isi.byteLength;
  return tandaDariHeader(rahasia, waktu, nonce, metode, jalur, panjang, sha256(isi));
}

/** Header bertanda untuk satu permintaan (waktu sekarang, nonce acak 128 bit, hash isi dideklarasikan). */
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
    [HEADER_ISI]: sha256(isi),
    [HEADER_TANDA]: tandaInternal(rahasia, waktu, nonce, metode, jalur, isi),
  };
}

/** Header tanda dari permintaan masuk. `panjang` = Content-Length (tanpa isi dan tanpa chunked = "0"). */
export type HeaderTanda = {
  waktu: string | undefined;
  nonce: string | undefined;
  tanda: string | undefined;
  isi: string | undefined;
  panjang: string | undefined;
};

export function headerDari(req: http.IncomingMessage): HeaderTanda {
  const h = (n: string) => {
    const v = req.headers[n];
    return typeof v === 'string' ? v : undefined;
  };
  const panjang = h('content-length') ?? (req.headers['transfer-encoding'] ? undefined : '0');
  return {
    waktu: h(HEADER_WAKTU),
    nonce: h(HEADER_NONCE),
    tanda: h(HEADER_TANDA),
    isi: h(HEADER_ISI),
    panjang,
  };
}

type HeaderSah = { waktu: string; nonce: string; tanda: string; isi: string; panjang: string };

/** Semua header ada, formatnya benar, dan waktu dalam jendela. */
export function headerLayak(h: HeaderTanda, now = Date.now()): h is HeaderSah {
  if (!h.waktu || !h.nonce || !h.tanda || !h.isi || !h.panjang) return false;
  if (
    !/^\d{13}$/.test(h.waktu) ||
    !/^[0-9a-f]{32}$/.test(h.nonce) ||
    !/^[0-9a-f]{64}$/.test(h.tanda) ||
    !/^[0-9a-f]{64}$/.test(h.isi) ||
    !/^(0|[1-9]\d{0,8})$/.test(h.panjang)
  )
    return false;
  return Math.abs(now - Number(h.waktu)) <= TOLERANSI_MS;
}

/**
 * Periksa tanda tangan atas header + jendela waktu, TANPA isi (tanpa memeriksa pemutaran ulang; lihat
 * `createPenjagaUlang`). Isi diperiksa terpisah dengan `isiCocok` setelah dibaca.
 */
export function periksaTanda(
  rahasia: string,
  h: HeaderTanda,
  metode: string,
  jalur: string,
  now = Date.now(),
): boolean {
  if (!headerLayak(h, now)) return false;
  const harap = tandaDariHeader(rahasia, h.waktu, h.nonce, metode, jalur, Number(h.panjang), h.isi);
  return timingSafeEqual(Buffer.from(harap, 'hex'), Buffer.from(h.tanda, 'hex'));
}

/** Isi yang benar-benar diterima sama dengan panjang + hash yang ditandatangani. */
export function isiCocok(h: HeaderTanda, isi: Uint8Array, hashIsi = sha256(isi)): boolean {
  return (
    h.isi !== undefined &&
    isi.byteLength === Number(h.panjang) &&
    timingSafeEqual(Buffer.from(hashIsi, 'hex'), Buffer.from(h.isi, 'hex'))
  );
}

/**
 * Baca isi dengan batas `maks`, hash sambil jalan, lalu cocokkan dengan header bertanda. null = terlalu besar;
 * false = tidak cocok dengan deklarasi (isi ditolak).
 */
export async function bacaIsiBertanda(
  req: http.IncomingMessage,
  h: HeaderTanda,
  maks: number,
): Promise<Buffer | null | false> {
  const hash = createHash('sha256');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > maks) return null;
    hash.update(c as Buffer);
    chunks.push(c as Buffer);
  }
  const isi = Buffer.concat(chunks);
  return isiCocok(h, isi, hash.digest('hex')) ? isi : false;
}

/**
 * Pemeriksa header lengkap: tanda tangan sah DAN nonce belum pernah dipakai dalam jendela waktu. Nonce dicatat
 * begitu tanda tangan header sah (hanya pemegang rahasia yang bisa memakainya), disimpan 2 x TOLERANSI_MS,
 * dibatasi `maks` entri agar tidak bisa dipakai menghabiskan memori.
 */
export function createPenjagaUlang(rahasia: string, maks = 50_000) {
  const terlihat = new Map<string, number>();
  return (h: HeaderTanda, metode: string, jalur: string, now = Date.now()): boolean => {
    if (!periksaTanda(rahasia, h, metode, jalur, now)) return false;
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
