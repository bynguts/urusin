import Database from 'better-sqlite3';

export type Db = Database.Database;

/** Skema: tabel chunks + indeks FTS5 external-content (bobot kolom lewat bm25()). */
export function openDb(path = ':memory:', opts: { readonly?: boolean } = {}): Db {
  const db = new Database(path, opts.readonly ? { readonly: true, fileMustExist: true } : {});
  if (!opts.readonly) {
    db.pragma('journal_mode = WAL');
    migrate(db);
  }
  return db;
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
      layanan TEXT
    );
    CREATE INDEX IF NOT EXISTS chunks_wilayah_idx ON chunks(kode_wilayah);
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      judul, text, instansi,
      content='chunks', content_rowid='rowid',
      tokenize='unicode61 remove_diacritics 2'
    );
    CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
      INSERT INTO chunks_fts(rowid, judul, text, instansi) VALUES (new.rowid, new.judul, new.text, new.instansi);
    END;
    CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, judul, text, instansi) VALUES ('delete', old.rowid, old.judul, old.text, old.instansi);
    END;
  `);
}
