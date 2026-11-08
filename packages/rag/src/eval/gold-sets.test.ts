import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadGold } from './gold.js';

const data = (f: string) => resolve(fileURLToPath(new URL(`../../../../data/${f}`, import.meta.url)));
const tuning = loadGold(data('gold/tuning.json'));
const heldout = loadGold(data('gold/heldout.json'));
const sources = new Map(
  (
    JSON.parse(readFileSync(data('sources.json'), 'utf8')) as { sources: { id: string; ingest: boolean }[] }
  ).sources.map((s) => [s.id, s]),
);

describe('gold set korpus nyata', () => {
  it('tuning: 50 pertanyaan, >= 10 Surabaya dalam cakupan, >= 10 luar cakupan', () => {
    expect(tuning).toHaveLength(50);
    expect(tuning.filter((g) => g.kodeWilayah === '3578' && !g.luarCakupan).length).toBeGreaterThanOrEqual(
      10,
    );
    expect(tuning.filter((g) => g.luarCakupan).length).toBeGreaterThanOrEqual(10);
  });
  it('held-out: 20 pertanyaan, terpisah dari tuning (id dan teks tidak beririsan)', () => {
    expect(heldout).toHaveLength(20);
    const ids = new Set(tuning.map((g) => g.id));
    const qs = new Set(tuning.map((g) => g.pertanyaan.toLowerCase()));
    for (const g of heldout) {
      expect(ids.has(g.id), g.id).toBe(false);
      expect(qs.has(g.pertanyaan.toLowerCase()), g.id).toBe(false);
    }
  });
  it('id unik dan setiap referensi menunjuk sumber ber-ingest di sources.json', () => {
    const all = [...tuning, ...heldout];
    expect(new Set(all.map((g) => g.id)).size).toBe(all.length);
    for (const g of all) {
      for (const ref of g.relevan) {
        const src = sources.get(ref.split('#')[0] ?? '');
        expect(src?.ingest, `${g.id}: ${ref}`).toBe(true);
      }
    }
  });
});
