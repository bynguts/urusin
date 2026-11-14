import { createHash } from 'node:crypto';
import type { Db } from '../db.js';
import type { Embedder } from '../vector/store.js';
import { postJson, type HttpOpts } from './http.js';
import { redactForProvider } from './redact.js';

export type EmbedConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Nilai `task` (mis. Jina `retrieval.query`); kosong = tidak dikirim. */
  taskQuery?: string | undefined;
  taskPassage?: string | undefined;
  /**
   * Awalan teks kueri/dokumen untuk model yang task-nya lewat teks, bukan field `task` (mis. EmbeddingGemma di
   * sidecar llama.cpp: `task: search result | query:` / `title: none | text:`). Disambung dengan satu spasi.
   */
  prefixQuery?: string | undefined;
  prefixPassage?: string | undefined;
  /** Batas karakter per teks (setelah awalan); sidecar llama.cpp menolak input di atas ukuran batch-nya. */
  maxChars?: number | undefined;
};

/**
 * Konfigurasi embedding dari env: LLM_EMBED_BASE_URL (bawaan LLM_BASE_URL), LLM_EMBED_API_KEY,
 * LLM_EMBED_MODEL, LLM_EMBED_TASK_QUERY, LLM_EMBED_TASK_PASSAGE, LLM_EMBED_PREFIX_QUERY,
 * LLM_EMBED_PREFIX_PASSAGE, LLM_EMBED_MAX_CHARS. LLM_API_KEY hanya dipakai bila base URL juga bawaan (kunci
 * tidak bocor ke penyedia lain). null bila tidak lengkap.
 */
export function loadEmbedConfig(env: Record<string, string | undefined> = process.env): EmbedConfig | null {
  const model = env['LLM_EMBED_MODEL']?.trim();
  const own = env['LLM_EMBED_BASE_URL']?.trim();
  const baseUrl = own || env['LLM_BASE_URL']?.trim();
  const apiKey = env['LLM_EMBED_API_KEY']?.trim() || (own ? undefined : env['LLM_API_KEY']?.trim());
  if (!model || !baseUrl || !apiKey) return null;
  const maxChars = Number(env['LLM_EMBED_MAX_CHARS']);
  return {
    baseUrl,
    apiKey,
    model,
    taskQuery: env['LLM_EMBED_TASK_QUERY']?.trim() || undefined,
    taskPassage: env['LLM_EMBED_TASK_PASSAGE']?.trim() || undefined,
    prefixQuery: env['LLM_EMBED_PREFIX_QUERY']?.trim() || undefined,
    prefixPassage: env['LLM_EMBED_PREFIX_PASSAGE']?.trim() || undefined,
    maxChars: Number.isInteger(maxChars) && maxChars > 0 ? maxChars : undefined,
  };
}

const BATCH = 64;

/**
 * Embedder HTTP (kompatibel OpenAI /embeddings; `task` dikirim hanya bila diisi). Teks diredaksi PII, lalu diberi
 * `prefix` (bila ada) dan dipotong ke `cfg.maxChars` (bila ada).
 */
export function createHttpEmbedder(
  cfg: Pick<EmbedConfig, 'baseUrl' | 'apiKey' | 'model' | 'maxChars'>,
  task: string | undefined,
  http: Partial<HttpOpts> = {},
  prefix?: string,
): Embedder {
  const prep = (t: string) => {
    const s = prefix ? `${prefix} ${redactForProvider(t)}` : redactForProvider(t);
    return cfg.maxChars ? s.slice(0, cfg.maxChars) : s;
  };
  return async (texts) => {
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      const batch = texts.slice(i, i + BATCH).map(prep);
      const json = (await postJson({ ...http, baseUrl: cfg.baseUrl, apiKey: cfg.apiKey }, '/embeddings', {
        model: cfg.model,
        input: batch,
        ...(task ? { task } : {}),
      })) as { data?: { index?: number; embedding: number[] }[]; usage?: { total_tokens?: number } };
      const data = [...(json.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      if (data.length !== batch.length) throw new Error('jumlah embedding tidak cocok');
      if (http.stats) http.stats.tokens += json.usage?.total_tokens ?? 0;
      for (const d of data) out.push(Float32Array.from(d.embedding));
    }
    return out;
  };
}

const hashText = (t: string) => createHash('sha256').update(t).digest('hex');

/**
 * Cache embedding per (model, task, hash teks) di SQLite: teks yang tak berubah tidak di-embed ulang.
 * `db` boleh berkas terpisah (mis. .cache/embed-cache.db); tabel dibuat bila belum ada.
 */
export function withEmbedCache(
  embed: Embedder,
  db: Db,
  key: { model: string; task: string | undefined },
): Embedder {
  db.exec(
    `CREATE TABLE IF NOT EXISTS embed_cache (
       model TEXT NOT NULL, task TEXT NOT NULL, hash TEXT NOT NULL, vec BLOB NOT NULL,
       PRIMARY KEY (model, task, hash)
     ) WITHOUT ROWID`,
  );
  const task = key.task ?? '';
  const get = db.prepare('SELECT vec FROM embed_cache WHERE model = ? AND task = ? AND hash = ?');
  const put = db.prepare('INSERT OR REPLACE INTO embed_cache (model, task, hash, vec) VALUES (?, ?, ?, ?)');
  return async (texts) => {
    const hashes = texts.map(hashText);
    const out: (Float32Array | undefined)[] = hashes.map((h) => {
      const row = get.get(key.model, task, h) as { vec: Buffer } | undefined;
      return row
        ? new Float32Array(row.vec.buffer.slice(row.vec.byteOffset, row.vec.byteOffset + row.vec.byteLength))
        : undefined;
    });
    const missing = out.flatMap((v, i) => (v ? [] : [i]));
    if (missing.length) {
      const fresh = await embed(missing.map((i) => texts[i] as string));
      missing.forEach((idx, j) => {
        const v = fresh[j] as Float32Array;
        out[idx] = v;
        put.run(key.model, task, hashes[idx], Buffer.from(v.buffer, v.byteOffset, v.byteLength));
      });
    }
    return out as Float32Array[];
  };
}
