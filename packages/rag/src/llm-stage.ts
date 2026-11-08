import { z } from 'zod';
import { findPlaceholders, hasMalformedPlaceholder, detectPii } from '@urusin/core';
import { isStopword, rawTokens } from './stem/stem.js';

/**
 * Antarmuka tahap berbantuan LLM. Paket ini TIDAK bergantung pada @urusin/llm saat runtime: pemanggil
 * menyuntikkan `JsonCall` (mis. dibangun dari `generateStructured` + provider gateway; di tes memakai
 * FakeProvider). Semua tahap gagal-aman: galat/timeout/anggaran habis -> urutan fusi dipertahankan.
 */
export type JsonRequest<T> = {
  /** Nama skema; [a-zA-Z0-9_-]. */
  name: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  signal?: AbortSignal | undefined;
};
export type JsonCall = <T>(req: JsonRequest<T>) => Promise<T>;

/** Kueri yang mengandung PII atau placeholder vault tidak boleh keluar ke LLM. */
export function containsSensitive(text: string): boolean {
  return detectPii(text).length > 0 || findPlaceholders(text).length > 0 || hasMalformedPlaceholder(text);
}

/** Jalankan `fn` dengan batas waktu; sinyal abort diteruskan. Melempar bila timeout. */
export async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      reject(new Error('timeout'));
    }, ms);
  });
  try {
    return await Promise.race([fn(ctrl.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Penulisan ulang kueri (opsional)
// ---------------------------------------------------------------------------

/** Mengembalikan istilah resmi tambahan untuk kueri (bukan kalimat). */
export type QueryRewriter = (query: string, signal?: AbortSignal) => Promise<string[]>;

const RewriteSchema = z.object({ istilah: z.array(z.string().max(60)).max(12) });

const REWRITE_SYSTEM =
  'Kamu membantu pencarian layanan publik Indonesia (kependudukan, Samsat, SKCK, SIM, BPJS, bansos, OSS). ' +
  'Ubah pertanyaan warga bergaya awam menjadi paling banyak 8 istilah resmi/baku pendek (huruf kecil) yang ' +
  'mungkin muncul di halaman resmi. Jangan menjawab pertanyaan. Balas hanya JSON {"istilah": [...]}.';

/** Bersihkan keluaran LLM: token huruf kecil, tanpa angka (cegah kebocoran PII), tanpa stopword, maks 12. */
export function sanitizeTerms(raw: readonly string[]): string[] {
  const out = new Set<string>();
  for (const phrase of raw)
    for (const t of rawTokens(phrase)) {
      const low = t.toLowerCase();
      if (/\d/.test(low) || low.length < 3 || isStopword(low)) continue;
      out.add(low);
      if (out.size >= 12) return [...out];
    }
  return [...out];
}

export function createLlmRewriter(json: JsonCall): QueryRewriter {
  return async (query, signal) => {
    const r = await json({
      name: 'perluas_kueri',
      system: REWRITE_SYSTEM,
      user: query,
      schema: RewriteSchema,
      signal,
    });
    return sanitizeTerms(r.istilah);
  };
}

export type RewriteResult = {
  terms: string[];
  status: 'applied' | 'fallback' | 'skipped';
};

export async function safeRewrite(
  query: string,
  rewriter: QueryRewriter,
  timeoutMs = 1500,
): Promise<RewriteResult> {
  if (containsSensitive(query)) return { terms: [], status: 'skipped' };
  try {
    const terms = sanitizeTerms(await withTimeout(timeoutMs, (signal) => rewriter(query, signal)));
    return { terms, status: terms.length ? 'applied' : 'fallback' };
  } catch {
    return { terms: [], status: 'fallback' };
  }
}
