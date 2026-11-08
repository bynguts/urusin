import type { Db } from '../db.js';
import { applyTransform, fitTransform, type FitOptions } from './transform.js';
import {
  loadActiveTransform,
  loadRawVectors,
  loadVectorEntries,
  putRawVector,
  putTransformedVector,
  rankVectors,
  saveActiveTransform,
  type Embedder,
  type VectorFilter,
} from './store.js';

const BATCH = 64;

export type EmbedAndFitResult = {
  chunks: number;
  embedded: number;
  version: number;
  mode: string;
  k: number;
};

/**
 * Setelah semua chunk di-embed: fit transformasi pada seluruh vektor mentah, simpan parameter aktif,
 * lalu tulis ulang vektor tertransformasi. Vektor mentah di-cache (hanya yang belum ada yang di-embed).
 * Ganti `model` membuang cache mentah.
 */
export async function embedAndFit(
  db: Db,
  embed: Embedder,
  opts: FitOptions & { model?: string | undefined },
): Promise<EmbedAndFitResult> {
  const chunks = db.prepare('SELECT id, judul, text FROM chunks ORDER BY id').all() as {
    id: string;
    judul: string;
    text: string;
  }[];
  if (chunks.length === 0) throw new Error('Tidak ada chunk untuk di-embed');
  const model = opts.model ?? null;
  const prev = loadActiveTransform(db);
  if (prev && prev.model !== model) db.prepare('DELETE FROM chunk_vectors').run();

  const have = new Set(loadRawVectors(db).map((r) => r.id));
  const todo = chunks.filter((c) => !have.has(c.id));
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const vecs = await embed(batch.map((c) => `${c.judul}\n${c.text}`));
    if (vecs.length !== batch.length) throw new Error('Jumlah embedding tidak sama dengan jumlah teks');
    db.transaction(() => batch.forEach((c, j) => putRawVector(db, c.id, vecs[j] as Float32Array)))();
  }

  const raw = loadRawVectors(db);
  const params = fitTransform(
    raw.map((r) => r.raw),
    opts,
  );
  const version = db.transaction(() => {
    const v = saveActiveTransform(db, params, model);
    for (const r of raw) putTransformedVector(db, r.id, applyTransform(params, r.raw));
    return v;
  })();
  return { chunks: chunks.length, embedded: todo.length, version, mode: params.mode, k: params.k };
}

/**
 * Leg vektor untuk satu kueri: terapkan transformasi aktif yang sama dengan dokumen, lalu urutkan.
 * Mengembalikan undefined (=> BM25 murni) bila embedding/vektor tidak tersedia atau gagal.
 */
export async function vectorIdsForQuery(
  db: Db,
  embed: Embedder | null | undefined,
  query: string,
  filter: VectorFilter = {},
  limit = 20,
  model?: string,
): Promise<string[] | undefined> {
  if (!embed) return undefined;
  const active = loadActiveTransform(db);
  if (!active) return undefined;
  // Vektor dokumen dibuat model lain: dimensi/ruang berbeda, skor tidak bermakna -> BM25 saja.
  if (model !== undefined && active.model !== model) return undefined;
  try {
    const [q] = await embed([query]);
    if (!q || q.length !== active.params.dim) return undefined;
    const ids = rankVectors(loadVectorEntries(db), applyTransform(active.params, q), filter, limit);
    return ids.length ? ids : undefined;
  } catch {
    return undefined;
  }
}
