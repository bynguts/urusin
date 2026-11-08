import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const scripts = fileURLToPath(new URL('../../../scripts/', import.meta.url));
const appRoot = fileURLToPath(new URL('../../../', import.meta.url));

function run(script: string, env: Record<string, string>, viaStdin = false) {
  const path = join(scripts, script);
  const args = viaStdin ? ['--input-type=module', '-'] : [path];
  return spawnSync(process.execPath, args, {
    cwd: appRoot,
    env: { ...process.env, ...env },
    input: viaStdin ? readFileSync(path) : undefined,
    encoding: 'utf8',
  });
}

function makeDb(path: string, rows: string[]) {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE t (v TEXT)');
  for (const r of rows) db.prepare('INSERT INTO t VALUES (?)').run(r);
  return db; // dibiarkan terbuka: meniru web yang sedang berjalan (WAL aktif)
}

const values = (path: string) => {
  const db = new Database(path, { readonly: true });
  try {
    return (db.prepare('SELECT v FROM t ORDER BY rowid').all() as { v: string }[]).map((r) => r.v);
  } finally {
    db.close();
  }
};

describe('db-backup.mjs / db-restore.mjs', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'urusin-db-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('backup online dari DB WAL yang sedang terbuka menghasilkan salinan valid', () => {
    const live = makeDb(join(dir, 'urusin.db'), ['a', 'b']);
    const r = run('db-backup.mjs', { DB_PATH: join(dir, 'urusin.db'), OUT_PATH: join(dir, 'out.db') });
    live.close();
    expect(r.status).toBe(0);
    expect(values(join(dir, 'out.db'))).toEqual(['a', 'b']);
  });

  it('berjalan juga lewat stdin (tanpa menyalin skrip ke image)', () => {
    makeDb(join(dir, 'urusin.db'), ['x']).close();
    const r = run('db-backup.mjs', { DB_PATH: join(dir, 'urusin.db'), OUT_PATH: join(dir, 'out.db') }, true);
    expect(r.status).toBe(0);
    expect(values(join(dir, 'out.db'))).toEqual(['x']);
  });

  it('exit non-zero dan tanpa salinan bila DB sumber tidak ada', () => {
    const r = run('db-backup.mjs', { DB_PATH: join(dir, 'tidak-ada.db'), OUT_PATH: join(dir, 'out.db') });
    expect(r.status).not.toBe(0);
    expect(existsSync(join(dir, 'out.db'))).toBe(false);
  });

  it('exit non-zero bila salinan gagal integrity_check (DB rusak)', () => {
    const bad = join(dir, 'rusak.db');
    writeFileSync(bad, Buffer.from('bukan database sqlite sama sekali, hanya teks acak'.repeat(100)));
    const r = run('db-backup.mjs', { DB_PATH: bad, OUT_PATH: join(dir, 'out.db') });
    expect(r.status).toBe(1);
    expect(existsSync(join(dir, 'out.db'))).toBe(false);
  });

  it('restore mengganti DB, menyimpan DB lama, dan menghapus -wal/-shm', () => {
    const db = join(dir, 'urusin.db');
    makeDb(db, ['lama']).close();
    makeDb(join(dir, 'backup.db'), ['baru-1', 'baru-2']).close();
    writeFileSync(`${db}-wal`, 'sisa');
    const r = run('db-restore.mjs', { SRC_PATH: join(dir, 'backup.db'), DB_PATH: db, STAMP: 'T1' });
    expect(r.status).toBe(0);
    // Periksa sisa -wal sebelum membuka DB (membuka DB WAL dapat membuat -wal/-shm baru).
    expect(!existsSync(`${db}-wal`) || readFileSync(`${db}-wal`, 'utf8') !== 'sisa').toBe(true);
    expect(values(db)).toEqual(['baru-1', 'baru-2']);
    expect(values(`${db}.pre-restore-T1`)).toEqual(['lama']);
  });

  it('restore menolak backup rusak tanpa mengubah DB, dan CHECK_ONLY tidak mengubah apa pun', () => {
    const db = join(dir, 'urusin.db');
    makeDb(db, ['lama']).close();
    const bad = join(dir, 'rusak.db');
    writeFileSync(bad, Buffer.from('bukan database sqlite sama sekali, hanya teks acak'.repeat(100)));
    const r = run('db-restore.mjs', { SRC_PATH: bad, DB_PATH: db, STAMP: 'T2' });
    expect(r.status).toBe(1);
    expect(values(db)).toEqual(['lama']);
    expect(existsSync(`${db}.pre-restore-T2`)).toBe(false);

    makeDb(join(dir, 'ok.db'), ['z']).close();
    const c = run('db-restore.mjs', { SRC_PATH: join(dir, 'ok.db'), CHECK_ONLY: '1' });
    expect(c.status).toBe(0);
    expect(values(db)).toEqual(['lama']);
  });
});
