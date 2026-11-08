import { createHash } from 'node:crypto';
import type { Db } from '../db.js';
import { htmlToText } from './extract.js';

/** Hash isi teks ter-ekstrak (bukan HTML mentah) agar skrip/markup dinamis tidak dianggap perubahan. */
export function contentHash(body: string): string {
  return createHash('sha256').update(htmlToText(body)).digest('hex');
}

export const PERINGATAN_BERUBAH = 'sumber berubah sejak diverifikasi';

export type SourceStateInput = {
  etag: string | null;
  lastModified: string | null;
  hash: string;
  /** Waktu verifikasi/ingest (ISO). */
  at: string;
};

/** Dipanggil saat ingest: sumber baru saja diambil dan dicek, jadi `changed` direset. */
export function recordSourceState(db: Db, sourceId: string, s: SourceStateInput): void {
  db.prepare(
    `INSERT INTO source_state (source_id, etag, last_modified, content_hash, verified_at, checked_at, changed, changed_at)
     VALUES (?,?,?,?,?,?,0,NULL)
     ON CONFLICT(source_id) DO UPDATE SET etag=excluded.etag, last_modified=excluded.last_modified,
       content_hash=excluded.content_hash, verified_at=excluded.verified_at, checked_at=excluded.checked_at,
       changed=0, changed_at=NULL`,
  ).run(sourceId, s.etag, s.lastModified, s.hash, s.at, s.at);
}

export type SourceStateRow = {
  sourceId: string;
  etag: string | null;
  lastModified: string | null;
  contentHash: string;
  verifiedAt: string;
  checkedAt: string;
  changed: boolean;
  changedAt: string | null;
};

export function loadSourceStates(db: Db): SourceStateRow[] {
  return (
    db
      .prepare(
        `SELECT source_id, etag, last_modified, content_hash, verified_at, checked_at, changed, changed_at
         FROM source_state ORDER BY source_id`,
      )
      .all() as Record<string, string | number | null>[]
  ).map((r) => ({
    sourceId: r.source_id as string,
    etag: r.etag as string | null,
    lastModified: r.last_modified as string | null,
    contentHash: r.content_hash as string,
    verifiedAt: r.verified_at as string,
    checkedAt: r.checked_at as string,
    changed: r.changed === 1,
    changedAt: r.changed_at as string | null,
  }));
}

export type Freshness = {
  sources: { id: string; verifiedAt: string; ageDays: number; changed: boolean }[];
  /** Umur sumber tertua (hari sejak terakhir diverifikasi); null bila belum ada sumber. */
  oldestAgeDays: number | null;
  changed: string[];
};

/** Bahan halaman transparansi: umur verifikasi tiap sumber dan sumber yang berubah. */
export function sourceFreshness(db: Db, nowMs: number = Date.now()): Freshness {
  const sources = loadSourceStates(db).map((r) => ({
    id: r.sourceId,
    verifiedAt: r.verifiedAt,
    ageDays: Math.max(0, Math.floor((nowMs - Date.parse(r.verifiedAt)) / 86_400_000)),
    changed: r.changed,
  }));
  return {
    sources,
    oldestAgeDays: sources.length ? Math.max(...sources.map((s) => s.ageDays)) : null,
    changed: sources.filter((s) => s.changed).map((s) => s.id),
  };
}

/** Id sumber dari id chunk hasil ingest (`sumber#n`); null untuk chunk non-ingest. */
export const sourceIdOfChunk = (chunkId: string): string | null =>
  chunkId.includes('#') ? chunkId.slice(0, chunkId.indexOf('#')) : null;

export function changedSourceIds(db: Db): Set<string> {
  return new Set(
    (db.prepare('SELECT source_id FROM source_state WHERE changed = 1').all() as { source_id: string }[]).map(
      (r) => r.source_id,
    ),
  );
}
