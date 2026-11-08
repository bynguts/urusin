import { openHarnessDb } from './db.js';
import { schemaVersion } from './migrate.js';

/** `pnpm --filter @urusin/harness run migrate`: migrasi DB di `DB_PATH` (atau `DATABASE_URL`), lalu cetak versinya. */
const path = process.env.DB_PATH ?? process.env.DATABASE_URL?.replace(/^file:/, '');
if (!path) {
  console.error('migrate: set DB_PATH (atau DATABASE_URL=file:...)');
  process.exit(1);
}
const db = openHarnessDb(path);
console.log(`migrate: ${path} pada versi skema ${schemaVersion(db)}`);
db.close();
