import Database from 'better-sqlite3';
import { stemText } from './stem/stem.js';

export type Db = Database.Database;

/**
 * Skema: tabel chunks + dua indeks FTS5.
 * - `chunks_fts` (external-content): teks ASLI untuk pencocokan persis (judul, text, instansi, ctx).
 * - `chunks_stem_fts`: salinan ter-stem (stem diisi di JS saat ingest; FTS5 tak bisa tokenizer JS).
 * `ctx` = header konteks yang hanya diindeks, tidak ditampilkan.
 */
export function openDb(path = ':memory:', opts: { readonly?: boolean } = {}): Db {
  const db = new Database(path, opts.readonly ? { readonly: true, fileMustExist: true } : {});
  if (!opts.readonly) {
    db.pragma('journal_mode = WAL');
    migrate(db);
  }
  return db;
}

function hasColumn(db: Db, table: string, col: string): boolean {
  return (db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(col) ?? null) !== null;
}

export function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      judul TEXT NOT NULL,
      text TEXT NOT NULL,
      instansi TEXT NOT NULL,
      url TEXT NOT NULL,
      verified_at TEXT,
      kode_wilayah TEXT,
      layanan TEXT,
      ctx TEXT
    );
    CREATE INDEX IF NOT EXISTS chunks_wilayah_idx ON chunks(kode_wilayah);
  `);
  if (!hasColumn(db, 'chunks', 'ctx')) db.exec('ALTER TABLE chunks ADD COLUMN ctx TEXT');
  // DB lama: chunks_fts tanpa kolom ctx -> bangun ulang indeks dari tabel chunks.
  const oldFts = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'chunks_fts'").get() !== undefined;
  const rebuild = oldFts && !hasColumn(db, 'chunks_fts', 'ctx');
  if (rebuild) {
    db.exec(`
      DROP TRIGGER IF EXISTS chunks_ai;
      DROP TRIGGER IF EXISTS chunks_ad;
      DROP TABLE chunks_fts;
    `);
  }
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      judul, text, instansi, ctx,
      content='chunks', content_rowid='rowid',
      tokenize='unicode61 remove_diacritics 2'
    );
    CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
      INSERT INTO chunks_fts(rowid, judul, text, instansi, ctx) VALUES (new.rowid, new.judul, new.text, new.instansi, new.ctx);
    END;
    CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, judul, text, instansi, ctx) VALUES ('delete', old.rowid, old.judul, old.text, old.instansi, old.ctx);
      DELETE FROM chunks_stem_fts WHERE rowid = old.rowid;
    END;
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_stem_fts USING fts5(
      judul, text, instansi, ctx,
      tokenize='unicode61 remove_diacritics 2'
    );
    -- Status verifikasi sumber (rag:verify): validator HTTP + hash isi teks ter-ekstrak.
    CREATE TABLE IF NOT EXISTS source_state (
      source_id TEXT PRIMARY KEY,
      etag TEXT,
      last_modified TEXT,
      content_hash TEXT NOT NULL,
      verified_at TEXT NOT NULL,
      checked_at TEXT NOT NULL,
      changed INTEGER NOT NULL DEFAULT 0,
      changed_at TEXT
    );
    -- Vektor (opsional): raw = keluaran embedding, vec = hasil transformasi aktif. Kosong = mode BM25.
    CREATE TABLE IF NOT EXISTS chunk_vectors (
      id TEXT PRIMARY KEY,
      raw BLOB NOT NULL,
      vec BLOB
    );
    CREATE TRIGGER IF NOT EXISTS chunks_vec_ad AFTER DELETE ON chunks BEGIN
      DELETE FROM chunk_vectors WHERE id = old.id;
    END;
    -- Satu baris aktif (id = 1); version naik tiap fit ulang.
    CREATE TABLE IF NOT EXISTS vector_transform (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL,
      model TEXT,
      params TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  if (rebuild) db.exec("INSERT INTO chunks_fts(chunks_fts) VALUES ('rebuild')");
  backfillStem(db);
}

/** Isi indeks ter-stem untuk baris yang belum punya (DB lama atau ditulis tanpa lewat upsertChunks). */
function backfillStem(db: Db): void {
  const rows = db
    .prepare(
      `SELECT rowid, judul, text, instansi, ctx FROM chunks
       WHERE rowid NOT IN (SELECT rowid FROM chunks_stem_fts)`,
    )
    .all() as { rowid: number; judul: string; text: string; instansi: string; ctx: string | null }[];
  if (rows.length === 0) return;
  const ins = db.prepare('INSERT INTO chunks_stem_fts(rowid, judul, text, instansi, ctx) VALUES (?,?,?,?,?)');
  db.transaction(() => {
    for (const r of rows)
      ins.run(r.rowid, stemText(r.judul), stemText(r.text), stemText(r.instansi), stemText(r.ctx ?? ''));
  })();
}
