import { ingestEgressFetch } from '@urusin/egress';
import type { Db } from '../db.js';
import { embedAndFit } from '../vector/pipeline.js';
import type { Embedder } from '../vector/store.js';
import type { TransformMode } from '../vector/transform.js';
import { upsertChunks } from '../store.js';
import { klampidChunkText, klampidEndpoint, klampidKey, klampidHash, sanitizeKlampid } from './klampid.js';
import { contentHash, recordSourceState } from './state.js';
import { chunkByHeading, dropBoilerplate } from './chunk.js';
import { buildChunkContextHeader } from './context.js';
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
  /** Embedding opsional. Tanpa ini ingest murni BM25 (tabel vektor tidak disentuh). */
  embed?: Embedder | undefined;
  embedModel?: string | undefined;
  /** Mode transformasi vektor; default 'none'. Dipilih berdasarkan hasil rag:eval. */
  vectorMode?: TransformMode | undefined;
  vectorK?: number | undefined;
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
      fetch: ingestEgressFetch,
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
      const res = await fetcher.get(s.adapter === 'klampid' ? klampidEndpoint(s.url) : s.url);
      if (res.status !== 200) {
        reports.push({ id: s.id, url: s.url, action: 'error', reason: `HTTP ${res.status}` });
        continue;
      }
      const okType =
        s.adapter === 'klampid'
          ? /json/i.test(res.contentType)
          : /text\/(html|plain)|application\/xhtml/i.test(res.contentType);
      if (!okType) {
        reports.push({ id: s.id, url: s.url, action: 'skipped', reason: 'tipe-konten-tidak-didukung' });
        continue;
      }
      const verifiedAt = nowIso();
      const services = s.adapter === 'klampid' ? sanitizeKlampid(JSON.parse(res.body)) : null;
      const pieces = services
        ? services.map((x) => ({ ...klampidChunkText(x), key: klampidKey(x) }))
        : dropBoilerplate(chunkByHeading(htmlToText(res.body)));
      const chunks = pieces.map((p, i) => ({
        id: `${s.id}#${'key' in p ? p.key : i}`,
        text: p.text,
        sourceRef: {
          url: s.url,
          judul: p.heading ? `${s.judul} - ${p.heading}`.slice(0, 300) : s.judul,
          instansi: s.instansi,
        },
        verifiedAt,
        contextHeader: buildChunkContextHeader({
          judulHalaman: s.judul,
          heading: p.heading,
          instansi: s.instansi,
          layanan: s.layanan ?? undefined,
        }),
        ...(s.kodeWilayah ? { kodeWilayah: s.kodeWilayah } : {}),
        ...(s.layanan ? { layanan: s.layanan } : {}),
      }));
      const db = opts.db;
      db.transaction(() => {
        db.prepare('DELETE FROM chunks WHERE id LIKE ?').run(`${s.id}#%`);
        upsertChunks(db, chunks, { requireVerified: true });
        recordSourceState(db, s.id, {
          etag: res.etag,
          lastModified: res.lastModified,
          hash: services ? klampidHash(services) : contentHash(res.body),
          at: verifiedAt,
        });
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
  if (opts.embed && opts.db && !opts.dryRun) reports.push(await fitAndStoreTransform(opts.db, opts));
  return reports;
}

/** Tahap vektor ingest (satu-satunya titik sentuh): embed semua chunk, fit transform, simpan. Gagal => dilewati, BM25 utuh. */
export async function fitAndStoreTransform(
  db: Db,
  opts: Pick<IngestOptions, 'embed' | 'embedModel' | 'vectorMode' | 'vectorK'>,
): Promise<IngestReport> {
  if (!opts.embed) return { id: 'vektor', url: '-', action: 'skipped', reason: 'tanpa-embedding' };
  try {
    const r = await embedAndFit(db, opts.embed, {
      mode: opts.vectorMode ?? 'none',
      k: opts.vectorK,
      model: opts.embedModel,
    });
    return {
      id: 'vektor',
      url: '-',
      action: 'ingested',
      chunks: r.chunks,
      reason: `mode=${r.mode} k=${r.k} v${r.version}`,
    };
  } catch (e) {
    // Embedding gagal tidak boleh merusak korpus: tetap BM25.
    return {
      id: 'vektor',
      url: '-',
      action: 'skipped',
      reason: `embedding-gagal: ${e instanceof Error ? e.name : 'galat'}`,
    };
  }
}
