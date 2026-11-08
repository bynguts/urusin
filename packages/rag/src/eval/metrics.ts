/**
 * Metrik retrieval. `ranked` = daftar kunci hasil berurutan (satu kunci per hasil; hasil boleh
 * memetakan ke beberapa referensi relevan lewat `refsOf`). `relevan` = referensi gold (id atau url).
 */
export type RankedHit = { refs: readonly string[] };

const isRel = (h: RankedHit, rel: ReadonlySet<string>) => h.refs.some((r) => rel.has(r));

/** Recall@k: porsi referensi gold yang tercakup oleh top-k hasil. */
export function recallAtK(ranked: readonly RankedHit[], relevan: readonly string[], k: number): number {
  if (relevan.length === 0) return 0;
  const covered = new Set<string>();
  const want = new Set(relevan);
  for (const h of ranked.slice(0, k)) for (const r of h.refs) if (want.has(r)) covered.add(r);
  return covered.size / want.size;
}

/** MRR@k: 1/rank hasil relevan pertama, 0 bila tidak ada dalam top-k. */
export function mrrAtK(ranked: readonly RankedHit[], relevan: readonly string[], k: number): number {
  const rel = new Set(relevan);
  const i = ranked.slice(0, k).findIndex((h) => isRel(h, rel));
  return i < 0 ? 0 : 1 / (i + 1);
}

/** nDCG@k dengan relevansi biner; ideal = semua slot terisi hasil relevan sebanyak `idealCount`. */
export function ndcgAtK(
  ranked: readonly RankedHit[],
  relevan: readonly string[],
  k: number,
  idealCount: number,
): number {
  const rel = new Set(relevan);
  let dcg = 0;
  ranked.slice(0, k).forEach((h, i) => {
    if (isRel(h, rel)) dcg += 1 / Math.log2(i + 2);
  });
  let ideal = 0;
  for (let i = 0; i < Math.min(k, idealCount); i++) ideal += 1 / Math.log2(i + 2);
  return ideal === 0 ? 0 : dcg / ideal;
}
