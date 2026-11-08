import type { Db } from '../db.js';
import { searchHybrid } from '../search.js';
import { loadRawVectors, rankVectors, type Embedder, type VectorEntry } from '../vector/store.js';
import { applyTransform, fitTransform, type FitOptions } from '../vector/transform.js';
import type { GoldItem } from './gold.js';
import { mrrAtK, ndcgAtK, recallAtK, type RankedHit } from './metrics.js';

export type EvalRow = {
  mode: string;
  label: string;
  recall1: number;
  recall3: number;
  recall5: number;
  mrr10: number;
  ndcg10: number;
};

export type EvalReport = {
  rows: EvalRow[];
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

export async function runEval(opts: {
  db: Db;
  gold: readonly GoldItem[];
  /** null => hanya mode A (BM25). */
  embed: Embedder | null;
  whitenKs?: readonly number[];
}): Promise<EvalReport> {
  const { db, gold } = opts;
  const chunks = db
    .prepare('SELECT id, url, text, judul, kode_wilayah AS kodeWilayah, layanan FROM chunks ORDER BY id')
    .all() as ChunkMeta[];
  const urlOf = new Map(chunks.map((c) => [c.id, c.url]));
  const refsOf = (id: string): RankedHit => ({ refs: [id, urlOf.get(id) ?? ''] });
  const relevantChunks = (g: GoldItem) => {
    const want = new Set(g.relevan);
    return chunks.filter((c) => want.has(c.id) || want.has(c.url)).length;
  };
  const tanpaChunkRelevan = gold.filter((g) => relevantChunks(g) === 0).map((g) => g.id);

  const score = (mode: string, label: string, idsFor: (g: GoldItem, i: number) => string[]): EvalRow => {
    const sums = { r1: 0, r3: 0, r5: 0, mrr: 0, ndcg: 0 };
    gold.forEach((g, i) => {
      const ranked = idsFor(g, i).map(refsOf);
      sums.r1 += recallAtK(ranked, g.relevan, 1);
      sums.r3 += recallAtK(ranked, g.relevan, 3);
      sums.r5 += recallAtK(ranked, g.relevan, 5);
      sums.mrr += mrrAtK(ranked, g.relevan, 10);
      sums.ndcg += ndcgAtK(ranked, g.relevan, 10, relevantChunks(g));
    });
    const n = gold.length;
    return {
      mode,
      label,
      recall1: sums.r1 / n,
      recall3: sums.r3 / n,
      recall5: sums.r5 / n,
      mrr10: sums.mrr / n,
      ndcg10: sums.ndcg / n,
    };
  };
  const hybrid = (g: GoldItem, vectorIds?: readonly string[]) =>
    searchHybrid(db, { query: g.pertanyaan, kodeKabKota: g.kodeWilayah, k: 10 }, vectorIds).map((h) => h.id);

  const rows: EvalRow[] = [score('A', 'BM25 saja', (g) => hybrid(g))];
  const report: EvalReport = { rows, questions: gold.length, chunks: chunks.length, tanpaChunkRelevan };
  if (!opts.embed) {
    report.vectorsSkipped = 'embedding tidak tersedia: hanya mode A (BM25)';
    return report;
  }

  // Vektor mentah: pakai cache DB bila lengkap, selain itu embed (tidak menulis ke DB).
  const cached = new Map(loadRawVectors(db).map((r) => [r.id, r.raw]));
  const missing = chunks.filter((c) => !cached.has(c.id));
  if (missing.length) {
    const vecs = await opts.embed(missing.map((c) => `${c.judul}\n${c.text}`));
    missing.forEach((c, i) => cached.set(c.id, vecs[i] as Float32Array));
  }
  const raw = chunks.map((c) => cached.get(c.id) as Float32Array);
  const qvecs = await opts.embed(gold.map((g) => g.pertanyaan));

  const vectorMode = (mode: string, label: string, fit: FitOptions): EvalRow => {
    const params = fitTransform(raw, fit);
    const entries: VectorEntry[] = chunks.map((c, i) => ({
      id: c.id,
      kodeWilayah: c.kodeWilayah,
      layanan: c.layanan,
      vec: applyTransform(params, raw[i] as Float32Array),
    }));
    return score(mode, label.replace('{k}', String(params.k)), (g, i) => {
      const q = applyTransform(params, qvecs[i] as Float32Array);
      const ids = rankVectors(entries, q, { kodeKabKota: g.kodeWilayah }, 20);
      return hybrid(g, ids);
    });
  };

  rows.push(vectorMode('B', 'BM25 + vektor mentah (RRF)', { mode: 'none' }));
  rows.push(vectorMode('C', '+ center', { mode: 'center' }));
  for (const k of opts.whitenKs ?? WHITEN_KS) {
    rows.push(vectorMode('D', `+ whiten k={k}`, { mode: 'whiten', k, shrinkage: 'auto' }));
  }
  return report;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function renderMarkdown(r: EvalReport): string {
  const lines = [
    '| Mode | Konfigurasi | recall@1 | recall@3 | recall@5 | MRR@10 | nDCG@10 |',
    '|---|---|---:|---:|---:|---:|---:|',
    ...r.rows.map(
      (x) =>
        `| ${x.mode} | ${x.label} | ${pct(x.recall1)} | ${pct(x.recall3)} | ${pct(x.recall5)} | ${x.mrr10.toFixed(3)} | ${x.ndcg10.toFixed(3)} |`,
    ),
  ];
  const notes = [`Pertanyaan: ${r.questions}; chunk: ${r.chunks}.`];
  if (r.vectorsSkipped) notes.push(`Catatan: ${r.vectorsSkipped}.`);
  if (r.tanpaChunkRelevan.length)
    notes.push(`Peringatan: gold tanpa chunk cocok di DB: ${r.tanpaChunkRelevan.join(', ')}.`);
  return `${lines.join('\n')}\n\n${notes.join('\n')}\n`;
}
