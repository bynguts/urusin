import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, upsertChunks } from '../index.js';
import { fakeEmbedder } from './fake-embedder.js';
import { GoldSetSchema, loadGold } from './gold.js';
import { mrrAtK, ndcgAtK, recallAtK } from './metrics.js';
import { renderMarkdown, runEval } from './run.js';

const hit = (...refs: string[]) => ({ refs });

describe('metrik', () => {
  const ranked = [hit('a'), hit('x'), hit('b'), hit('y')];
  it('recall@k', () => {
    expect(recallAtK(ranked, ['a', 'b'], 1)).toBe(0.5);
    expect(recallAtK(ranked, ['a', 'b'], 3)).toBe(1);
    expect(recallAtK(ranked, [], 3)).toBe(0);
  });
  it('MRR@k', () => {
    expect(mrrAtK(ranked, ['b'], 10)).toBeCloseTo(1 / 3);
    expect(mrrAtK(ranked, ['b'], 2)).toBe(0);
  });
  it('nDCG@k', () => {
    expect(ndcgAtK([hit('a'), hit('b')], ['a', 'b'], 10, 2)).toBeCloseTo(1);
    const dcg = 1 / Math.log2(3);
    expect(ndcgAtK([hit('x'), hit('a')], ['a'], 10, 1)).toBeCloseTo(dcg);
  });
});

describe('gold set', () => {
  it('contoh sintetis di data/rag-gold.json sesuai skema', () => {
    const path = resolve(fileURLToPath(new URL('../../../../data/rag-gold.json', import.meta.url)));
    const gold = loadGold(path);
    expect(gold).toHaveLength(5);
    expect(gold.every((g) => g.catatan?.includes('contoh sintetis'))).toBe(true);
  });
  it('menolak relevan kosong', () => {
    expect(() => GoldSetSchema.parse([{ id: 'x', pertanyaan: 'q', relevan: [] }])).toThrow();
  });
});

describe('runEval', () => {
  const mk = (id: string, judul: string, text: string) => ({
    id,
    text,
    sourceRef: { url: `https://contoh.go.id/${id}`, judul, instansi: 'Dinas Contoh' },
    verifiedAt: '2026-11-08T00:00:00.000Z',
  });
  const db = openDb(':memory:');
  upsertChunks(db, [
    mk('ktp', 'Penggantian KTP-el', 'Penggantian KTP-el hilang butuh surat kehilangan kepolisian'),
    mk('akta', 'Akta kelahiran', 'Akta kelahiran butuh surat keterangan lahir dan KK orang tua'),
    mk('pajak', 'Pajak kendaraan', 'Pajak kendaraan bermotor dibayar lewat Samsat'),
    mk('pindah', 'Surat pindah', 'Surat pindah SKPWNI diurus di dinas kependudukan'),
    mk('bpjs', 'BPJS', 'Pendaftaran BPJS Kesehatan mandiri di kantor cabang'),
  ]);
  const gold = [
    { id: 'g1', pertanyaan: 'KTP-el hilang kepolisian', relevan: ['ktp'] },
    { id: 'g2', pertanyaan: 'akta kelahiran orang tua', relevan: ['https://contoh.go.id/akta'] },
  ];

  it('tanpa embedding hanya mode A dan diberi catatan', async () => {
    const r = await runEval({ db, gold, embed: null });
    expect(r.rows.map((x) => x.mode)).toEqual(['A']);
    expect(r.rows[0]?.recall5).toBe(1);
    expect(renderMarkdown(r)).toContain('hanya mode A');
  });

  it('dengan embedder palsu: mode A, B, C, dan D untuk k 64/128/256 (di-clamp)', async () => {
    const r = await runEval({ db, gold, embed: fakeEmbedder() });
    expect(r.rows.map((x) => x.mode)).toEqual(['A', 'B', 'C', 'D', 'D', 'D']);
    for (const row of r.rows) {
      for (const v of [row.recall1, row.recall3, row.recall5, row.mrr10, row.ndcg10]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
    const md = renderMarkdown(r);
    expect(md).toContain('| Mode | Konfigurasi | recall@1 |');
    expect(md).toContain('whiten k=4'); // n=5 chunk => k efektif 4
  });

  it('melaporkan gold tanpa chunk cocok', async () => {
    const r = await runEval({
      db,
      gold: [{ id: 'g3', pertanyaan: 'ktp', relevan: ['tidak-ada'] }],
      embed: null,
    });
    expect(r.tanpaChunkRelevan).toEqual(['g3']);
  });
});
