// Pulihkan SQLite dari berkas backup (sudah di-gunzip). Dipanggil dari deploy/restore.sh di dalam image web:
//   SRC_PATH=/w/restore.db DB_PATH=/data/urusin.db STAMP=20261110T060000Z node scripts/db-restore.mjs
// CHECK_ONLY=1 hanya memvalidasi SRC_PATH (integrity_check) tanpa mengubah apa pun.
// Aman dipanggil lewat stdin: node --input-type=module - < db-restore.mjs
// Urutan: validasi -> DB lama dipindah ke `<DB_PATH>.pre-restore-<STAMP>` -> hapus -wal/-shm -> salin baru
// (tulis ke berkas sementara lalu rename) -> chown/chmod 600 mengikuti pemilik DB lama atau direktorinya.
import { chmodSync, chownSync, copyFileSync, existsSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

const { SRC_PATH, DB_PATH, STAMP, CHECK_ONLY } = process.env;
if (!SRC_PATH || (!CHECK_ONLY && (!DB_PATH || !STAMP))) {
  console.error('db-restore: SRC_PATH wajib; DB_PATH dan STAMP wajib kecuali CHECK_ONLY=1');
  process.exit(2);
}

function assertIntegrity(path) {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const rows = db.pragma('integrity_check');
    if (rows.length !== 1 || rows[0].integrity_check !== 'ok') {
      throw new Error(`integrity_check backup gagal: ${JSON.stringify(rows).slice(0, 300)}`);
    }
  } finally {
    db.close();
  }
}

try {
  assertIntegrity(SRC_PATH);
  if (CHECK_ONLY) {
    console.log('db-restore: backup valid');
    process.exit(0);
  }
  const ownerRef = statSync(existsSync(DB_PATH) ? DB_PATH : dirname(DB_PATH));
  if (existsSync(DB_PATH)) renameSync(DB_PATH, `${DB_PATH}.pre-restore-${STAMP}`);
  rmSync(`${DB_PATH}-wal`, { force: true });
  rmSync(`${DB_PATH}-shm`, { force: true });
  const tmp = `${DB_PATH}.restore-tmp`;
  copyFileSync(SRC_PATH, tmp);
  try {
    chownSync(tmp, ownerRef.uid, ownerRef.gid);
  } catch {
    // Bukan root (mis. saat tes): lewati; pemilik tetap pengguna saat ini.
  }
  chmodSync(tmp, 0o600);
  renameSync(tmp, DB_PATH);
  console.log(`db-restore: OK (DB lama: ${DB_PATH}.pre-restore-${STAMP})`);
} catch (err) {
  console.error(`db-restore: GAGAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
