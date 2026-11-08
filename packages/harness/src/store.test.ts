import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openHarnessDb } from './db.js';
import { ConflictError, IllegalTransitionError, TerminalStateError, TurnInProgressError } from './errors.js';
import { URUSAN_STATES, allowedTransitions, canTransition, stateDiagram } from './state.js';
import { HarnessStore } from './store.js';
import { FAKE_EMAIL, FAKE_HP, FAKE_NIK, SIXTEEN_DIGIT_RUN, dumpDb } from './testing.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // Windows menahan berkas WAL selama koneksi terbuka; direktori temp dibersihkan OS.
    }
  }
});

function fileDbPath(): string {
  const d = mkdtempSync(join(tmpdir(), 'urusin-'));
  dirs.push(d);
  return join(d, 'h.db');
}

describe('state machine', () => {
  it('jalur normal sesuai rencana', () => {
    const path: [string, string][] = [
      ['BARU', 'MEMAHAMI'],
      ['MEMAHAMI', 'RENCANA_DIUSULKAN'],
      ['RENCANA_DIUSULKAN', 'RENCANA_DISETUJUI'],
      ['RENCANA_DISETUJUI', 'MENYIAPKAN_BERKAS'],
      ['MENYIAPKAN_BERKAS', 'BERKAS_SIAP'],
      ['BERKAS_SIAP', 'MENGISI'],
      ['MENGISI', 'MENUNGGU_KONFIRMASI'],
      ['MENUNGGU_KONFIRMASI', 'MENGUNGGAH'],
      ['MENGUNGGAH', 'MENUNGGU_SUBMIT_WARGA'],
      ['MENUNGGU_SUBMIT_WARGA', 'TERKIRIM'],
      ['TERKIRIM', 'DIPANTAU'],
      ['DIPANTAU', 'SELESAI'],
    ];
    for (const [a, b] of path) expect(canTransition(a as never, b as never), `${a}→${b}`).toBe(true);
  });

  it('transisi samping ke DIPANDU/GAGAL_AMAN/DIBATALKAN dari state non-terminal mana pun', () => {
    for (const s of URUSAN_STATES) {
      if (['SELESAI', 'DITOLAK', 'DIBATALKAN'].includes(s)) {
        expect(allowedTransitions(s)).toEqual([]);
        continue;
      }
      for (const side of ['DIPANDU', 'GAGAL_AMAN', 'DIBATALKAN'] as const) {
        if (side !== s) expect(canTransition(s, side), `${s}→${side}`).toBe(true);
      }
    }
  });

  it('melompati langkah ditolak', () => {
    expect(canTransition('BARU', 'MENGISI')).toBe(false);
    expect(canTransition('MEMAHAMI', 'TERKIRIM')).toBe(false);
    expect(canTransition('MENGISI', 'TERKIRIM')).toBe(false);
    expect(canTransition('SELESAI', 'MEMAHAMI')).toBe(false);
  });

  it('diagram dihasilkan dari tabel', () => {
    const d = stateDiagram();
    expect(d).toContain('BARU --> MEMAHAMI');
    expect(d).toContain('SELESAI --> [*]');
  });
});

describe('urusan: transisi + compare-and-swap', () => {
  it('membuat urusan BARU version 0 dan transisi menaikkan version', () => {
    const s = new HarnessStore(openHarnessDb());
    const u = s.createUrusan({ kodeKabKota: '3312' });
    expect(u).toMatchObject({ state: 'BARU', version: 0, kodeKabKota: '3312' });
    const u1 = s.transition(u.id, 0, 'MEMAHAMI');
    expect(u1).toMatchObject({ state: 'MEMAHAMI', version: 1 });
  });

  it('transisi ilegal ditolak dan tidak mengubah baris', () => {
    const s = new HarnessStore(openHarnessDb());
    const u = s.createUrusan();
    expect(() => s.transition(u.id, 0, 'TERKIRIM')).toThrow(IllegalTransitionError);
    expect(s.getUrusan(u.id)).toMatchObject({ state: 'BARU', version: 0 });
  });

  it('version basi menghasilkan ConflictError (409)', () => {
    const s = new HarnessStore(openHarnessDb());
    const u = s.createUrusan();
    s.transition(u.id, 0, 'MEMAHAMI');
    try {
      s.transition(u.id, 0, 'RENCANA_DIUSULKAN');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConflictError);
      expect((e as ConflictError).status).toBe(409);
    }
    expect(s.getUrusan(u.id)?.state).toBe('MEMAHAMI');
  });

  it('dua koneksi ke file yang sama: hanya satu update dengan version sama yang menang', () => {
    const path = fileDbPath();
    const a = new HarnessStore(openHarnessDb(path));
    const b = new HarnessStore(openHarnessDb(path));
    const u = a.createUrusan();
    const results = [() => a.transition(u.id, 0, 'MEMAHAMI'), () => b.transition(u.id, 0, 'DIPANDU')].map(
      (f) => {
        try {
          f();
          return 'ok';
        } catch (e) {
          return e instanceof ConflictError ? 'conflict' : 'other';
        }
      },
    );
    expect(results.sort()).toEqual(['conflict', 'ok']);
    expect(a.getUrusan(u.id)?.version).toBe(1);
  });

  it('50 penulis berebut version yang sama (Promise.all): tepat satu menang, version naik satu kali', async () => {
    const path = fileDbPath();
    const stores = Array.from({ length: 5 }, () => new HarnessStore(openHarnessDb(path)));
    const u = stores[0]!.createUrusan();
    const outcomes = await Promise.all(
      Array.from({ length: 50 }, async (_, i) => {
        await Promise.resolve();
        try {
          stores[i % stores.length]!.transition(u.id, 0, 'MEMAHAMI');
          return 'ok';
        } catch (e) {
          return e instanceof ConflictError ? 'conflict' : 'other';
        }
      }),
    );
    expect(outcomes.filter((o) => o === 'ok')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'conflict')).toHaveLength(49);
    expect(stores[0]!.getUrusan(u.id)?.version).toBe(1);
  });
});

describe('klaim turn', () => {
  it('hanya satu turn berjalan per urusan (409) dan klaim menaikkan version', () => {
    const path = fileDbPath();
    const a = new HarnessStore(openHarnessDb(path));
    const b = new HarnessStore(openHarnessDb(path));
    const u = a.createUrusan();
    const c1 = a.claimTurn(u.id, 'halo');
    expect(c1).toMatchObject({ seq: 1, version: 1 });
    expect(() => b.claimTurn(u.id, 'halo lagi')).toThrow(TurnInProgressError);
    a.finishTurn(c1.turnId, {
      status: 'done',
      messages: [],
      tokensIn: 1,
      tokensOut: 1,
      costIdr: 0,
      degraded: false,
    });
    const c2 = b.claimTurn(u.id, 'lagi');
    expect(c2.seq).toBe(2);
  });

  it('expectedVersion basi ditolak', () => {
    const s = new HarnessStore(openHarnessDb());
    const u = s.createUrusan();
    expect(() => s.claimTurn(u.id, 'x', { expectedVersion: 5 })).toThrow(ConflictError);
  });

  it('turn pada urusan terminal ditolak', () => {
    const s = new HarnessStore(openHarnessDb());
    const u = s.createUrusan();
    s.transition(u.id, 0, 'DIBATALKAN');
    expect(() => s.claimTurn(u.id, 'x')).toThrow(TerminalStateError);
  });

  it('turn yatim (lease habis) dibersihkan saat boot', () => {
    let t = Date.parse('2026-11-09T00:00:00Z');
    const s = new HarnessStore(openHarnessDb(), { now: () => new Date(t), leaseMs: 1000 });
    const u = s.createUrusan();
    s.claimTurn(u.id, 'x');
    t += 5000;
    expect(s.reapExpiredTurns()).toBe(1);
    expect(() => s.claimTurn(u.id, 'y')).not.toThrow();
  });
});

describe('audit: rantai hash per urusan', () => {
  function seeded() {
    const s = new HarnessStore(openHarnessDb());
    const u = s.createUrusan();
    for (let i = 0; i < 5; i++) s.appendEvent(u.id, 'progress', { label: `langkah ${i}` });
    return { s, u };
  }

  it('rantai valid dan head cocok dengan head yang dipegang klien', () => {
    const { s, u } = seeded();
    const head = s.chainHead(u.id);
    expect(s.verifyChain(u.id, head)).toMatchObject({ ok: true, count: 5, head });
  });

  it('seq berurutan dan unik per urusan; replay Last-Event-ID', () => {
    const { s, u } = seeded();
    expect(s.eventsAfter(u.id, 0).map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(s.eventsAfter(u.id, 3).map((e) => e.seq)).toEqual([4, 5]);
  });

  it('mengubah SATU baris terdeteksi', () => {
    const { s, u } = seeded();
    s.db
      .prepare('UPDATE events SET payload = ? WHERE urusan_id = ? AND seq = 3')
      .run('{"label":"palsu"}', u.id);
    expect(s.verifyChain(u.id)).toMatchObject({ ok: false, brokenAtSeq: 3, reason: 'hash' });
  });

  it('menghapus baris tengah terdeteksi (seq_gap)', () => {
    const { s, u } = seeded();
    s.db.prepare('DELETE FROM events WHERE urusan_id = ? AND seq = 2').run(u.id);
    expect(s.verifyChain(u.id)).toMatchObject({ ok: false, reason: 'seq_gap' });
  });

  it('memotong ekor rantai terdeteksi terhadap head klien', () => {
    const { s, u } = seeded();
    const head = s.chainHead(u.id);
    s.db.prepare('DELETE FROM events WHERE urusan_id = ? AND seq = 5').run(u.id);
    expect(s.verifyChain(u.id)).toMatchObject({ ok: true });
    expect(s.verifyChain(u.id, head)).toMatchObject({ ok: false, reason: 'head_mismatch' });
  });

  it('menulis ulang hash satu baris tanpa menyambung ke berikutnya terdeteksi', () => {
    const { s, u } = seeded();
    s.db.prepare("UPDATE events SET hash = 'abc' WHERE urusan_id = ? AND seq = 2").run(u.id);
    expect(s.verifyChain(u.id)).toMatchObject({ ok: false, brokenAtSeq: 2 });
  });

  it('rantai antar urusan terpisah', () => {
    const s = new HarnessStore(openHarnessDb());
    const a = s.createUrusan();
    const b = s.createUrusan();
    s.appendEvent(a.id, 'progress', { x: 1 });
    s.appendEvent(b.id, 'progress', { x: 1 });
    expect(s.chainHead(a.id)).not.toBe(s.chainHead(b.id));
  });

  it('hapus urusan menyisakan tombstone saja', () => {
    const { s, u } = seeded();
    const head = s.chainHead(u.id);
    const t = s.deleteUrusan(u.id);
    expect(t.headHash).toBe(head);
    expect(s.getUrusan(u.id)).toBeUndefined();
    expect(s.db.prepare('SELECT COUNT(*) n FROM events').get()).toEqual({ n: 0 });
    expect(s.db.prepare('SELECT COUNT(*) n FROM tombstones').get()).toEqual({ n: 1 });
  });
});

describe('tidak menyimpan PII asli', () => {
  it('grep seluruh DB: nol run 16 digit, nol HP, nol email setelah menyimpan teks berisi PII', () => {
    const s = new HarnessStore(openHarnessDb());
    const u = s.createUrusan();
    const pii = `NIK ${FAKE_NIK} HP ${FAKE_HP} email ${FAKE_EMAIL}`;
    const claim = s.claimTurn(u.id, pii);
    s.appendEvent(u.id, 'assistant_text', { teks: pii });
    s.finishTurn(claim.turnId, {
      status: 'done',
      messages: [
        { role: 'user', content: pii },
        { role: 'assistant', content: `Tercatat ${pii}` },
      ],
      tokensIn: 1,
      tokensOut: 1,
      costIdr: 0,
      degraded: false,
    });
    const dump = dumpDb(s.db);
    expect(dump).not.toMatch(SIXTEEN_DIGIT_RUN);
    expect(dump).not.toContain(FAKE_HP);
    expect(dump).not.toContain(FAKE_EMAIL);
    expect(dump).toContain('{{');
  });
});
