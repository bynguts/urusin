import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openHarnessDb } from './db.js';
import { ConflictError, TurnInProgressError } from './errors.js';
import { PiiInterceptor } from './pii.js';
import { HarnessStore } from './store.js';

/** Dua instance web (blue/green) memakai satu berkas SQLite WAL lewat koneksi terpisah. */
const dirs: string[] = [];
const dbs: ReturnType<typeof openHarnessDb>[] = [];
afterEach(() => {
  for (const d of dbs.splice(0)) d.close();
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // Windows menahan berkas WAL sesaat; direktori temp dibersihkan OS.
    }
  }
});

function dua(opts: { nowA?: () => Date; nowB?: () => Date; leaseMs?: number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'urusin-mi-'));
  dirs.push(dir);
  const path = join(dir, 'u.sqlite');
  const dbA = openHarnessDb(path);
  const dbB = openHarnessDb(path);
  dbs.push(dbA, dbB);
  const lease = opts.leaseMs ?? 30_000;
  const a = new HarnessStore(dbA, {
    instanceId: 'biru',
    leaseMs: lease,
    ...(opts.nowA ? { now: opts.nowA } : {}),
  });
  const b = new HarnessStore(dbB, {
    instanceId: 'hijau',
    leaseMs: lease,
    ...(opts.nowB ? { now: opts.nowB } : {}),
  });
  return { a, b };
}

describe('lease turn lintas instance (B2b)', () => {
  it('instance baru yang boot tidak membunuh turn hidup milik instance lama', () => {
    const { a, b } = dua();
    const u = a.createUrusan();
    const { turnId } = a.claimTurn(u.id, 'halo');
    expect(b.reapExpiredTurns()).toBe(0);
    const row = a.db.prepare('SELECT status, owner_instance FROM turns WHERE id = ?').get(turnId);
    expect(row).toEqual({ status: 'running', owner_instance: 'biru' });
    // dan turn kedua tidak bisa berjalan bersamaan di instance baru
    expect(() => b.claimTurn(u.id, 'lagi')).toThrow(TurnInProgressError);
  });

  it('turn yatim (lease lewat, pemilik mati) dibersihkan instance lain lalu urusan bisa lanjut', () => {
    let tB = Date.parse('2026-11-09T00:00:00Z');
    const { a, b } = dua({ leaseMs: 1000, nowB: () => new Date(tB), nowA: () => new Date(tB) });
    const u = a.createUrusan();
    a.claimTurn(u.id, 'halo');
    tB += 1500; // lease habis, A tidak memperpanjang (proses mati)
    expect(b.reapExpiredTurns()).toBe(1);
    expect(() => b.claimTurn(u.id, 'lanjut')).not.toThrow();
  });

  it('claimTurn melepas turn yatim sendiri: 409 sebelum lease habis, berhasil sesudahnya, dengan event', () => {
    let t = Date.parse('2026-11-09T00:00:00Z');
    const now = () => new Date(t);
    const { a, b } = dua({ leaseMs: 1000, nowA: now, nowB: now });
    const u = a.createUrusan();
    const lama = a.claimTurn(u.id, 'halo');
    t += 500; // A "mati": tidak memperpanjang
    expect(() => b.claimTurn(u.id, 'lagi')).toThrow(TurnInProgressError);
    t += 1000;
    const baru = b.claimTurn(u.id, 'lagi');
    expect(baru.turnId).not.toBe(lama.turnId);
    expect(a.db.prepare('SELECT status, error_code FROM turns WHERE id = ?').get(lama.turnId)).toEqual({
      status: 'error',
      error_code: 'ABANDONED',
    });
    expect(b.eventsAfter(u.id, 0).some((e) => e.type === 'error')).toBe(true);
    expect(b.verifyChain(u.id).ok).toBe(true);
  });

  it('renewLease memperpanjang hanya turn milik instance sendiri', () => {
    let t = Date.parse('2026-11-09T00:00:00Z');
    const { a, b } = dua({ leaseMs: 1000, nowA: () => new Date(t), nowB: () => new Date(t) });
    const u = a.createUrusan();
    const { turnId } = a.claimTurn(u.id, 'halo');
    expect(b.renewLease(turnId)).toBe(false);
    t += 800;
    expect(a.renewLease(turnId)).toBe(true);
    t += 800; // total 1600 ms: tanpa perpanjangan sudah habis, dengan perpanjangan masih berlaku
    expect(b.reapExpiredTurns()).toBe(0);
  });

  it('basis data lama tanpa kolom lease dimigrasi tanpa kehilangan data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'urusin-mig-'));
    dirs.push(dir);
    const path = join(dir, 'u.sqlite');
    const db = openHarnessDb(path);
    dbs.push(db);
    db.exec('ALTER TABLE turns DROP COLUMN owner_instance; ALTER TABLE turns DROP COLUMN lease_until;');
    db.pragma('user_version = 0'); // seolah DB dibuat sebelum migrasi berversi
    const again = openHarnessDb(path);
    dbs.push(again);
    const cols = (again.prepare('PRAGMA table_info(turns)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['owner_instance', 'lease_until']));
  });
});

describe('jaminan lintas koneksi: CAS version + kunci turn tingkat DB (B2c)', () => {
  it('dua koneksi berebut memulai turn pada urusan yang sama: tepat satu menang', () => {
    const { a, b } = dua();
    const u = a.createUrusan();
    const hasil = [a, b].map((s) => {
      try {
        return s.claimTurn(u.id, 'halo').turnId;
      } catch (e) {
        return e;
      }
    });
    expect(hasil.filter((h) => typeof h === 'string')).toHaveLength(1);
    expect(hasil.filter((h) => h instanceof TurnInProgressError)).toHaveLength(1);
    const n = a.db
      .prepare("SELECT COUNT(*) n FROM turns WHERE urusan_id = ? AND status = 'running'")
      .get(u.id);
    expect(n).toEqual({ n: 1 });
  });

  it('kunci unik DB menolak turn running ganda walau klaim dilakukan tanpa pemeriksaan aplikasi', () => {
    const { a } = dua();
    const u = a.createUrusan();
    a.claimTurn(u.id, 'satu');
    expect(() =>
      a.db
        .prepare(
          "INSERT INTO turns (id, urusan_id, seq, status, user_text, started_at) VALUES ('t_x', ?, 99, 'running', 'dua', '2026-11-09T00:00:00Z')",
        )
        .run(u.id),
    ).toThrow(/UNIQUE/);
  });

  it('CAS version: dua instance dengan version basi yang sama, hanya satu transisi yang berhasil', () => {
    const { a, b } = dua();
    const u = a.createUrusan();
    const v0 = a.transition(u.id, 0, 'MEMAHAMI');
    expect(v0.state).toBe('MEMAHAMI');
    // keduanya masih memegang version 1 → RENCANA_DIUSULKAN
    const r = [a, b].map((s) => {
      try {
        return s.transition(u.id, v0.version, 'RENCANA_DIUSULKAN').version;
      } catch (e) {
        return e;
      }
    });
    expect(r.filter((x) => typeof x === 'number')).toHaveLength(1);
    expect(r.filter((x) => x instanceof ConflictError)).toHaveLength(1);
  });

  it('expectedVersion basi dari klien yang melihat versi lama → ConflictError', () => {
    const { a, b } = dua();
    const u = a.createUrusan();
    a.claimTurn(u.id, 'satu'); // version 0 → 1
    expect(() => b.claimTurn(u.id, 'dua', { expectedVersion: 0 })).toThrow();
  });
});

describe('kunci PII bersama (blue/green)', () => {
  const NIK = ['3271', '0101', '0190', '0001'].join('');
  it('dua store dengan kunci sama memetakan NIK yang sama ke token yang sama; kunci beda tidak', () => {
    const { a, b } = dua();
    const kunci = 'k'.repeat(44);
    const sa = new HarnessStore(a.db, { piiKey: kunci });
    const sb = new HarnessStore(b.db, { piiKey: kunci });
    const sc = new HarnessStore(b.db, { piiKey: 'z'.repeat(44) });
    const u = sa.createUrusan();
    const redact = (s: HarnessStore) =>
      new PiiInterceptor(undefined, {}, s.placeholderPersistence(u.id)).redact(`nik ${NIK}`).text;
    expect(redact(sa)).toBe('nik {{PEMOHON.NIK}}');
    expect(redact(sb)).toBe('nik {{PEMOHON.NIK}}');
    // kunci lain tidak mengenali entri lama: NIK yang sama dianggap orang baru, tidak bertabrakan
    expect(redact(sc)).toBe('nik {{ORANG2.NIK}}');
  });
});
