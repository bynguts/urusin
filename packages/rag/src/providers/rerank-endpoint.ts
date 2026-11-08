import type { RerankEndpoint } from '../rerank.js';
import { createBreaker, type Breaker } from './breaker.js';
import { postJson, type HttpOpts } from './http.js';
import { redactForProvider } from './redact.js';

/** Batas waktu satu panggilan rerank; tanpa retry (anggaran latensi ketat), lalu urutan fusi dipakai. */
export const RERANK_TIMEOUT_MS = 3000;

export type RerankConfig = { baseUrl: string; apiKey: string; model: string };

/** Env: RERANK_BASE_URL, RERANK_API_KEY, RERANK_MODEL (kunci LLM tidak pernah dipakai ulang). null bila tidak lengkap. */
export function loadRerankConfig(env: Record<string, string | undefined> = process.env): RerankConfig | null {
  const baseUrl = env['RERANK_BASE_URL']?.trim();
  const apiKey = env['RERANK_API_KEY']?.trim();
  const model = env['RERANK_MODEL']?.trim();
  return baseUrl && apiKey && model ? { baseUrl, apiKey, model } : null;
}

type RerankResponse = {
  results?: { index: number; relevance_score: number }[];
  usage?: { total_tokens?: number };
};

/**
 * Endpoint rerank gaya Jina `/rerank`; kueri dan dokumen diredaksi PII sebelum keluar. Timeout 3 detik tanpa
 * retry dan pemutus sirkuit: galat apa pun membuat `rerankHits` memakai urutan fusi.
 */
export function createHttpRerankEndpoint(
  cfg: RerankConfig,
  http: Partial<HttpOpts> = {},
  breaker: Breaker = createBreaker(),
): RerankEndpoint {
  const call: RerankEndpoint['rerank'] = async (req) => {
    const json = (await postJson(
      { timeoutMs: RERANK_TIMEOUT_MS, maxRetries: 0, ...http, baseUrl: cfg.baseUrl, apiKey: cfg.apiKey },
      '/rerank',
      {
        model: cfg.model,
        query: redactForProvider(req.query),
        documents: req.documents.map((d) => redactForProvider(d.text)),
        top_n: req.documents.length,
        return_documents: false,
      },
    )) as RerankResponse;
    if (http.stats) http.stats.tokens += json.usage?.total_tokens ?? 0;
    return (json.results ?? []).flatMap((r) => {
      const d = req.documents[r.index];
      return d ? [{ id: d.id, score: r.relevance_score }] : [];
    });
  };
  return { rerank: (req, opts) => breaker.run(() => call(req, opts)) };
}
