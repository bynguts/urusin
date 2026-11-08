import type { Db } from '../db.js';
import { reciprocalRankFusion } from '../rrf.js';
import { searchBm25 } from '../search.js';
import { loadRawVectors, rankVectors, type Embedder, type VectorEntry } from '../vector/store.js';
import { applyTransform, fitTransform, type FitOptions } from '../vector/transform.js';
import type { GoldItem } from './gold.js';
import { mrrAtK, ndcgAtK, recallAtK, type RankedHit } from './metrics.js';

/**
 * Konfigurasi pipeline retrieval yang dievaluasi. Tahap yang dinyalakan tetapi tidak punya
 * implementasi di `PipelineStages` menjadi no-op (dicatat di `notes`), sehingga eval tidak
 * bergantung pada kode tahap lain.
 */
export type RetrievalPipeline = {
  bm25?: { stemmed?: boolean };
  /** Perluasan kueri (mis. glosarium adminduk). */
  expand?: boolean;
  /** Tanpa `vector`: tabel ablasi penuh (A, B, C, D). Dengan `transform`: A + satu baris vektor itu. */
  vector?: { transform: FitOptions };
  rerank?: boolean;
};

export type StageCandidate = { id: string; text: string };

/** Implementasi tahap yang disuntikkan. Semua opsional. */
export type PipelineStages = {
  /** BM25 pengganti (mis. indeks ter-stem); mengembalikan id berurutan. */
  bm25?: (
    db: Db,
    q: { query: string; kodeKabKota?: string | undefined },
    cfg: { stemmed: boolean },
    limit: number,
  ) => string[];
  expand?: (query: string) => string;
  /** Urutkan ulang kandidat; mengembalikan id berurutan. */
  rerank?: (query: string, candidates: StageCandidate[]) => Promise<string[]>;
};

export type NamedPipeline = { name: string; config: RetrievalPipeline };

export type EvalRow = {
  mode: string;
  label: string;
  recall1: number;
  recall3: number;
  recall5: number;
  mrr10: number;
  ndcg10: number;
};

export type PipelineReport = { name: string; config: RetrievalPipeline; rows: EvalRow[]; notes: string[] };

export type EvalReport = {
  pipelines: PipelineReport[];
  questions: number;
  chunks: number;
  /** Pertanyaan yang referensi gold-nya tidak cocok dengan chunk mana pun (cek gold set). */
  tanpaChunkRelevan: string[];
  vectorsSkipped?: string;
};

type ChunkMeta = {
  id: string;
  url: string;
  text: string;
  judul: string;
  kodeWilayah: string | null;
  layanan: string | null;
};

const WHITEN_KS = [64, 128, 256];
export const BASELINE_PIPELINE: NamedPipeline = { name: 'baseline', config: {} };

export async function runEval(opts: {
  db: Db;
  gold: readonly GoldItem[];
  /** null => hanya mode A (BM25). */
  embed: Embedder | null;
  whitenKs?: readonly number[];
  pipelines?: readonly NamedPipeline[];
  stages?: PipelineStages;
}): Promise<EvalReport> {
  const { db, gold } = opts;
  const stages = opts.stages ?? {};
  const chunks = db
    .prepare('SELECT id, url, text, judul, kode_wilayah AS kodeWilayah, layanan FROM chunks ORDER BY id')
    .all() as ChunkMeta[];
  const byId = new Map(chunks.map((c) => [c.id, c]));
  const refsOf = (id: string): RankedHit => ({ refs: [id, byId.get(id)?.url ?? ''] });
  const relevantChunks = (g: GoldItem) => {
    const want = new Set(g.relevan);
    return chunks.filter((c) => want.has(c.id) || want.has(c.url)).length;
  };
  const tanpaChunkRelevan = gold.filter((g) => relevantChunks(g) === 0).map((g) => g.id);
  const report: EvalReport = {
    pipelines: [],
    questions: gold.length,
    chunks: chunks.length,
    tanpaChunkRelevan,
  };
  if (!opts.embed) report.vectorsSkipped = 'embedding tidak tersedia: hanya mode A (BM25)';

  // Vektor mentah: cache DB bila ada, selain itu embed (tidak menulis ke DB).
  let raw: Float32Array[] = [];
  let qvecs: Float32Array[] = [];
  if (opts.embed) {
    const cached = new Map(loadRawVectors(db).map((r) => [r.id, r.raw]));
    const missing = chunks.filter((c) => !cached.has(c.id));
    if (missing.length) {
      const vecs = await opts.embed(missing.map((c) => `${c.judul}\n${c.text}`));
      missing.forEach((c, i) => cached.set(c.id, vecs[i] as Float32Array));
    }
    raw = chunks.map((c) => cached.get(c.id) as Float32Array);
    qvecs = await opts.embed(gold.map((g) => g.pertanyaan));
  }

  for (const { name, config } of opts.pipelines ?? [BASELINE_PIPELINE]) {
    const notes: string[] = [];
    const stemmed = config.bm25?.stemmed === true;
    if (stemmed && !stages.bm25) notes.push('bm25.stemmed: tahap tidak tersedia, diabaikan (no-op)');
    if (config.expand && !stages.expand) notes.push('expand: tahap tidak tersedia, diabaikan (no-op)');
    if (config.rerank && !stages.rerank) notes.push('rerank: tahap tidak tersedia, diabaikan (no-op)');

    /** Peringkat id untuk satu pertanyaan: [expand] -> BM25 -> [RRF vektor] -> [rerank] -> top-10. */
    const rankFor = async (g: GoldItem, vectorIds?: readonly string[]): Promise<string[]> => {
      const query = config.expand && stages.expand ? stages.expand(g.pertanyaan) : g.pertanyaan;
      const q = { query, kodeKabKota: g.kodeWilayah };
      const bm =
        stemmed && stages.bm25
          ? stages.bm25(db, q, { stemmed: true }, 20)
          : searchBm25(db, q, 20).map((h) => h.id);
      let ids = vectorIds?.length
        ? reciprocalRankFusion([bm.map((id) => ({ id })), vectorIds.map((id) => ({ id }))]).map((f) => f.id)
        : bm;
      if (config.rerank && stages.rerank) {
        const cands = ids.slice(0, 20).flatMap((id) => {
          const c = byId.get(id);
          return c ? [{ id, text: c.text }] : [];
        });
        ids = await stages.rerank(query, cands);
      }
      return ids.slice(0, 10);
    };

    const score = async (
      mode: string,
      label: string,
      idsFor: (g: GoldItem, i: number) => Promise<string[]>,
    ): Promise<EvalRow> => {
      const s = { r1: 0, r3: 0, r5: 0, mrr: 0, ndcg: 0 };
      for (const [i, g] of gold.entries()) {
        const ranked = (await idsFor(g, i)).map(refsOf);
        s.r1 += recallAtK(ranked, g.relevan, 1);
        s.r3 += recallAtK(ranked, g.relevan, 3);
        s.r5 += recallAtK(ranked, g.relevan, 5);
        s.mrr += mrrAtK(ranked, g.relevan, 10);
        s.ndcg += ndcgAtK(ranked, g.relevan, 10, relevantChunks(g));
      }
      const n = gold.length;
      return {
        mode,
        label,
        recall1: s.r1 / n,
        recall3: s.r3 / n,
        recall5: s.r5 / n,
        mrr10: s.mrr / n,
        ndcg10: s.ndcg / n,
      };
    };

    const vectorMode = (mode: string, label: string, fit: FitOptions) => {
      const params = fitTransform(raw, fit);
      const entries: VectorEntry[] = chunks.map((c, i) => ({
        id: c.id,
        kodeWilayah: c.kodeWilayah,
        layanan: c.layanan,
        vec: applyTransform(params, raw[i] as Float32Array),
      }));
      return score(mode, label.replace('{k}', String(params.k)), (g, i) => {
        const q = applyTransform(params, qvecs[i] as Float32Array);
        return rankFor(g, rankVectors(entries, q, { kodeKabKota: g.kodeWilayah }, 20));
      });
    };

    const rows: EvalRow[] = [await score('A', 'BM25 saja', (g) => rankFor(g))];
    if (opts.embed) {
      if (config.vector) {
        const t = config.vector.transform;
        rows.push(await vectorMode('V', `BM25 + vektor ${t.mode}${t.k ? ` k={k}` : ''}`, t));
      } else {
        rows.push(await vectorMode('B', 'BM25 + vektor mentah (RRF)', { mode: 'none' }));
        rows.push(await vectorMode('C', '+ center', { mode: 'center' }));
        for (const k of opts.whitenKs ?? WHITEN_KS) {
          rows.push(await vectorMode('D', '+ whiten k={k}', { mode: 'whiten', k, shrinkage: 'auto' }));
        }
      }
    }
    report.pipelines.push({ name, config, rows, notes });
  }
  return report;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function renderMarkdown(r: EvalReport): string {
  const out: string[] = [];
  for (const p of r.pipelines) {
    out.push(`### Pipeline: ${p.name}`, '', `Konfigurasi: \`${JSON.stringify(p.config)}\``, '');
    out.push(
      '| Mode | Konfigurasi | recall@1 | recall@3 | recall@5 | MRR@10 | nDCG@10 |',
      '|---|---|---:|---:|---:|---:|---:|',
      ...p.rows.map(
        (x) =>
          `| ${x.mode} | ${x.label} | ${pct(x.recall1)} | ${pct(x.recall3)} | ${pct(x.recall5)} | ${x.mrr10.toFixed(3)} | ${x.ndcg10.toFixed(3)} |`,
      ),
      '',
    );
    for (const n of p.notes) out.push(`Catatan: ${n}.`);
    if (p.notes.length) out.push('');
  }
  const notes = [`Pertanyaan: ${r.questions}; chunk: ${r.chunks}.`];
  if (r.vectorsSkipped) notes.push(`Catatan: ${r.vectorsSkipped}.`);
  if (r.tanpaChunkRelevan.length)
    notes.push(`Peringatan: gold tanpa chunk cocok di DB: ${r.tanpaChunkRelevan.join(', ')}.`);
  return `${out.join('\n')}\n${notes.join('\n')}\n`;
}
