import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './db.js';

/** Folder `migrations/` ada satu tingkat di atas `src/` dan `dist/`. */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

export type Migration = { version: number; name: string; sql: string };

const NAME = /^(\d{4})_([a-z0-9_]+)\.sql$/;

/** Baca migrasi berurut (`0001_nama.sql`, ...). Nomor harus berurutan tanpa lompatan agar `user_version` bermakna. */
export function loadMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  const list = readdirSync(dir)
    .map((f) => ({ f, m: NAME.exec(f) }))
    .filter((x): x is { f: string; m: RegExpExecArray } => x.m !== null)
    .map(({ f, m }) => ({ version: Number(m[1]), name: m[2]!, sql: readFileSync(join(dir, f), 'utf8') }))
    .sort((a, b) => a.version - b.version);
  list.forEach((m, i) => {
    if (m.version !== i + 1)
      throw new Error(`migrasi harus berurutan mulai 0001; ditemukan ${m.version} di posisi ${i + 1}`);
  });
  return list;
}

/** Basis data sebelum migrasi berversi (skema inline lama): lengkapi kolom lease agar 0001 yang `IF NOT EXISTS` setara. */
function upgradeLegacy(db: Db): void {
  const turns = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'turns'").get();
  if (!turns) return;
  const cols = (db.prepare('PRAGMA table_info(turns)').all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes('owner_instance')) db.exec('ALTER TABLE turns ADD COLUMN owner_instance TEXT');
  if (!cols.includes('lease_until')) db.exec('ALTER TABLE turns ADD COLUMN lease_until TEXT');
}

export function schemaVersion(db: Db): number {
  return db.pragma('user_version', { simple: true }) as number;
}

/**
 * Terapkan migrasi yang belum jalan. Aman dipanggil berulang dan dari beberapa proses sekaligus: tiap migrasi
 * berjalan dalam satu transaksi `BEGIN IMMEDIATE` yang memeriksa ulang `user_version` di dalamnya, sehingga
 * yang kalah berebut menjadi no-op. Mengembalikan versi akhir.
 */
export function runMigrations(db: Db, migrations: readonly Migration[] = loadMigrations()): number {
  if (schemaVersion(db) === 0) upgradeLegacy(db);
  for (const m of migrations) {
    if (schemaVersion(db) >= m.version) continue;
    const apply = db.transaction(() => {
      if (schemaVersion(db) >= m.version) return;
      db.exec(m.sql);
      db.pragma(`user_version = ${m.version}`);
    });
    apply.immediate();
  }
  return schemaVersion(db);
}
