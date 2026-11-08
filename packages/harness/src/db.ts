import Database from 'better-sqlite3';

export type Db = Database.Database;

/**
 * SQLite harness (better-sqlite3, WAL). SQL polos dengan helper bertipe di `store.ts`
 * (Drizzle tidak dipakai di repo ini). Tidak ada kolom PII: hanya placeholder dan referensi vault.
 */
export function openHarnessDb(path = ':memory:'): Db {
  const db = new Database(path);
  if (path !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrateHarness(db);
  return db;
}

export const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS urusan (
    id TEXT PRIMARY KEY,
    version INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL,
    jenis TEXT,
    kode_kabkota TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    turn_count INTEGER NOT NULL DEFAULT 0,
    tokens_in INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    cost_idr REAL NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS turns (
    id TEXT PRIMARY KEY,
    urusan_id TEXT NOT NULL REFERENCES urusan(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running','done','timeout','error','aborted')),
    user_text TEXT NOT NULL,
    messages TEXT NOT NULL DEFAULT '[]',
    started_at TEXT NOT NULL,
    ended_at TEXT,
    tokens_in INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    cost_idr REAL NOT NULL DEFAULT 0,
    degraded INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    owner_instance TEXT,
    lease_until TEXT,
    UNIQUE (urusan_id, seq)
  );
  -- Satu turn berjalan per urusan: klaim kedua gagal di level database.
  CREATE UNIQUE INDEX IF NOT EXISTS turns_one_running ON turns(urusan_id) WHERE status = 'running';

  -- Audit append-only: rantai hash per urusan; juga sumber replay SSE (Last-Event-ID = seq).
  CREATE TABLE IF NOT EXISTS events (
    urusan_id TEXT NOT NULL REFERENCES urusan(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    at TEXT NOT NULL,
    prev_hash TEXT NOT NULL,
    hash TEXT NOT NULL,
    PRIMARY KEY (urusan_id, seq)
  );

  CREATE TABLE IF NOT EXISTS spans (
    id TEXT PRIMARY KEY,
    urusan_id TEXT NOT NULL REFERENCES urusan(id) ON DELETE CASCADE,
    turn_id TEXT,
    parent_id TEXT,
    name TEXT NOT NULL,
    operation TEXT NOT NULL,
    started_at TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ok','error')),
    error_code TEXT,
    model TEXT,
    tokens_in INTEGER,
    tokens_out INTEGER,
    structured_mode TEXT,
    cost_idr REAL,
    degraded INTEGER NOT NULL DEFAULT 0,
    attrs TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX IF NOT EXISTS spans_urusan_idx ON spans(urusan_id, started_at);
  CREATE INDEX IF NOT EXISTS spans_started_idx ON spans(started_at);

  CREATE TABLE IF NOT EXISTS confirmations (
    id TEXT PRIMARY KEY,
    urusan_id TEXT NOT NULL REFERENCES urusan(id) ON DELETE CASCADE,
    tool TEXT NOT NULL,
    params_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );

  -- Hasil eksekusi yang dilaporkan ekstensi: satu hasil per executionId (laporan ganda = 409).
  CREATE TABLE IF NOT EXISTS execution_results (
    execution_id TEXT PRIMARY KEY,
    urusan_id TEXT NOT NULL REFERENCES urusan(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    at TEXT NOT NULL
  );

  -- Potongan korpus resmi yang pernah dikembalikan tool dalam urusan ini: satu-satunya refId yang sah sebagai kutipan.
  CREATE TABLE IF NOT EXISTS retrieved_chunks (
    urusan_id TEXT NOT NULL REFERENCES urusan(id) ON DELETE CASCADE,
    ref_id TEXT NOT NULL,
    text TEXT NOT NULL,
    url TEXT NOT NULL,
    judul TEXT NOT NULL,
    instansi TEXT NOT NULL,
    verified_at TEXT,
    PRIMARY KEY (urusan_id, ref_id)
  );

  CREATE TABLE IF NOT EXISTS tombstones (
    urusan_hash TEXT PRIMARY KEY,
    head_hash TEXT NOT NULL,
    deleted_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS daily_usage (
    day TEXT PRIMARY KEY,
    requests INTEGER NOT NULL DEFAULT 0,
    degraded_requests INTEGER NOT NULL DEFAULT 0,
    tokens_in INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    cost_idr REAL NOT NULL DEFAULT 0
  );
`;

export function migrateHarness(db: Db): void {
  db.exec(SCHEMA_SQL);
  // Basis data lama (sebelum lease turn) tidak punya kolom ini; tambahkan tanpa menghapus data.
  const cols = (db.prepare('PRAGMA table_info(turns)').all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes('owner_instance')) db.exec('ALTER TABLE turns ADD COLUMN owner_instance TEXT');
  if (!cols.includes('lease_until')) db.exec('ALTER TABLE turns ADD COLUMN lease_until TEXT');
}
