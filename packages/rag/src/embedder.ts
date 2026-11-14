import type { Db } from './db.js';
import { createBreaker } from './providers/breaker.js';
import { createHttpEmbedder, loadEmbedConfig, withEmbedCache } from './providers/embedder.js';
import { newStats, type ProviderStats } from './providers/http.js';
import type { Embedder } from './vector/store.js';

export const QUERY_EMBED_TIMEOUT_MS = 2000;

export type RealEmbedder = {
  /** Embedder dokumen (task passage). */
  embed: Embedder;
  /** Embedder kueri (task query); sama dengan `embed` bila task tidak dibedakan. */
  embedQuery: Embedder;
  model: string;
  /** Statistik latensi/token panggilan kueri dan dokumen (sebelum cache). */
  stats: { query: ProviderStats; passage: ProviderStats };
};

/**
 * Embedder nyata dari env LLM_EMBED_* (lihat `loadEmbedConfig`), hanya bila konfigurasi lengkap dan satu
 * panggilan uji berhasil. Selain itu null => pemanggil tetap BM25-saja. `cache` (opsional) menyimpan vektor per
 * (model, task, hash teks). Sengaja tidak diekspor dari index.ts.
 */
export async function loadRealEmbedder(
  env: Record<string, string | undefined> = process.env,
  opts: { cache?: Db | undefined; fetch?: import('./providers/http.js').FetchFn | undefined } = {},
): Promise<RealEmbedder | null> {
  const cfg = loadEmbedConfig(env);
  if (!cfg) return null;
  const stats = { query: newStats(), passage: newStats() };
  const mk = (
    task: string | undefined,
    prefix: string | undefined,
    st: ProviderStats,
    http: { timeoutMs: number; maxRetries: number },
  ): Embedder => {
    const raw = createHttpEmbedder(cfg, task, { stats: st, fetch: opts.fetch, ...http }, prefix);
    // Awalan ikut kunci cache: teks sama dengan awalan berbeda menghasilkan vektor berbeda.
    const key = prefix ? `${task ?? ''}|${prefix}` : task;
    return opts.cache ? withEmbedCache(raw, opts.cache, { model: cfg.model, task: key }) : raw;
  };
  // Kueri warga: batas 2 detik tanpa retry + pemutus sirkuit (jatuh ke BM25); dokumen (ingest) boleh lebih lama.
  const breaker = createBreaker();
  const q = mk(cfg.taskQuery, cfg.prefixQuery, stats.query, {
    timeoutMs: QUERY_EMBED_TIMEOUT_MS,
    maxRetries: 0,
  });
  const embedQuery: Embedder = (texts) => breaker.run(() => q(texts));
  // 120 detik: sidecar CPU (llama.cpp, 2 thread) butuh ~40 detik untuk 64 chunk panjang (diukur 2026-11-14).
  const embed = mk(cfg.taskPassage, cfg.prefixPassage, stats.passage, { timeoutMs: 120_000, maxRetries: 2 });
  try {
    const [v] = await createHttpEmbedder(cfg, cfg.taskQuery, { fetch: opts.fetch }, cfg.prefixQuery)(['uji']);
    if (!v || v.length === 0) return null;
  } catch {
    return null;
  }
  return { embed, embedQuery, model: cfg.model, stats };
}
