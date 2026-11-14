import type { Db } from './db.js';
import { QUERY_EMBED_TIMEOUT_MS } from './embedder.js';
import { createBreaker } from './providers/breaker.js';
import { createHttpEmbedder, loadEmbedConfig } from './providers/embedder.js';
import type { FetchFn } from './providers/http.js';
import {
  createHttpRerankEndpoint,
  loadRerankConfig,
  RERANK_TIMEOUT_MS,
} from './providers/rerank-endpoint.js';
import type { RerankDeps } from './rerank.js';
import {
  CariPengetahuanInputSchema,
  type CariPengetahuanInput,
  type CariPengetahuanOutput,
} from './schema.js';
import { cariPengetahuanTool } from './tool.js';
import { vectorIdsForQuery } from './vector/pipeline.js';
import type { Embedder } from './vector/store.js';
import { loadActiveTransform } from './vector/store.js';

/** Kemampuan pencarian yang aktif (dilaporkan health dan /api/kemampuan). */
export type RagSearchInfo = {
  /** Leg vektor aktif: konfigurasi embedding lengkap DAN model sama dengan vektor dokumen di DB. */
  vektor: boolean;
  rerank: boolean;
  embedModel: string | null;
  rerankModel: string | null;
};

export type RagSearcher = {
  info: RagSearchInfo;
  /** Jalur produksi: BM25 stem + glosarium + RRF vektor + rerank endpoint + gerbang abstain (DEFAULT_PIPELINE). */
  search(input: CariPengetahuanInput): Promise<CariPengetahuanOutput>;
};

/**
 * Pencari RAG produksi untuk agen (dan eval jalur agen). Kueri di-embed dengan batas 2 detik tanpa retry di balik
 * pemutus sirkuit; rerank lewat endpoint (env RERANK_*) dengan batas 3 detik dan pemutus sirkuitnya sendiri. Teks
 * diredaksi PII sebelum keluar, dan HTTP lewat egress server (fetch bawaan providers/http). Kegagalan apa pun
 * jatuh ke BM25 (leg vektor kosong) atau urutan fusi (rerank `fallback`), tidak pernah melempar ke agen.
 */
export function createRagSearcher(
  db: Db,
  env: Record<string, string | undefined> = process.env,
  opts: { fetch?: FetchFn | undefined } = {},
): RagSearcher {
  const embedCfg = loadEmbedConfig(env);
  const active = loadActiveTransform(db);
  let embedQuery: Embedder | undefined;
  if (embedCfg && active && active.model === embedCfg.model) {
    const breaker = createBreaker();
    const raw = createHttpEmbedder(
      embedCfg,
      embedCfg.taskQuery,
      { timeoutMs: QUERY_EMBED_TIMEOUT_MS, maxRetries: 0, fetch: opts.fetch },
      embedCfg.prefixQuery,
    );
    embedQuery = (texts) => breaker.run(() => raw(texts));
  }
  const rrCfg = loadRerankConfig(env);
  const rerank: RerankDeps | undefined = rrCfg
    ? { endpoint: createHttpRerankEndpoint(rrCfg, { fetch: opts.fetch }), timeoutMs: RERANK_TIMEOUT_MS }
    : undefined;
  // Gerbang abstain dibaca dari `env` yang sama (bukan process.env global) agar eval jalur agen = produksi.
  const num = (v: string | undefined) => (v?.trim() ? Number(v) : NaN);
  const floor = num(env['RAG_ABSTAIN_MIN_RERANK_SCORE']);
  const cov = num(env['RAG_ABSTAIN_MIN_COVERAGE']);
  const gate = {
    minRerankScore: Number.isFinite(floor) ? floor : undefined,
    minCoverage: Number.isFinite(cov) && cov >= 0 && cov <= 1 ? cov : undefined,
  };

  return {
    info: {
      vektor: embedQuery !== undefined,
      rerank: rerank !== undefined,
      embedModel: embedQuery ? (embedCfg?.model ?? null) : null,
      rerankModel: rrCfg?.model ?? null,
    },
    async search(raw) {
      const input = CariPengetahuanInputSchema.parse(raw);
      const vectorIds = await vectorIdsForQuery(
        db,
        embedQuery,
        input.query,
        { kodeKabKota: input.kodeKabKota, layanan: input.layanan },
        20,
        embedCfg?.model,
      );
      return cariPengetahuanTool.executeAsync(db, input, { vectorIds, rerank, ...gate });
    },
  };
}
