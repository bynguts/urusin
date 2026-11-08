import type { Db } from './db.js';

type ModuleImporter = (name: string) => Promise<unknown>;
// Satu-satunya import() non-literal yang diizinkan: nama hanya 'sqlite-vec' (lihat tryLoadSqliteVec), bukan modul HTTP.
// eslint-disable-next-line no-restricted-syntax
const defaultImporter: ModuleImporter = (name) => import(/* @vite-ignore */ name);

/**
 * Kapabilitas vektor (opsional). `sqlite-vec` BUKAN dependensi paket ini; dimuat dinamis hanya bila
 * terpasang (`importer` disuntikkan untuk uji). Tanpa itu mode tetap BM25.
 */
export async function tryLoadSqliteVec(db: Db, importer: ModuleImporter = defaultImporter): Promise<boolean> {
  try {
    const mod = (await importer('sqlite-vec')) as { load?: (db: Db) => void };
    if (typeof mod.load !== 'function') return false;
    mod.load(db);
    db.prepare('SELECT vec_version()').get();
    return true;
  } catch {
    return false;
  }
}
