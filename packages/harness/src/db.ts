import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';

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

/** Terapkan migrasi berversi (`migrations/*.sql`, `PRAGMA user_version`). Dipanggil saat buka DB. */
export function migrateHarness(db: Db): void {
  runMigrations(db);
}
