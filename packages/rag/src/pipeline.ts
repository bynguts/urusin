import type { Db } from './db.js';
import type { RetrievalPipeline } from './eval/run.js';
import { defaultGlossary, expandQuery, type Glossary } from './glossary.js';
import { placeTokens } from './place-names.js';
import { safeRewrite, type QueryRewriter } from './llm-stage.js';
import { rerankHits, type RerankDeps, type RerankStatus } from './rerank.js';
import type { RetrievalDebug } from './schema.js';
import { outOfScopeNoun } from './out-of-scope.js';
import { toHit, type Hit, type Row, type SearchOptions } from './search.js';
import { isStopword, rawTokens, stemToken, stemTokens } from './stem/stem.js';
import { GENERIC_QUERY_WORDS } from './stem/stopwords.js';

/**
 * Tipe konfigurasi dimiliki `eval/run.ts` (dipakai juga oleh rag:eval): `bm25.stemmed`, `expand`,
 * `vector` dan `rerank`. Di sisi kueri, `vector` tidak mengubah apa pun (transformasi vektor
 * dipasang saat ingest); leg vektor aktif bila pemanggil memberi `vectorIds`. Opsi runtime tambahan
 * (bobot perluasan, top-N rerank, tulis ulang LLM) ada di `RetrievalDeps`.
 */
export type { RetrievalPipeline };

/** Bawaan terbaik: BM25 ter-stem + perluasan glosarium + rerank bila disuntikkan (+ vektor bila ada). */
export const DEFAULT_PIPELINE: RetrievalPipeline = {
  bm25: { stemmed: true },
  expand: true,
  rerank: true,
};

export type RetrievalDeps = {
  glossary?: Glossary | null | undefined;
  /** Id chunk berurutan dari leg vektor (sudah difilter wilayah oleh pemanggil). */
  vectorIds?: readonly string[] | undefined;
  /** false = abaikan `vectorIds`. Default true. */
  useVector?: boolean | undefined;
  /** Bobot leg perluasan terhadap kata asli (default 0.4). */
  expandWeight?: number | undefined;
  /** Ambang cakupan abstain (default 0.1, atau env RAG_ABSTAIN_MIN_COVERAGE; 0 = mati). Lihat DEFAULT_MIN_COVERAGE. */
  minCoverage?: number | undefined;
  /**
   * Lantai skor rerank endpoint: skor hasil teratas di bawahnya = abstain (di_luar_cakupan). Tanpa nilai atau
   * tanpa endpoint (LLM/fallback tidak punya skor) gerbang ini tidak aktif. Env RAG_ABSTAIN_MIN_RERANK_SCORE.
   */
  minRerankScore?: number | undefined;
  /** Top-N kandidat untuk rerank (default 20). */
  rerankTopN?: number | undefined;
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

function expandCfg(p: RetrievalPipeline, deps: RetrievalDeps): { on: boolean; weight: number } {
  return { on: Boolean(p.expand), weight: deps.expandWeight ?? DEFAULT_EXPAND_WEIGHT };
}

/** Pecah teks ter-stem jadi himpunan token (termasuk bagian sebelum/sesudah '-' dan '.'). */
function tokenSet(text: string): Set<string> {
  const out = new Set<string>();
  for (const t of text.split(/\s+/)) {
    if (!t) continue;
    out.add(t);
    for (const part of t.split(/[-.]/)) if (part) out.add(part);
  }
  return out;
}

/**
 * Cakupan: jumlah bobot IDF token kueri (ter-stem, tanpa stopword, di luar yang dijelaskan glosarium)
 * yang muncul pada satu hasil teratas, dibagi bobot semua token; diambil maksimum atas hasil.
 * Token yang tak ada di korpus mana pun bobotnya paling besar, sehingga kueri seperti "cara daftar CPNS"
 * (hanya kata umum yang cocok) berskor rendah. Tanpa token bermakna -> 1.
 */
function coverageOf(
  db: Db,
  query: string,
  top: readonly Hit[],
  explained: readonly string[],
  rewriteTerms: readonly string[],
  expandTokens: readonly string[],
): number {
  // Bila tulis-ulang LLM aktif, istilah hasil tulis-ulang yang dinilai (kata awam asli tak dikenal korpus).
  const source = rewriteTerms.length ? rewriteTerms.join(' ') : query;
  const explainedSet = new Set(rewriteTerms.length ? [] : explained);
  const skip = new Set([...placeTokens(), ...[...GENERIC_QUERY_WORDS].map(stemToken)]);
  const toks = [...new Set(stemTokens(source))].filter((t) => !skip.has(t));
  if (toks.length === 0) return 1;
  const n = (db.prepare('SELECT COUNT(*) AS n FROM chunks').get() as { n: number }).n;
  const dfStmt = db.prepare('SELECT COUNT(*) AS n FROM chunks_stem_fts WHERE chunks_stem_fts MATCH ?');
  const idf = toks.map((t) => {
    const df = (dfStmt.get('"' + t.replace(/"/g, '') + '"') as { n: number }).n;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  });
  const total = idf.reduce((a, b) => a + b, 0);
  if (total <= 0) return 1;
  const rowStmt = db.prepare(
    `SELECT s.judul || ' ' || s.text || ' ' || s.instansi || ' ' || COALESCE(s.ctx, '') AS doc
     FROM chunks c JOIN chunks_stem_fts s ON s.rowid = c.rowid WHERE c.id = ?`,
  );
  let best = 0;
  for (const h of top) {
    const row = rowStmt.get(h.id) as { doc: string } | undefined;
    if (!row) continue;
    const set = tokenSet(row.doc);
    // Token yang dijelaskan glosarium dihitung tercakup bila hasil memuat istilah resminya.
    const viaGlossary = expandTokens.some((t) => set.has(t));
    const got = toks.reduce(
      (acc, t, i) => acc + (set.has(t) || (viaGlossary && explainedSet.has(t)) ? (idf[i] as number) : 0),
      0,
    );
    best = Math.max(best, got / total);
  }
  return best;
}

/** Env `RAG_ABSTAIN_MIN_COVERAGE` (0..1) menimpa bawaan; nilai tak valid diabaikan. */
function envMinCoverage(): number | undefined {
  const raw = process.env['RAG_ABSTAIN_MIN_COVERAGE'];
  if (raw === undefined || raw.trim() === '') return undefined;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : undefined;
}

/** Env `RAG_ABSTAIN_MIN_RERANK_SCORE` (angka apa pun; skala tergantung model rerank). */
function envMinRerankScore(): number | undefined {
  const raw = process.env['RAG_ABSTAIN_MIN_RERANK_SCORE'];
  if (raw === undefined || raw.trim() === '') return undefined;
  const v = Number(raw);
  return Number.isFinite(v) ? v : undefined;
}

export type AbstainReason = 'di_luar_cakupan' | 'skor_rendah';

/**
 * Ambang abstain default: cakupan (0..1) kata kueri yang bermakna pada 3 hasil teratas; 0 mematikan gerbang.
 * Dikalibrasi pada korpus nyata (data/gold/tuning.json): 0.1 tidak menurunkan recall@3 dan menahan
 * abstain-precision 100%; 0.3 (bawaan awal, korpus sintetis) menurunkan recall@3 5 poin. Lihat README.
 */
export const DEFAULT_MIN_COVERAGE = 0.1;

export type SyncResult = {
  hits: Hit[];
  /** Cakupan IDF-berbobot kata kueri pada top-3 (null bila tidak dihitung). */
  coverage: number | null;
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
  const stemmed = pipeline.bm25?.stemmed === true;
  const exp = expandCfg(pipeline, deps);
  const glossary = deps.glossary === undefined ? defaultGlossary() : deps.glossary;
  const expansion = exp.on ? expandQuery(opts.query, glossary) : { terms: [], matched: [], explained: [] };
  const expandTerms = [...new Set([...expansion.terms, ...extraTerms])];
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
    const terms = stemmed
      ? [...new Set(expandTerms.map((e) => stemTokens(e).join(' ')).filter(Boolean))]
      : expandTerms;
    legs.push({ hits: leg(db, table, terms, opts, LEG_LIMIT), weight: exp.weight });
  }
  const useVector = deps.useVector !== false && (deps.vectorIds?.length ?? 0) > 0;
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

  // Layanan luar cakupan yang disebut eksplisit (SIM, SKCK, ...) dan tidak ada di judul chunk mana pun:
  // cakupan dipaksa 0 sehingga gerbang abstain menjawab di_luar_cakupan.
  const oosNoun = outOfScopeNoun(db, opts.query);
  const coverage = oosNoun
    ? 0
    : hits.length
      ? coverageOf(db, opts.query, hits.slice(0, 3), expansion.explained, extraTerms, [
          ...new Set(expansion.terms.flatMap((e) => stemTokens(e))),
        ])
      : null;
  return {
    hits,
    coverage,
    usedVector: useVector,
    timings: { expand: ms(t0, t1), bm25: ms(t1, t2), fuse: ms(t2, t3) },
    glossaryMatched: expansion.matched,
    expandedTerms: expandTerms.length,
  };
}

export type RetrievalResult = {
  hits: Hit[];
  /** Terisi bila pipeline memilih abstain (hits kosong): hand-off ke kanal resmi. */
  alasan?: AbstainReason | undefined;
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
      stemmed: p.bm25?.stemmed === true,
      expand: Boolean(p.expand),
      vector: s.usedVector,
      rerank: Boolean(p.rerank),
    },
    timingsMs: { ...s.timings, rerank: extra.rerank, total: extra.total },
    candidates: extra.candidates,
    glossaryMatched: s.glossaryMatched,
    expandedTerms: s.expandedTerms,
    coverage: s.coverage === null ? null : Math.round(s.coverage * 1000) / 1000,
    rerankStatus: extra.rerankStatus,
    rewriteStatus: extra.rewriteStatus,
  };
}

/** Abstain bila tak ada hasil, atau cakupan leksikal top-3 hasil fusi di bawah ambang. */
function abstainOf(s: SyncResult, deps: RetrievalDeps): AbstainReason | undefined {
  if (s.hits.length === 0) return 'di_luar_cakupan';
  const min = deps.minCoverage ?? envMinCoverage() ?? DEFAULT_MIN_COVERAGE;
  // Cakupan leksikal dihitung pada top-3 hasil FUSI, jadi gerbang berlaku juga di mode hybrid.
  if (min <= 0 || s.coverage === null || s.coverage >= min) return undefined;
  return s.coverage === 0 ? 'di_luar_cakupan' : 'skor_rendah';
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
  const alasan = abstainOf(s, deps);
  const hits = alasan ? [] : s.hits.slice(0, k);
  return {
    hits,
    alasan,
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
  const exp = expandCfg(pipeline, deps);

  let extra: string[] = [];
  let rewriteStatus: RetrievalDebug['rewriteStatus'] = 'off';
  if (exp.on && deps.rewrite) {
    const r = await safeRewrite(opts.query, deps.rewrite, deps.rewriteTimeoutMs);
    extra = r.terms;
    rewriteStatus = r.status;
  }

  const rr = pipeline.rerank;
  const topN = rr ? Math.max(k, deps.rerankTopN ?? DEFAULT_TOP_N) : k;
  const s = retrieveSync(db, opts, pipeline, topN, deps, extra);

  const alasan = abstainOf(s, deps);
  let hits = alasan ? [] : s.hits.slice(0, k);
  let rerankStatus: RerankStatus = 'off';
  const t1 = performance.now();
  if (!alasan && rr && deps.rerank) {
    const r = await rerankHits(opts.query, s.hits, k, deps.rerank);
    hits = r.hits;
    rerankStatus = r.status;
    const floor = deps.minRerankScore ?? envMinRerankScore();
    const top = r.hits[0]?.skor;
    if (r.status === 'endpoint' && floor !== undefined && top !== undefined && top < floor) {
      return {
        hits: [],
        alasan: 'di_luar_cakupan',
        mode: s.usedVector ? 'hybrid' : 'bm25',
        debug: debugOf(pipeline, s, {
          rerank: ms(t1, performance.now()),
          total: ms(t0, performance.now()),
          rerankStatus: r.status,
          rewriteStatus,
          candidates: s.hits.length,
        }),
      };
    }
  }
  const t2 = performance.now();

  return {
    hits,
    alasan,
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
