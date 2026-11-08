import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FS, RS, formatTable, parseTimelineLog, tally } from '../lib/timeline.mjs';

const rec = (hash, email, name, date, parents, subject) =>
  [hash, email, name, date, parents, subject].join(FS) + RS;

const raw = [
  rec('a1', 'a@x', 'A', '2026-11-08T10:00:00+07:00', 'p1', 'feat: satu'),
  rec('a2', 'a@x', 'A', '2026-11-08T11:00:00+07:00', 'p2', 'feat: dua'),
  rec('b1', 'b@x', 'B', '2026-11-09T09:00:00+07:00', 'p3 p4', 'chore: merge x'),
].join('\n');

describe('timeline', () => {
  it('mem-parse commit, hari (tanggal author), dan parent', () => {
    const commits = parseTimelineLog(raw);
    assert.equal(commits.length, 3);
    assert.equal(commits[0].day, '2026-11-08');
    assert.deepEqual(commits[2].parents, ['p3', 'p4']);
  });

  it('menghitung commit per hari per anggota', () => {
    const t = tally(parseTimelineLog(raw), (c) => c.day);
    assert.deepEqual(t.keys, ['2026-11-08', '2026-11-09']);
    assert.equal(t.cells.get('2026-11-08').get('a@x'), 2);
    assert.equal(t.cells.get('2026-11-09').get('b@x'), 1);
  });

  it('tabel memuat total dan nama anggota', () => {
    const text = formatTable(
      'Judul',
      'hari',
      tally(parseTimelineLog(raw), (c) => c.day),
    );
    assert.match(text, /hari\s+A\s+B\s+total/);
    assert.match(text, /2026-11-08\s+2\s+0\s+2/);
  });
});
