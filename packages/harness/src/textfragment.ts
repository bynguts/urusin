/**
 * Text Fragments (WICG, https://wicg.github.io/scroll-to-text-fragment/):
 *   url#:~:text=[prefix-,]start[,end][,-suffix]
 * Setiap term di-percent-encode; karakter `-`, `,`, `&` WAJIB di-encode karena bermakna di sintaks.
 * Bentuk `start,end` dipakai untuk kutipan panjang; `prefix-,` / `,-suffix` dipakai bila `start` ambigu di teks sumber.
 */

/** Encode satu term directive: encodeURIComponent + `-` → %2D (encodeURIComponent membiarkan `-`). */
export function encodeTerm(term: string): string {
  return encodeURIComponent(term)
    .replace(/-/g, '%2D')
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export type FragmentParts = { prefix?: string; start: string; end?: string; suffix?: string };

export function buildDirective(parts: FragmentParts): string {
  const segs: string[] = [];
  if (parts.prefix) segs.push(`${encodeTerm(parts.prefix)}-`);
  segs.push(encodeTerm(parts.start));
  if (parts.end) segs.push(encodeTerm(parts.end));
  if (parts.suffix) segs.push(`-${encodeTerm(parts.suffix)}`);
  return `text=${segs.join(',')}`;
}

/** Tambahkan directive ke URL, mempertahankan fragmen yang sudah ada (`#bagian:~:text=...`). */
export function appendTextFragment(url: string, directive: string): string {
  // Buang directive lama bila ada; satu URL hanya satu `:~:`.
  const cleaned = url.split(':~:')[0] ?? url;
  const hashIndex = cleaned.indexOf('#');
  const base = hashIndex === -1 ? `${cleaned}#` : cleaned;
  return `${base}:~:${directive}`;
}

const LONG_QUOTE_WORDS = 12;
const EDGE_WORDS = 4;

const words = (s: string): string[] => s.split(/\s+/).filter(Boolean);

/**
 * Susun URL Text Fragment untuk `quote` (potongan persis dari `pageText`).
 * - Kutipan pendek: `text=<quote>`.
 * - Kutipan panjang (> 12 kata): `text=<4 kata awal>,<4 kata akhir>` (rentang).
 * - Bila bagian awal muncul lebih dari sekali di `pageText`, tambahkan `prefix-,` (dan `,-suffix` bila masih ambigu).
 */
export function textFragmentUrl(url: string, pageText: string, quote: string): string {
  const q = words(quote);
  if (q.length === 0) return url;
  const long = q.length > LONG_QUOTE_WORDS;
  const start = (long ? q.slice(0, EDGE_WORDS) : q).join(' ');
  const end = long ? q.slice(-EDGE_WORDS).join(' ') : undefined;

  const parts: FragmentParts = { start, ...(end ? { end } : {}) };
  const occurrences = countOccurrences(pageText, start);
  if (occurrences > 1) {
    const at = indexOfLoose(pageText, quote);
    if (at !== -1) {
      const before = words(pageText.slice(0, at));
      const after = words(pageText.slice(at + quote.length));
      const prefix = before.slice(-3).join(' ');
      const suffix = after.slice(0, 3).join(' ');
      if (prefix) parts.prefix = prefix;
      // Bila awalan saja masih ambigu (atau tidak ada awalan), tambahkan akhiran.
      if (!prefix || countOccurrences(pageText, `${prefix} ${start}`) > 1) {
        if (suffix) parts.suffix = suffix;
      }
    }
  }
  return appendTextFragment(url, buildDirective(parts));
}

function countOccurrences(hay: string, needle: string): number {
  if (!needle) return 0;
  const h = hay.toLowerCase();
  const n = needle.toLowerCase();
  let count = 0;
  let from = 0;
  for (;;) {
    const i = h.indexOf(n, from);
    if (i === -1) return count;
    count++;
    from = i + 1;
  }
}

function indexOfLoose(hay: string, needle: string): number {
  return hay.toLowerCase().indexOf(needle.toLowerCase());
}
