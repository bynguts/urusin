import { isAllowedUrl } from './allowlist.js';
import type { Db } from './db.js';
import { buildChunkContextHeader } from './ingest/context.js';
import { ChunkSchema, type Chunk } from './schema.js';
import { stemText } from './stem/stem.js';

export class ChunkRejectedError extends Error {
  constructor(reason: string) {
    super(`Chunk ditolak: ${reason}`);
    this.name = 'ChunkRejectedError';
  }
}

/** Validasi (sourceRef, verifiedAt, origin resmi) lalu upsert; satu transaksi, semua atau tidak sama sekali. */
export function upsertChunks(db: Db, chunks: readonly unknown[]): number {
  const parsed: Chunk[] = chunks.map((c, i) => {
    const r = ChunkSchema.safeParse(c);
    if (!r.success) throw new ChunkRejectedError(`#${i} tidak sesuai skema`);
    if (!isAllowedUrl(r.data.sourceRef.url))
      throw new ChunkRejectedError(`#${i} origin di luar allowlist resmi`);
    return r.data;
  });
  const del = db.prepare('DELETE FROM chunks WHERE id = ?');
  const ins = db.prepare(
    'INSERT INTO chunks (id, judul, text, instansi, url, verified_at, kode_wilayah, layanan, ctx) VALUES (?,?,?,?,?,?,?,?,?)',
  );
  const insStem = db.prepare(
    'INSERT INTO chunks_stem_fts (rowid, judul, text, instansi, ctx) VALUES (?,?,?,?,?)',
  );
  db.transaction(() => {
    for (const c of parsed) {
      del.run(c.id);
      const ctx =
        c.contextHeader ??
        buildChunkContextHeader({
          judulHalaman: c.sourceRef.judul,
          instansi: c.sourceRef.instansi,
          layanan: c.layanan,
        });
      const info = ins.run(
        c.id,
        c.sourceRef.judul,
        c.text,
        c.sourceRef.instansi,
        c.sourceRef.url,
        c.verifiedAt,
        c.kodeWilayah ?? null,
        c.layanan ?? null,
        ctx,
      );
      insStem.run(
        info.lastInsertRowid,
        stemText(c.sourceRef.judul),
        stemText(c.text),
        stemText(c.sourceRef.instansi),
        stemText(ctx),
      );
    }
  })();
  return parsed.length;
}

export function countChunks(db: Db): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM chunks').get() as { n: number }).n;
}
