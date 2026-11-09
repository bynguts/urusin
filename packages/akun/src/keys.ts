import { hkdfSync } from 'node:crypto';

/**
 * Turunan kunci dari URUSIN_PII_KEY (base64, ≥ 32 byte) dengan label HKDF terpisah per kegunaan, sehingga
 * kunci HMAC placeholder dan KEK vault tidak pernah sama walau berasal dari satu rahasia:
 * - `urusin/kek/v1`: KEK pembungkus DEK vault;
 * - `urusin/placeholder-hmac/v1`: kunci HMAC peta placeholder PII (store harness).
 * Kehilangan URUSIN_PII_KEY = semua vault tidak terbaca (escrow: deploy/runbook.md).
 */
export const LABEL_KEK = 'urusin/kek/v1';
export const LABEL_PLACEHOLDER_HMAC = 'urusin/placeholder-hmac/v1';

export function bacaPiiKey(piiKeyBase64: string): Buffer {
  const ikm = Buffer.from(piiKeyBase64.trim(), 'base64');
  if (ikm.length < 32) throw new Error('URUSIN_PII_KEY terlalu pendek: butuh base64 dari minimal 32 byte');
  return ikm;
}

export function turunkanKunci(piiKeyBase64: string, label: string): Buffer {
  return Buffer.from(hkdfSync('sha256', bacaPiiKey(piiKeyBase64), Buffer.alloc(0), label, 32));
}

/** KEK vault (32 byte). */
export const deriveKek = (piiKeyBase64: string): Buffer => turunkanKunci(piiKeyBase64, LABEL_KEK);

/** Kunci HMAC placeholder (hex, untuk `StoreOptions.piiKey`). */
export const kunciPlaceholderHmac = (piiKeyBase64: string): string =>
  turunkanKunci(piiKeyBase64, LABEL_PLACEHOLDER_HMAC).toString('hex');
