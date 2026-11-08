import type { Db } from './db.js';
import { createHttpEmbedder, loadEmbedConfig, withEmbedCache } from './providers/embedder.js';
import { newStats, type ProviderStats } from './providers/http.js';
import type { Embedder } from './vector/store.js';

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
  const mk = (task: string | undefined, st: ProviderStats): Embedder => {
    const raw = createHttpEmbedder(cfg, task, { stats: st, fetch: opts.fetch });
    return opts.cache ? withEmbedCache(raw, opts.cache, { model: cfg.model, task }) : raw;
  };
  const embedQuery = mk(cfg.taskQuery, stats.query);
  const embed = mk(cfg.taskPassage, stats.passage);
  try {
    const [v] = await createHttpEmbedder(cfg, cfg.taskQuery, { fetch: opts.fetch })(['uji']);
    if (!v || v.length === 0) return null;
  } catch {
    return null;
  }
  return { embed, embedQuery, model: cfg.model, stats };
}
