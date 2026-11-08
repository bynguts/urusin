// Backup online SQLite lewat API backup better-sqlite3, lalu integrity_check pada salinan.
// Dipanggil dari deploy/backup.sh di dalam image web (tanpa image pihak ketiga):
//   DB_PATH=/data/urusin.db OUT_PATH=/backup/.partial.db node scripts/db-backup.mjs
// atau lewat stdin (image tidak menyalin folder scripts): node --input-type=module - < db-backup.mjs
// Exit 0 hanya bila hasil salinan `integrity_check` = ok; selain itu salinan dihapus dan exit 1.
import { rmSync } from 'node:fs';
import Database from 'better-sqlite3';

const { DB_PATH, OUT_PATH } = process.env;
if (!DB_PATH || !OUT_PATH) {
  console.error('db-backup: DB_PATH dan OUT_PATH wajib diisi');
  process.exit(2);
}

async function main() {
  const src = new Database(DB_PATH, { fileMustExist: true });
  try {
    src.pragma('busy_timeout = 15000');
    await src.backup(OUT_PATH);
  } finally {
    src.close();
  }
  // Salinan mewarisi mode WAL; ubah ke DELETE agar berkas tunggal (tanpa -wal/-shm sisa) lalu periksa.
  const copy = new Database(OUT_PATH, { fileMustExist: true });
  try {
    copy.pragma('journal_mode = DELETE');
    const rows = copy.pragma('integrity_check');
    if (rows.length !== 1 || rows[0].integrity_check !== 'ok') {
      throw new Error(`integrity_check gagal: ${JSON.stringify(rows).slice(0, 300)}`);
    }
  } finally {
    copy.close();
  }
}

try {
  await main();
  console.log('db-backup: OK');
} catch (err) {
  rmSync(OUT_PATH, { force: true });
  console.error(`db-backup: GAGAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
