import { createHash } from 'node:crypto';

/** JSON kanonik: kunci terurut, tanpa spasi, `undefined` dibuang. Dasar hash rantai audit. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value))
    return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/** genesis = sha256(urusan_id ‖ created_at) */
export function genesisHash(urusanId: string, createdAt: string): string {
  return sha256(`${urusanId}${createdAt}`);
}

export type ChainedEvent = { seq: number; type: string; at: string; payload: string };

/** hash_n = sha256(hash_{n-1} ‖ canonical({seq, type, at, payload})). */
export function chainHash(prevHash: string, ev: ChainedEvent): string {
  return sha256(
    `${prevHash}${canonicalJson({ seq: ev.seq, type: ev.type, at: ev.at, payload: JSON.parse(ev.payload) })}`,
  );
}

export type ChainVerification =
  | { ok: true; count: number; head: string }
  | {
      ok: false;
      count: number;
      brokenAtSeq: number;
      reason: 'prev_hash' | 'hash' | 'seq_gap' | 'head_mismatch';
    };

type StoredRow = ChainedEvent & { prev_hash: string; hash: string };

/**
 * Verifikasi rantai satu urusan. `expectedHead` = head yang dipegang klien: bila rantai server valid secara
 * internal tetapi kepalanya berbeda, server dianggap memanipulasi (termasuk memotong ekor rantai).
 */
export function verifyRows(
  urusanId: string,
  createdAt: string,
  rows: readonly StoredRow[],
  expectedHead?: string,
): ChainVerification {
  let prev = genesisHash(urusanId, createdAt);
  let expectedSeq = 1;
  let headKnown = expectedHead === prev;
  for (const row of rows) {
    if (row.seq !== expectedSeq)
      return { ok: false, count: rows.length, brokenAtSeq: row.seq, reason: 'seq_gap' };
    if (row.prev_hash !== prev)
      return { ok: false, count: rows.length, brokenAtSeq: row.seq, reason: 'prev_hash' };
    if (chainHash(prev, row) !== row.hash) {
      return { ok: false, count: rows.length, brokenAtSeq: row.seq, reason: 'hash' };
    }
    prev = row.hash;
    if (row.hash === expectedHead) headKnown = true;
    expectedSeq++;
  }
  // Head klien yang lebih lama (hash baris mana pun) sah; tak cocok sama sekali = rantai bukan milik klien / dirusak.
  if (expectedHead !== undefined && !headKnown) {
    return { ok: false, count: rows.length, brokenAtSeq: rows.length, reason: 'head_mismatch' };
  }
  return { ok: true, count: rows.length, head: prev };
}
