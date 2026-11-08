export type Ranked = { id: string };

/** Reciprocal Rank Fusion: skor = sum 1/(k + rank), rank mulai 1. Siap untuk leg vektor. */
export function reciprocalRankFusion(lists: readonly (readonly Ranked[])[], k = 60): { id: string; skor: number }[] {
  const score = new Map<string, number>();
  for (const list of lists) {
    list.forEach((item, i) => score.set(item.id, (score.get(item.id) ?? 0) + 1 / (k + i + 1)));
  }
  return [...score.entries()]
    .map(([id, skor]) => ({ id, skor }))
    .sort((a, b) => b.skor - a.skor || a.id.localeCompare(b.id));
}
