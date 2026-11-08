import type { Db } from './db.js';
import { defaultGlossary, expandQuery, type Glossary } from './glossary.js';
import { safeRewrite, type QueryRewriter } from './llm-stage.js';
import { rerankHits, type RerankDeps, type RerankStatus } from './rerank.js';
import type { RetrievalDebug } from './schema.js';
import { toHit, type Hit, type Row, type SearchOptions } from './search.js';
import { isStopword, rawTokens, stemTokens } from './stem/stem.js';

/**
 * Konfigurasi pipeline retrieval; bentuknya dipakai juga oleh `rag:eval` (ablasi) di cabang vektor.
 * Setiap tahap bisa dimatikan; tahap yang tak tersedia (tanpa vektor, tanpa reranker) turun sendiri.
 */
export type RetrievalPipeline = {
  bm25: {
    /** Tambah leg BM25 atas kolom ter-stem (selain leg teks asli). Default true. */
    stemmed?: boolean | undefined;
  };
  /** true = glosarium; `weight` = bobot RRF leg perluasan (default 0.4); `llm` = tulis ulang via LLM. */
  expand?: boolean | { weight?: number | undefined; llm?: boolean | undefined } | undefined;
  /** Leg vektor memakai `vectorIds` dari pemanggil; bentuk rinci dimiliki cabang vector-transform. */
  vector?: boolean | Record<string, unknown> | undefined;
  /** true atau `{topN}`: rerank top-N (default 20) hasil fusi menjadi top-k. */
  rerank?: boolean | { topN?: number | undefined } | undefined;
};

export const DEFAULT_PIPELINE: RetrievalPipeline = {
  bm25: { stemmed: true },
  expand: true,
  vector: true,
  rerank: true,
};

export type RetrievalDeps = {
  glossary?: Glossary | null | undefined;
  /** Id chunk berurutan dari leg vektor (sudah difilter wilayah oleh pemanggil). */
  vectorIds?: readonly string[] | undefined;
  rerank?: RerankDeps | undefined;
  rewrite?: QueryRewriter | undefined;
  rewriteTimeoutMs?: number | undefined;
};

const LEG_LIMIT = 30;
const DEFAULT_EXPAND_WEIGHT = 0.4;
const DEFAULT_TOP_N = 20;

type Table = 'chunks_fts' | 'chunks_stem_fts';

function matchExpr(terms: readonly string[]): string | null {
  const uniq = [...new Set(terms.map((t) => t.replace(/"/g, '').trim()).filter(Boolean))];
  return uniq.length ? uniq.map((t) => `"${t}"`).join(' OR ') : null;
}

function leg(db: Db, table: Table, terms: readonly string[], opts: SearchOptions, limit: number): Hit[] {
  const match = matchExpr(terms);
  if (!match) return [];
  const wilayah = opts.kodeKabKota ? [opts.kodeKabKota, opts.kodeKabKota.slice(0, 2)] : [];
  const marks = wilayah.map(() => '?').join(',');
  const sql = `
    SELECT c.id, c.text, c.judul, c.instansi, c.url, c.verified_at, c.kode_wilayah, c.layanan,
           bm25(${table}, 5.0, 1.0, 0.5, 0.7) AS skor
    FROM ${table} JOIN chunks c ON c.rowid = ${table}.rowid
    WHERE ${table} MATCH ?
      AND (c.kode_wilayah IS NULL${wilayah.length ? ` OR c.kode_wilayah IN (${marks})` : ''})
      ${opts.layanan ? 'AND c.layanan = ?' : ''}
    ORDER BY skor LIMIT ?`;
  const params: (string | number)[] = [match, ...wilayah];
  if (opts.layanan) params.push(opts.layanan);
  params.push(limit);
  return (db.prepare(sql).all(...params) as Row[]).map(toHit);
}

/** Token kueri asli tanpa stopword (jatuh ke semua token bila semuanya stopword). */
function exactTerms(query: string): string[] {
  const toks = rawTokens(query)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length >= 2);
  const kept = toks.filter((t) => !isStopword(t));
  return kept.length ? kept : toks;
}

type WeightedLeg = { hits: readonly { id: string }[]; weight: number };

/**
 * Gabung leg teks berdasarkan SKOR BM25 yang dinormalisasi (skor / skor tertinggi leg), dijumlah
 * berbobot. Berbeda dari RRF berbasis peringkat, istilah perluasan (bobot rendah) tidak bisa
 * mengalahkan dokumen yang cocok kuat dengan kata asli hanya karena peringkatnya 1 di legnya sendiri.
 */
export function combineScores(legs: readonly { hits: readonly Hit[]; weight: number }[]): Hit[] {
  const total = new Map<string, number>();
  const byId = new Map<string, Hit>();
  for (const { hits, weight } of legs) {
    const max = hits.reduce((m, h) => Math.max(m, h.skor), 0);
    hits.forEach((h, i) => {
      const norm = max > 0 ? h.skor / max : 1 / (i + 1);
      total.set(h.id, (total.get(h.id) ?? 0) + weight * norm);
      if (!byId.has(h.id)) byId.set(h.id, h);
    });
  }
  return [...total.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id, skor]) => ({ ...byId.get(id)!, skor }));
}

/** RRF berbobot: skor = sum weight / (k + rank); dipakai untuk menggabung leg teks dengan leg vektor. */
export function weightedRrf(legs: readonly WeightedLeg[], k = 60): { id: string; skor: number }[] {
  const score = new Map<string, number>();
  for (const { hits, weight } of legs)
    hits.forEach((h, i) => score.set(h.id, (score.get(h.id) ?? 0) + weight / (k + i + 1)));
  return [...score.entries()]
    .map(([id, skor]) => ({ id, skor }))
    .sort((a, b) => b.skor - a.skor || a.id.localeCompare(b.id));
}

function hydrate(db: Db, ids: readonly string[]): Map<string, Hit> {
  if (ids.length === 0) return new Map();
  const rows = db
    .prepare(
      `SELECT id, text, judul, instansi, url, verified_at, kode_wilayah, layanan, 0 AS skor FROM chunks WHERE id IN (${ids.map(() => '?').join(',')})`,
    )
    .all(...ids) as Row[];
  return new Map(rows.map((r) => [r.id, toHit(r)]));
}

const ms = (a: number, b: number) => Math.round((b - a) * 100) / 100;

function expandCfg(p: RetrievalPipeline): { on: boolean; weight: number; llm: boolean } {
  const e = p.expand;
  if (!e) return { on: false, weight: 0, llm: false };
  if (e === true) return { on: true, weight: DEFAULT_EXPAND_WEIGHT, llm: false };
  return { on: true, weight: e.weight ?? DEFAULT_EXPAND_WEIGHT, llm: e.llm ?? false };
}

export type SyncResult = {
  hits: Hit[];
  usedVector: boolean;
  timings: { expand: number; bm25: number; fuse: number };
  glossaryMatched: string[];
  expandedTerms: number;
};

/**
 * Inti sinkron: leg teks asli (+ leg ter-stem) + leg perluasan (bobot rendah) + leg vektor, difusi
 * dengan RRF berbobot. `extraTerms` = istilah tambahan (mis. hasil tulis-ulang LLM) yang diperlakukan
 * sebagai perluasan.
 */
export function retrieveSync(
  db: Db,
  opts: SearchOptions,
  pipeline: RetrievalPipeline,
  limit: number,
  deps: RetrievalDeps = {},
  extraTerms: readonly string[] = [],
): SyncResult {
  const t0 = performance.now();
  const stemmed = pipeline.bm25.stemmed ?? true;
  const exp = expandCfg(pipeline);
  const glossary = deps.glossary === undefined ? defaultGlossary() : deps.glossary;
  const expansion = exp.on ? expandQuery(opts.query, glossary) : { terms: [], matched: [] };
  const expandTerms = exp.on ? [...new Set([...expansion.terms, ...extraTerms])] : [];
  const t1 = performance.now();

  const legs: { hits: Hit[]; weight: number }[] = [];
  const origExact = exactTerms(opts.query);
  legs.push({ hits: leg(db, 'chunks_fts', origExact, opts, LEG_LIMIT), weight: 1 });
  if (stemmed) {
    const stems = [...new Set(stemTokens(opts.query))];
    legs.push({ hits: leg(db, 'chunks_stem_fts', stems, opts, LEG_LIMIT), weight: 1 });
  }
  if (expandTerms.length) {
    const table: Table = stemmed ? 'chunks_stem_fts' : 'chunks_fts';
    const terms = stemmed ? [...new Set(stemTokens(expandTerms.join(' ')))] : expandTerms;
    legs.push({ hits: leg(db, table, terms, opts, LEG_LIMIT), weight: exp.weight });
  }
  const useVector = Boolean(pipeline.vector) && (deps.vectorIds?.length ?? 0) > 0;
  const t2 = performance.now();

  const textRanked = combineScores(legs);
  const fused = (
    useVector
      ? weightedRrf([
          { hits: textRanked, weight: 1 },
          { hits: (deps.vectorIds ?? []).map((id) => ({ id })), weight: 1 },
        ])
      : textRanked.map((h) => ({ id: h.id, skor: h.skor }))
  ).slice(0, limit);
  const known = new Map<string, Hit>(textRanked.map((h) => [h.id, h]));
  for (const [id, h] of hydrate(
    db,
    fused.map((f) => f.id).filter((id) => !known.has(id)),
  ))
    known.set(id, h);
  const hits = fused.flatMap((f) => {
    const h = known.get(f.id);
    return h ? [{ ...h, skor: f.skor }] : [];
  });
  const t3 = performance.now();

  return {
    hits,
    usedVector: useVector,
    timings: { expand: ms(t0, t1), bm25: ms(t1, t2), fuse: ms(t2, t3) },
    glossaryMatched: expansion.matched,
    expandedTerms: expandTerms.length,
  };
}

export type RetrievalResult = {
  hits: Hit[];
  mode: 'bm25' | 'hybrid';
  debug: RetrievalDebug;
};

function debugOf(
  p: RetrievalPipeline,
  s: SyncResult,
  extra: {
    rerank: number;
    total: number;
    rerankStatus: RerankStatus;
    rewriteStatus: RetrievalDebug['rewriteStatus'];
    candidates: number;
  },
): RetrievalDebug {
  return {
    pipeline: {
      stemmed: p.bm25.stemmed ?? true,
      expand: expandCfg(p).on,
      vector: s.usedVector,
      rerank: Boolean(p.rerank),
    },
    timingsMs: { ...s.timings, rerank: extra.rerank, total: extra.total },
    candidates: extra.candidates,
    glossaryMatched: s.glossaryMatched,
    expandedTerms: s.expandedTerms,
    rerankStatus: extra.rerankStatus,
    rewriteStatus: extra.rewriteStatus,
  };
}

/** Versi sinkron (tanpa LLM): stem + perluasan glosarium + vektor bila ada. */
export function retrieveSyncFull(
  db: Db,
  opts: SearchOptions,
  pipeline: RetrievalPipeline = DEFAULT_PIPELINE,
  deps: RetrievalDeps = {},
): RetrievalResult {
  const k = opts.k ?? 6;
  const t0 = performance.now();
  const s = retrieveSync(db, opts, pipeline, k, deps);
  const hits = s.hits.slice(0, k);
  return {
    hits,
    mode: s.usedVector ? 'hybrid' : 'bm25',
    debug: debugOf(pipeline, s, {
      rerank: 0,
      total: ms(t0, performance.now()),
      rerankStatus: 'off',
      rewriteStatus: 'off',
      candidates: s.hits.length,
    }),
  };
}

/** Pipeline lengkap: tulis-ulang LLM (opsional) -> retrieval sinkron -> rerank top-N menjadi top-k. */
export async function retrieve(
  db: Db,
  opts: SearchOptions,
  pipeline: RetrievalPipeline = DEFAULT_PIPELINE,
  deps: RetrievalDeps = {},
): Promise<RetrievalResult> {
  const k = opts.k ?? 6;
  const t0 = performance.now();
  const exp = expandCfg(pipeline);

  let extra: string[] = [];
  let rewriteStatus: RetrievalDebug['rewriteStatus'] = 'off';
  if (exp.on && exp.llm && deps.rewrite) {
    const r = await safeRewrite(opts.query, deps.rewrite, deps.rewriteTimeoutMs);
    extra = r.terms;
    rewriteStatus = r.status;
  }

  const rr = pipeline.rerank;
  const topN = rr ? Math.max(k, (typeof rr === 'object' ? rr.topN : undefined) ?? DEFAULT_TOP_N) : k;
  const s = retrieveSync(db, opts, pipeline, topN, deps, extra);

  let hits = s.hits.slice(0, k);
  let rerankStatus: RerankStatus = 'off';
  const t1 = performance.now();
  if (rr && deps.rerank) {
    const r = await rerankHits(opts.query, s.hits, k, deps.rerank);
    hits = r.hits;
    rerankStatus = r.status;
  }
  const t2 = performance.now();

  return {
    hits,
    mode: s.usedVector ? 'hybrid' : 'bm25',
    debug: debugOf(pipeline, s, {
      rerank: ms(t1, t2),
      total: ms(t0, t2),
      rerankStatus,
      rewriteStatus,
      candidates: s.hits.length,
    }),
  };
}
