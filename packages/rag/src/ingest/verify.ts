import { ingestEgressFetch } from '@urusin/egress';
import type { Db } from '../db.js';
import { PoliteFetcher, RobotsBlockedError, type Deps } from './fetcher.js';
import type { SourceEntry } from './sources.js';
import { klampidEndpoint, klampidHash, sanitizeKlampid } from './klampid.js';
import { contentHash, loadSourceStates } from './state.js';

export type VerifyAction = 'unchanged' | 'changed' | 'skipped' | 'blocked' | 'error';
export type VerifyReport = { id: string; url: string; action: VerifyAction; reason?: string };

export type VerifyOptions = {
  db: Db;
  sources: readonly SourceEntry[];
  only?: string | undefined;
  deps?: Deps | undefined;
  minIntervalMs?: number | undefined;
};

/**
 * Ambil ulang tiap sumber yang sudah pernah di-ingest (conditional GET: ETag / Last-Modified, lalu
 * hash isi). Robots dihormati, >= 2 detik per host, UA jujur (PoliteFetcher). Tidak mengubah teks
 * chunk: sumber yang isinya berbeda hanya ditandai `changed` (hasil pencarian memberi peringatan
 * sampai di-ingest ulang). Sumber yang tak berubah mendapat verifiedAt baru.
 */
export async function runVerify(opts: VerifyOptions): Promise<VerifyReport[]> {
  const deps: Deps = opts.deps ?? {
    fetch: ingestEgressFetch,
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
  const fetcher = new PoliteFetcher(deps, opts.minIntervalMs);
  const states = new Map(loadSourceStates(opts.db).map((s) => [s.sourceId, s]));
  const byId = new Map(opts.sources.map((s) => [s.id, s]));
  const reports: VerifyReport[] = [];
  const ids = [...states.keys()].filter((id) => !opts.only || id === opts.only);
  if (opts.only && ids.length === 0) throw new Error(`Sumber belum pernah di-ingest: ${opts.only}`);

  for (const id of ids) {
    const st = states.get(id)!;
    const src = byId.get(id);
    if (!src) {
      reports.push({ id, url: '-', action: 'skipped', reason: 'tidak-ada-di-sources.json' });
      continue;
    }
    const now = new Date(deps.now()).toISOString();
    const cond: Record<string, string> = {};
    if (st.etag) cond['if-none-match'] = st.etag;
    if (st.lastModified) cond['if-modified-since'] = st.lastModified;
    try {
      const res = await fetcher.get(src.adapter === 'klampid' ? klampidEndpoint(src.url) : src.url, cond);
      let same: boolean;
      if (res.status === 304) same = true;
      else if (res.status === 200)
        same =
          (src.adapter === 'klampid'
            ? klampidHash(sanitizeKlampid(JSON.parse(res.body)))
            : contentHash(res.body)) === st.contentHash;
      else {
        reports.push({ id, url: src.url, action: 'error', reason: `HTTP ${res.status}` });
        continue;
      }
      const db = opts.db;
      if (same) {
        db.transaction(() => {
          db.prepare(
            `UPDATE source_state SET checked_at = ?, verified_at = ?, changed = 0, changed_at = NULL,
               etag = COALESCE(?, etag), last_modified = COALESCE(?, last_modified) WHERE source_id = ?`,
          ).run(now, now, res.etag, res.lastModified, id);
          db.prepare('UPDATE chunks SET verified_at = ? WHERE id LIKE ?').run(now, `${id}#%`);
        })();
        reports.push({ id, url: src.url, action: 'unchanged' });
      } else {
        db.prepare(
          'UPDATE source_state SET checked_at = ?, changed = 1, changed_at = COALESCE(changed_at, ?) WHERE source_id = ?',
        ).run(now, now, id);
        reports.push({ id, url: src.url, action: 'changed', reason: 'sumber berubah sejak diverifikasi' });
      }
    } catch (e) {
      if (e instanceof RobotsBlockedError) {
        reports.push({ id, url: src.url, action: 'blocked', reason: 'robots.txt' });
      } else {
        reports.push({ id, url: src.url, action: 'error', reason: e instanceof Error ? e.name : 'galat' });
      }
    }
  }
  return reports;
}
