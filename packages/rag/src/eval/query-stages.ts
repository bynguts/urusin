import { expandQuery, type Glossary } from '../glossary.js';
import { retrieveSync } from '../pipeline.js';
import { rerankHits, type RerankDeps } from '../rerank.js';
import type { Hit } from '../search.js';
import type { PipelineStages } from './run.js';

/** Pemisah antara kueri asli dan istilah perluasan di string hasil `expand` (hook eval hanya lewat string). */
const MARK = ' \u241E ';

export type QueryStageOptions = {
  /** undefined = glosarium bawaan; null = tanpa perluasan. */
  glossary?: Glossary | null | undefined;
  /** Tanpa ini tahap rerank tidak disediakan (no-op, tercatat di notes eval). */
  rerank?: RerankDeps | undefined;
  expandWeight?: number | undefined;
};

/**
 * Hook tahap kueri untuk `runEval`: BM25 ter-stem (leg asli + leg stem), perluasan glosarium
 * (bobot rendah, identik dengan produksi) dan rerank. Dipakai CLI `rag:eval` dan tes ablasi.
 */
export function createQueryStages(opts: QueryStageOptions = {}): PipelineStages {
  const stages: PipelineStages = {
    expand(query) {
      const { terms } = expandQuery(query, opts.glossary);
      return terms.length ? `${query}${MARK}${terms.join(' | ')}` : query;
    },
    bm25(db, q, cfg, limit) {
      const [query = '', rest] = q.query.split(MARK);
      const extra = rest ? rest.split(' | ') : [];
      return retrieveSync(
        db,
        { query, kodeKabKota: q.kodeKabKota },
        { bm25: { stemmed: cfg.stemmed } },
        limit,
        { glossary: null, expandWeight: opts.expandWeight },
        extra,
      ).hits.map((h) => h.id);
    },
  };
  const rerankDeps = opts.rerank;
  if (rerankDeps) {
    stages.rerank = async (query, candidates) => {
      const hits: Hit[] = candidates.map((c) => ({
        id: c.id,
        text: c.text,
        skor: 0,
        kutipan: { url: 'https://eval.invalid', judul: c.id, instansi: 'eval' },
        verifiedAt: null,
        kodeWilayah: null,
        layanan: null,
      }));
      const r = await rerankHits(query.split(MARK)[0] ?? query, hits, hits.length, rerankDeps);
      return r.hits.map((h) => h.id);
    };
  }
  return stages;
}
