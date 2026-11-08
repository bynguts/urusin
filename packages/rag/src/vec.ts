import type { Db } from './db.js';

/**
 * Kapabilitas vektor (opsional). `sqlite-vec` BUKAN dependensi paket ini; dimuat dinamis hanya bila
 * terpasang. Tanpa itu mode tetap BM25.
 */
export async function tryLoadSqliteVec(db: Db): Promise<boolean> {
  try {
    const name = 'sqlite-vec';
    const mod = (await import(/* @vite-ignore */ name)) as { load?: (db: Db) => void };
    if (typeof mod.load !== 'function') return false;
    mod.load(db);
    db.prepare('SELECT vec_version()').get();
    return true;
  } catch {
    return false;
  }
}
