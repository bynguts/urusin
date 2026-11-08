import type { Db } from '../db.js';
import { upsertChunks } from '../store.js';
import { chunkByHeading } from './chunk.js';
import { htmlToText } from './extract.js';
import { PoliteFetcher, RobotsBlockedError, type Deps } from './fetcher.js';
import type { SourceEntry } from './sources.js';

export type IngestAction = 'planned' | 'ingested' | 'skipped' | 'blocked' | 'error';
export type IngestReport = {
  id: string;
  url: string;
  action: IngestAction;
  chunks?: number;
  reason?: string;
};

export type IngestOptions = {
  sources: readonly SourceEntry[];
  only?: string | undefined;
  /** true = tanpa jaringan dan tanpa tulis DB; hanya menampilkan rencana. */
  dryRun: boolean;
  db?: Db | undefined;
  deps?: Deps | undefined;
  minIntervalMs?: number | undefined;
};

function skipReason(s: SourceEntry): string | null {
  if (s.status !== 'confirmed') return 'unverified';
  if (!s.ingest) return 'bukan-sumber-korpus';
  if (s.jenis === 'pdf') return 'pdf-belum-didukung';
  return null;
}

export async function runIngest(opts: IngestOptions): Promise<IngestReport[]> {
  const selected = opts.only ? opts.sources.filter((s) => s.id === opts.only) : [...opts.sources];
  if (opts.only && selected.length === 0) throw new Error(`Sumber tidak ditemukan: ${opts.only}`);

  const reports: IngestReport[] = [];
  let fetcher: PoliteFetcher | null = null;
  if (!opts.dryRun) {
    if (!opts.db) throw new Error('db wajib bila bukan dry-run');
    const deps: Deps = opts.deps ?? {
      fetch: (url, init) => fetch(url, init),
      now: () => Date.now(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    };
    fetcher = new PoliteFetcher(deps, opts.minIntervalMs);
  }
  const nowIso = () => new Date((opts.deps?.now ?? Date.now)()).toISOString();

  for (const s of selected) {
    const reason = skipReason(s);
    if (reason) {
      reports.push({ id: s.id, url: s.url, action: 'skipped', reason });
      continue;
    }
    if (!fetcher || !opts.db) {
      reports.push({ id: s.id, url: s.url, action: 'planned' });
      continue;
    }
    try {
      const res = await fetcher.get(s.url);
      if (res.status !== 200) {
        reports.push({ id: s.id, url: s.url, action: 'error', reason: `HTTP ${res.status}` });
        continue;
      }
      if (!/text\/(html|plain)|application\/xhtml/i.test(res.contentType)) {
        reports.push({ id: s.id, url: s.url, action: 'skipped', reason: 'tipe-konten-tidak-didukung' });
        continue;
      }
      const verifiedAt = nowIso();
      const pieces = chunkByHeading(htmlToText(res.body));
      const chunks = pieces.map((p, i) => ({
        id: `${s.id}#${i}`,
        text: p.text,
        sourceRef: {
          url: s.url,
          judul: p.heading ? `${s.judul} - ${p.heading}`.slice(0, 300) : s.judul,
          instansi: s.instansi,
        },
        verifiedAt,
        ...(s.kodeWilayah ? { kodeWilayah: s.kodeWilayah } : {}),
        ...(s.layanan ? { layanan: s.layanan } : {}),
      }));
      const db = opts.db;
      db.transaction(() => {
        db.prepare('DELETE FROM chunks WHERE id LIKE ?').run(`${s.id}#%`);
        upsertChunks(db, chunks);
      })();
      reports.push({ id: s.id, url: s.url, action: 'ingested', chunks: chunks.length });
    } catch (e) {
      if (e instanceof RobotsBlockedError) {
        reports.push({ id: s.id, url: s.url, action: 'blocked', reason: 'robots.txt' });
      } else {
        reports.push({
          id: s.id,
          url: s.url,
          action: 'error',
          reason: e instanceof Error ? e.name : 'galat',
        });
      }
    }
  }
  return reports;
}
