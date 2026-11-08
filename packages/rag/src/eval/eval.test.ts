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
    expect(r.pipelines[0]!.rows.map((x) => x.mode)).toEqual(['A']);
    expect(r.pipelines[0]!.rows[0]?.recall5).toBe(1);
    expect(renderMarkdown(r)).toContain('hanya mode A');
  });

  it('dengan embedder palsu: mode A, B, C, dan D untuk k 64/128/256 (di-clamp)', async () => {
    const r = await runEval({ db, gold, embed: fakeEmbedder() });
    expect(r.pipelines[0]!.rows.map((x) => x.mode)).toEqual(['A', 'B', 'C', 'D', 'D', 'D']);
    for (const row of r.pipelines[0]!.rows) {
      for (const v of [row.recall1, row.recall3, row.recall5, row.mrr10, row.ndcg10]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
    const md = renderMarkdown(r);
    expect(md).toContain('| Mode | Konfigurasi | recall@1 |');
    expect(md).toContain('whiten k=4'); // n=5 chunk => k efektif 4
  });

  it('pipeline: tahap tanpa implementasi = no-op; hasil sama dengan baseline', async () => {
    const cfg = { bm25: { stemmed: true }, expand: true, rerank: true };
    const r = await runEval({
      db,
      gold,
      embed: null,
      pipelines: [
        { name: 'baseline', config: {} },
        { name: 'semua-tahap', config: cfg },
      ],
    });
    const [base, all] = r.pipelines;
    expect(all!.rows).toEqual(base!.rows);
    expect(all!.notes).toHaveLength(3);
    expect(renderMarkdown(r)).toContain('### Pipeline: semua-tahap');
  });

  it('pipeline: tahap tersuntik dipanggil (expand, bm25 pengganti, rerank)', async () => {
    const calls: string[] = [];
    const r = await runEval({
      db,
      gold: [gold[0]!],
      embed: null,
      pipelines: [{ name: 'p', config: { bm25: { stemmed: true }, expand: true, rerank: true } }],
      stages: {
        expand: (q) => (calls.push('expand'), q + ' kepolisian'),
        bm25: () => (calls.push('bm25'), ['akta', 'ktp']),
        // rerank membalik urutan: ktp naik ke peringkat 1
        rerank: async (_q, c) => (calls.push('rerank'), c.map((x) => x.id).reverse()),
      },
    });
    expect(calls).toEqual(['expand', 'bm25', 'rerank']);
    expect(r.pipelines[0]!.rows[0]!.recall1).toBe(1);
    expect(r.pipelines[0]!.notes).toEqual([]);
  });

  it('pipeline: vector.transform membatasi tabel ke A + satu baris', async () => {
    const r = await runEval({
      db,
      gold,
      embed: fakeEmbedder(),
      pipelines: [{ name: 'c', config: { vector: { transform: { mode: 'center' } } } }],
    });
    expect(r.pipelines[0]!.rows.map((x) => x.mode)).toEqual(['A', 'V']);
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

describe('runEval: abstain', () => {
  const db2 = openDb(':memory:');
  upsertChunks(db2, [
    {
      id: 'ktp',
      text: 'Penggantian KTP-el hilang butuh surat kehilangan kepolisian',
      sourceRef: { url: 'https://contoh.go.id/ktp', judul: 'KTP-el', instansi: 'Dinas Contoh' },
      verifiedAt: '2026-11-08T00:00:00.000Z',
    },
  ]);
  const gold = [
    { id: 'a', pertanyaan: 'KTP-el hilang', relevan: ['ktp'] },
    { id: 'b', pertanyaan: 'resep rendang', relevan: [], luarCakupan: true },
    { id: 'c', pertanyaan: 'harga emas', relevan: [], luarCakupan: true },
  ];
  // cakupan palsu: pertanyaan 'b' di bawah ambang, 'c' lolos (bocor), 'a' tinggi
  const coverage = (_db: unknown, q: { query: string }) =>
    q.query.includes('rendang') ? 0.05 : q.query.includes('emas') ? 0.5 : 0.9;

  it('hitung presisi/recall abstain; metrik retrieval hanya pada pertanyaan dalam cakupan', async () => {
    const r = await runEval({
      db: db2,
      gold,
      embed: null,
      pipelines: [
        { name: 'tanpa', config: {} },
        { name: 'gerbang', config: { abstain: { minCoverage: 0.3 } } },
      ],
      stages: { coverage },
    });
    const [tanpa, gerbang] = r.pipelines.map((p) => p.rows[0]!);
    expect(r.outOfScope).toBe(2);
    expect(r.tanpaChunkRelevan).toEqual([]);
    expect(tanpa!.recall3).toBe(1);
    expect(tanpa!.abstainPrecision).toBeNull();
    expect(tanpa!.abstainRecall).toBe(0);
    expect(gerbang!.recall3).toBe(1);
    expect(gerbang!.abstainPrecision).toBe(1);
    expect(gerbang!.abstainRecall).toBe(0.5);
    expect(renderMarkdown(r)).toContain('| abstain P | abstain R |');
  });

  it('abstain pada pertanyaan dalam cakupan menurunkan recall dan presisi', async () => {
    const r = await runEval({
      db: db2,
      gold,
      embed: null,
      pipelines: [{ name: 'ketat', config: { abstain: { minCoverage: 0.95 } } }],
      stages: { coverage },
    });
    const row = r.pipelines[0]!.rows[0]!;
    expect(row.recall3).toBe(0);
    expect(row.abstainPrecision).toBeCloseTo(2 / 3);
    expect(row.abstainRecall).toBe(1);
  });

  it('tanpa stage coverage gerbang menjadi no-op dan dicatat', async () => {
    const r = await runEval({
      db: db2,
      gold,
      embed: null,
      pipelines: [{ name: 'p', config: { abstain: { minCoverage: 0.3 } } }],
    });
    expect(r.pipelines[0]!.notes.join(' ')).toContain('abstain');
    expect(r.pipelines[0]!.rows[0]!.abstainRecall).toBe(0);
  });

  it('skema gold: luarCakupan wajib relevan kosong, selain itu wajib terisi', () => {
    expect(() =>
      GoldSetSchema.parse([{ id: 'x', pertanyaan: 'q', relevan: ['a'], luarCakupan: true }]),
    ).toThrow();
    expect(() =>
      GoldSetSchema.parse([{ id: 'x', pertanyaan: 'q', relevan: [], luarCakupan: true }]),
    ).not.toThrow();
  });
});
