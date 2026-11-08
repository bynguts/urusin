import { findPiiSpans } from '@urusin/core';

/**
 * Lapis PII sebelum SETIAP panggilan embedding/rerank: NIK, nomor HP dan email diganti `[DATA]`
 * (kueri warga bisa memuatnya; teks korpus publik juga dilewatkan demi keamanan berlapis).
 */
export function redactForProvider(text: string): string {
  const spans = findPiiSpans(text);
  if (spans.length === 0) return text;
  let out = '';
  let at = 0;
  for (const s of spans) {
    out += text.slice(at, s.start) + '[DATA]';
    at = s.end;
  }
  return out + text.slice(at);
}
