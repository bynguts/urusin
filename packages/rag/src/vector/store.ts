import type { Db } from '../db.js';
import { deserializeTransform, serializeTransform, type TransformParams } from './transform.js';

export type Embedder = (texts: string[]) => Promise<Float32Array[]>;

export type ActiveTransform = { version: number; model: string | null; params: TransformParams };

const toBlob = (v: Float32Array): Buffer => Buffer.from(v.buffer, v.byteOffset, v.byteLength);
const fromBlob = (b: Buffer): Float32Array =>
  new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

export function loadActiveTransform(db: Db): ActiveTransform | null {
  const row = db.prepare('SELECT version, model, params FROM vector_transform WHERE id = 1').get() as
    { version: number; model: string | null; params: string } | undefined;
  return row ? { version: row.version, model: row.model, params: deserializeTransform(row.params) } : null;
}

export function saveActiveTransform(
  db: Db,
  params: TransformParams,
  model: string | null,
  now = new Date(),
): number {
  const prev = db.prepare('SELECT version FROM vector_transform WHERE id = 1').get() as
    { version: number } | undefined;
  const version = (prev?.version ?? 0) + 1;
  db.prepare(
    `INSERT INTO vector_transform (id, version, model, params, updated_at) VALUES (1, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET version = excluded.version, model = excluded.model,
       params = excluded.params, updated_at = excluded.updated_at`,
  ).run(version, model, serializeTransform(params), now.toISOString());
  return version;
}

export function putRawVector(db: Db, id: string, raw: Float32Array): void {
  db.prepare(
    'INSERT INTO chunk_vectors (id, raw, vec) VALUES (?, ?, NULL) ON CONFLICT(id) DO UPDATE SET raw = excluded.raw, vec = NULL',
  ).run(id, toBlob(raw));
}

export function putTransformedVector(db: Db, id: string, vec: Float32Array): void {
  db.prepare('UPDATE chunk_vectors SET vec = ? WHERE id = ?').run(toBlob(vec), id);
}

export function loadRawVectors(db: Db): { id: string; raw: Float32Array }[] {
  const rows = db.prepare('SELECT id, raw FROM chunk_vectors ORDER BY id').all() as {
    id: string;
    raw: Buffer;
  }[];
  return rows.map((r) => ({ id: r.id, raw: fromBlob(r.raw) }));
}

export function countVectors(db: Db): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM chunk_vectors WHERE vec IS NOT NULL').get() as { n: number })
    .n;
}

export type VectorEntry = {
  id: string;
  kodeWilayah: string | null;
  layanan: string | null;
  vec: Float32Array;
};

/** Muat vektor tertransformasi beserta metadata filter. */
export function loadVectorEntries(db: Db): VectorEntry[] {
  const rows = db
    .prepare(
      `SELECT v.id AS id, v.vec AS vec, c.kode_wilayah AS kw, c.layanan AS layanan
       FROM chunk_vectors v JOIN chunks c ON c.id = v.id WHERE v.vec IS NOT NULL`,
    )
    .all() as { id: string; vec: Buffer; kw: string | null; layanan: string | null }[];
  return rows.map((r) => ({ id: r.id, kodeWilayah: r.kw, layanan: r.layanan, vec: fromBlob(r.vec) }));
}

export type VectorFilter = { kodeKabKota?: string | undefined; layanan?: string | undefined };

/** Brute-force cosine (vektor sudah ter-L2-normalisasi => dot). Filter wilayah sama dengan BM25. */
export function rankVectors(
  entries: readonly VectorEntry[],
  query: Float32Array,
  filter: VectorFilter = {},
  limit = 20,
): string[] {
  const wilayah = filter.kodeKabKota ? [filter.kodeKabKota, filter.kodeKabKota.slice(0, 2)] : [];
  const scored: { id: string; s: number }[] = [];
  for (const e of entries) {
    if (e.kodeWilayah !== null && !wilayah.includes(e.kodeWilayah)) continue;
    if (filter.layanan && e.layanan !== filter.layanan) continue;
    if (e.vec.length !== query.length) continue;
    let s = 0;
    for (let i = 0; i < query.length; i++) s += (e.vec[i] as number) * (query[i] as number);
    scored.push({ id: e.id, s });
  }
  scored.sort((a, b) => b.s - a.s || a.id.localeCompare(b.id));
  return scored.slice(0, limit).map((x) => x.id);
}
