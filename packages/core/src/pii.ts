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

const SIXTEEN_DIGITS_RE = /(?<!\d)\d{16}(?!\d)/g;
const PHONE_RE = /(?<![\w+])(?:\+62|62|0)[\s.-]?8[1-9](?:[\s.-]?\d){6,10}(?!\d)/;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;

/** NIK: PP KK CC DD MM YY NNNN; DD 01-31 (laki-laki) atau 41-71 (perempuan), MM 01-12. */
export function isNikLike(digits: string): boolean {
  if (!/^\d{16}$/.test(digits)) return false;
  if (!PROVINCE_CODES.has(digits.slice(0, 2))) return false;
  const day = Number(digits.slice(6, 8));
  const month = Number(digits.slice(8, 10));
  const validDay = (day >= 1 && day <= 31) || (day >= 41 && day <= 71);
  return validDay && month >= 1 && month <= 12;
}

// NIK yang ditulis berkelompok: 4-4-4-4 atau 6-6-4 dengan pemisah spasi/titik/strip.
const GROUPED_NIK_RE = /(?<!\d)(?:\d{4}[\s.-]\d{4}[\s.-]\d{4}[\s.-]\d{4}|\d{6}[\s.-]\d{6}[\s.-]\d{4})(?!\d)/g;

export function containsNikLike(text: string): boolean {
  for (const m of text.matchAll(SIXTEEN_DIGITS_RE)) if (isNikLike(m[0])) return true;
  for (const m of text.matchAll(GROUPED_NIK_RE)) if (isNikLike(m[0].replace(/\D/g, ''))) return true;
  return false;
}

export function containsPhone(text: string): boolean {
  return PHONE_RE.test(text);
}

export function containsEmail(text: string): boolean {
  return EMAIL_RE.test(text);
}

export type PiiKind = 'nik' | 'phone' | 'email';

export function detectPii(text: string): PiiKind[] {
  const kinds: PiiKind[] = [];
  if (containsNikLike(text)) kinds.push('nik');
  if (containsPhone(text)) kinds.push('phone');
  if (containsEmail(text)) kinds.push('email');
  return kinds;
}
