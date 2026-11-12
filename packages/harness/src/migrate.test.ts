import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openHarnessDb } from './db.js';
import { loadMigrations, runMigrations, schemaVersion } from './migrate.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // Windows menahan berkas sesaat
    }
  }
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'urusin-mig-'));
  dirs.push(d);
  return d;
};

const tables = (db: Database.Database) =>
  (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[]
  ).map((t) => t.name);

describe('migrasi berversi', () => {
  it('0001_init.sql membuat seluruh skema dan menaikkan user_version ke 1', () => {
    const db = openHarnessDb();
    expect(schemaVersion(db)).toBe(loadMigrations().length);
    expect(tables(db)).toEqual(
      expect.arrayContaining([
        'urusan',
        'turns',
        'events',
        'spans',
        'confirmations',
        'retrieved_chunks',
        'tombstones',
        'daily_usage',
        'execution_results',
        'nomor_permohonan',
      ]),
    );
  });

  it('idempoten: menjalankan ulang tidak mengubah apa pun dan tidak menghapus data', () => {
    const path = join(tmp(), 'a.sqlite');
    const a = openHarnessDb(path);
    a.prepare("INSERT INTO urusan (id, state, created_at, updated_at) VALUES ('u_1','BARU','x','x')").run();
    expect(runMigrations(a)).toBe(loadMigrations().length);
    expect(runMigrations(a)).toBe(loadMigrations().length);
    a.close();
    const b = openHarnessDb(path);
    expect(b.prepare('SELECT COUNT(*) n FROM urusan').get()).toEqual({ n: 1 });
    b.close();
  });

  it('DB lama (skema inline tanpa user_version dan tanpa kolom lease) ditingkatkan tanpa kehilangan data', () => {
    const path = join(tmp(), 'lama.sqlite');
    const lama = new Database(path);
    lama.exec(`CREATE TABLE urusan (id TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL, jenis TEXT, kode_kabkota TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, turn_count INTEGER NOT NULL DEFAULT 0, tokens_in INTEGER NOT NULL DEFAULT 0,
      tokens_out INTEGER NOT NULL DEFAULT 0, cost_idr REAL NOT NULL DEFAULT 0);
      CREATE TABLE turns (id TEXT PRIMARY KEY, urusan_id TEXT NOT NULL, seq INTEGER NOT NULL, status TEXT NOT NULL, user_text TEXT NOT NULL,
      messages TEXT NOT NULL DEFAULT '[]', started_at TEXT NOT NULL, ended_at TEXT, tokens_in INTEGER NOT NULL DEFAULT 0,
      tokens_out INTEGER NOT NULL DEFAULT 0, cost_idr REAL NOT NULL DEFAULT 0, degraded INTEGER NOT NULL DEFAULT 0, error_code TEXT);
      INSERT INTO urusan (id, state, created_at, updated_at) VALUES ('u_lama','BARU','x','x');`);
    expect(schemaVersion(lama)).toBe(0);
    lama.close();
    const db = openHarnessDb(path);
    expect(schemaVersion(db)).toBe(loadMigrations().length);
    expect(db.prepare('SELECT id FROM urusan').all()).toEqual([{ id: 'u_lama' }]);
    const cols = (db.prepare('PRAGMA table_info(turns)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['owner_instance', 'lease_until']));
    db.close();
  });

  it('migrasi gagal di tengah dibatalkan seluruhnya (transaksi) dan versi tidak naik', () => {
    const db = new Database(':memory:');
    const rusak = [
      { version: 1, name: 'ok', sql: 'CREATE TABLE a (x INTEGER);' },
      { version: 2, name: 'rusak', sql: 'CREATE TABLE b (x INTEGER); INSERT INTO tidak_ada VALUES (1);' },
    ];
    expect(() => runMigrations(db, rusak)).toThrow();
    expect(schemaVersion(db)).toBe(1);
    expect(tables(db)).toEqual(['a']);
  });

  it('dua koneksi menjalankan migrasi bersamaan di satu berkas: hasilnya satu skema utuh', () => {
    const path = join(tmp(), 'b.sqlite');
    const a = new Database(path);
    const b = new Database(path);
    a.pragma('busy_timeout = 5000');
    b.pragma('busy_timeout = 5000');
    expect(runMigrations(a)).toBe(loadMigrations().length);
    expect(runMigrations(b)).toBe(loadMigrations().length);
    expect(tables(b)).toContain('turns');
    a.close();
    b.close();
  });

  it('0006: akun sandi lama tanpa email_verified_at jadi aktif sejak dibuat; tamu dan akun lain tidak tersentuh', () => {
    const db = new Database(':memory:');
    const semua = loadMigrations();
    const v6 = semua.findIndex((m) => m.name.includes('akun_tanpa_verifikasi'));
    expect(semua[v6]!.version).toBe(6);
    runMigrations(db, semua.slice(0, v6));
    const tambah = db.prepare(
      'INSERT INTO users (id, jenis, email, email_verified_at, sid_hash, created_at, expires_at) VALUES (?,?,?,?,?,?,?)',
    );
    tambah.run('akun_lama', 'akun', 'lama@example.com', null, null, '2026-11-01T00:00:00.000Z', null);
    tambah.run(
      'akun_aktif',
      'akun',
      'aktif@example.com',
      '2026-11-03T00:00:00.000Z',
      null,
      '2026-11-02T00:00:00.000Z',
      null,
    );
    tambah.run('tamu_1', 'tamu', null, null, 'h1', '2026-11-04T00:00:00.000Z', '2026-11-07T00:00:00.000Z');
    db.prepare(
      "INSERT INTO email_tokens (token_hash, user_id, purpose, created_at, expires_at) VALUES ('t1','akun_lama','verify','x','9999')",
    ).run();
    runMigrations(db, semua);
    expect(schemaVersion(db)).toBe(semua.length);
    expect(db.prepare('SELECT id, email_verified_at FROM users ORDER BY id').all()).toEqual([
      { id: 'akun_aktif', email_verified_at: '2026-11-03T00:00:00.000Z' },
      { id: 'akun_lama', email_verified_at: '2026-11-01T00:00:00.000Z' },
      { id: 'tamu_1', email_verified_at: null },
    ]);
    // review H2: aktivasi TIDAK sama dengan bukti kepemilikan email; hanya yang dulu terverifikasi yang terbukti
    expect(db.prepare('SELECT user_id, at FROM email_terbukti').all()).toEqual([
      { user_id: 'akun_aktif', at: '2026-11-03T00:00:00.000Z' },
    ]);
    expect(
      db.prepare("SELECT used_at IS NOT NULL AS dipakai FROM email_tokens WHERE token_hash = 't1'").get(),
    ).toEqual({
      dipakai: 1,
    });
  });

  it('berkas migrasi harus berurutan tanpa lompatan', () => {
    const d = tmp();
    writeFileSync(join(d, '0001_a.sql'), 'SELECT 1;');
    writeFileSync(join(d, '0003_c.sql'), 'SELECT 1;');
    expect(() => loadMigrations(d)).toThrow(/berurutan/);
  });
});
