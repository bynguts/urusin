/**
 * Detektor PII sederhana (regex) untuk guard parameter LLM.
 * Selaras dengan scripts/pii-scan.mjs; vault/interseptor lengkap ada di @urusin/vault.
 */

/** Kode provinsi Kemendagri yang valid (2 digit pertama NIK). */
export const PROVINCE_CODES: ReadonlySet<string> = new Set([
  '11',
  '12',
  '13',
  '14',
  '15',
  '16',
  '17',
  '18',
  '19',
  '21',
  '31',
  '32',
  '33',
  '34',
  '35',
  '36',
  '51',
  '52',
  '53',
  '61',
  '62',
  '63',
  '64',
  '65',
  '71',
  '72',
  '73',
  '74',
  '75',
  '76',
  '81',
  '82',
  '91',
  '92',
  '93',
  '94',
  '95',
  '96',
]);

/** Pemisah antar digit yang diizinkan: sampai 3 karakter non-huruf/non-angka (spasi, titik, strip, garis bawah, garis miring, kurung). */
const GAP = String.raw`[^\p{L}\p{N}]{0,3}`;
const NIK_RE = new RegExp(String.raw`(?<!\d)(?:\d${GAP}){15}\d(?!\d)`, 'gu');
const DUA_BELAS_RE = new RegExp(String.raw`(?<!\d)(?:\d${GAP}){11}\d(?!\d)`, 'gu');
const PHONE_RE = new RegExp(
  String.raw`(?<!\d)(?:\+${GAP}6${GAP}2|6${GAP}2|0)${GAP}8${GAP}[1-9](?:${GAP}\d){6,10}(?!\d)`,
  'gu',
);
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const FORMAT_CHAR = /\p{Cf}/u;
const DECIMAL_DIGIT = /\p{Nd}/u;

/** NIK: PP KK CC DD MM YY NNNN; DD 01-31 (laki-laki) atau 41-71 (perempuan), MM 01-12. */
export function isNikLike(digits: string): boolean {
  if (!/^\d{16}$/.test(digits)) return false;
  if (!PROVINCE_CODES.has(digits.slice(0, 2))) return false;
  const day = Number(digits.slice(6, 8));
  const month = Number(digits.slice(8, 10));
  const validDay = (day >= 1 && day <= 31) || (day >= 41 && day <= 71);
  return validDay && month >= 1 && month <= 12;
}

/** Konteks tambahan: kode kab/kota yang sudah diketahui (empat digit pertama NIK). */
export type PiiOptions = { kodeKabKota?: string | null | undefined };

export type NormalizedText = {
  text: string;
  /** Untuk tiap karakter di `text`: rentang [start, end) di teks asli (indeks UTF-16). */
  map: { start: number; end: number }[];
};

function asciiDigit(c: string): string {
  const cp = c.codePointAt(0)!;
  if (cp <= 0x7f) return c;
  // Angka Unicode (Arab-Indic, Devanagari, ...) hadir dalam blok 10 berurutan; nilainya = selisih dari awal blok.
  let base = cp;
  while (DECIMAL_DIGIT.test(String.fromCodePoint(base - 1))) base--;
  return String((cp - base) % 10);
}

/**
 * Normalisasi sebelum pemindaian: NFKC (angka lebar-penuh, matematis, dst.), buang karakter format \p{Cf}
 * (ZWSP, ZWJ, soft hyphen, tanda arah), angka Unicode lain → ASCII. `map` mengembalikan posisi ke teks asli.
 */
export function normalizeForScan(text: string): NormalizedText {
  let out = '';
  const map: NormalizedText['map'] = [];
  let i = 0;
  for (const ch of text) {
    const end = i + ch.length;
    if (!FORMAT_CHAR.test(ch)) {
      for (const c of ch.normalize('NFKC')) {
        if (FORMAT_CHAR.test(c)) continue;
        const n = DECIMAL_DIGIT.test(c) ? asciiDigit(c) : c;
        out += n;
        for (let k = 0; k < n.length; k++) map.push({ start: i, end });
      }
    }
    i = end;
  }
  return { text: out, map };
}

const digitsOf = (s: string) => s.replace(/\D/g, '');

export type PiiKind = 'nik' | 'phone' | 'email';
export type PiiSpan = { kind: PiiKind; start: number; end: number; value: string };

/**
 * Lokasi tiap PII di dalam teks ASLI (untuk penggantian placeholder). Pemindaian berjalan pada teks ternormalisasi
 * sehingga NIK/HP yang diberi pemisah, angka lebar-penuh/Arab-Indic, atau sisipan ZWSP tetap tertangkap.
 * NIK 16 digit yang tidak lolos struktur NIK tidak ikut dilaporkan (resi, nominal biasa tidak terganti).
 * Dengan `kodeKabKota`, deretan 12 digit yang bersama kode itu membentuk NIK valid juga dianggap NIK.
 * Rentang tidak tumpang tindih; urut menurut posisi.
 */
export function findPiiSpans(text: string, opts: PiiOptions = {}): PiiSpan[] {
  const norm = normalizeForScan(text);
  const spans: PiiSpan[] = [];
  const push = (kind: PiiKind, m: RegExpMatchArray) => {
    if (m.index === undefined) return;
    const start = norm.map[m.index]!.start;
    const end = norm.map[m.index + m[0].length - 1]!.end;
    spans.push({ kind, start, end, value: text.slice(start, end) });
  };
  for (const m of norm.text.matchAll(NIK_RE)) if (isNikLike(digitsOf(m[0]))) push('nik', m);
  const kode = opts.kodeKabKota;
  if (kode && /^\d{4}$/.test(kode)) {
    for (const m of norm.text.matchAll(DUA_BELAS_RE)) if (isNikLike(kode + digitsOf(m[0]))) push('nik', m);
  }
  for (const m of norm.text.matchAll(PHONE_RE)) push('phone', m);
  for (const m of norm.text.matchAll(EMAIL_RE)) push('email', m);
  spans.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const out: PiiSpan[] = [];
  for (const sp of spans) {
    const last = out[out.length - 1];
    if (!last || sp.start >= last.end) out.push(sp);
  }
  return out;
}

export function containsNikLike(text: string, opts: PiiOptions = {}): boolean {
  return findPiiSpans(text, opts).some((s) => s.kind === 'nik');
}

export function containsPhone(text: string): boolean {
  return findPiiSpans(text).some((s) => s.kind === 'phone');
}

export function containsEmail(text: string): boolean {
  return findPiiSpans(text).some((s) => s.kind === 'email');
}

export function detectPii(text: string, opts: PiiOptions = {}): PiiKind[] {
  const kinds = new Set(findPiiSpans(text, opts).map((s) => s.kind));
  return (['nik', 'phone', 'email'] as const).filter((k) => kinds.has(k));
}
