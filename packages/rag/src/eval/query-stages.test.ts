import { describe, expect, it } from 'vitest';
import { openDb, upsertChunks, type RerankEndpoint } from '../index.js';
import { createQueryStages } from './query-stages.js';
import { runEval, type NamedPipeline } from './run.js';

const mk = (id: string, judul: string, text: string) => ({
  id,
  text,
  sourceRef: { url: `https://contoh.go.id/${id}`, judul, instansi: 'Dinas Contoh' },
  verifiedAt: '2026-11-08T00:00:00.000Z',
});

const db = openDb(':memory:');
upsertChunks(db, [
  mk('rekam', 'Perekaman KTP-el', 'Perekaman dan pencetakan KTP-el di kecamatan membawa KK.'),
  mk('samsat', 'Pajak kendaraan bermotor', 'Pajak kendaraan bermotor dibayar lewat Samsat setiap tahun.'),
  mk('akta', 'Akta kelahiran', 'Akta kelahiran butuh surat keterangan lahir dan KK orang tua.'),
  mk('pindah', 'Surat pindah', 'Perpindahan penduduk memerlukan SKPWNI dari dinas kependudukan.'),
  mk('umum', 'Layanan umum', 'Layanan kependudukan umum dan akta kelahiran tersedia setiap hari kerja.'),
]);

const run = async (
  pipelines: NamedPipeline[],
  gold: { id: string; pertanyaan: string; relevan: string[]; luarCakupan?: boolean }[],
  stages = createQueryStages(),
) => (await runEval({ db, gold, embed: null, pipelines, stages })).pipelines;

const recall = (p: { rows: { recall1: number; mrr10: number }[] }) => p.rows[0]!;

describe('eval: tiap tahap kueri mengubah hasil dibanding baseline', () => {
  it('bm25.stemmed: bentuk berimbuhan tidak lagi luput', async () => {
    const [base, stem] = await run(
      [
        { name: 'baseline', config: {} },
        { name: 'stem', config: { bm25: { stemmed: true } } },
      ],
      [{ id: 'g', pertanyaan: 'persyaratan mencetak merekam', relevan: ['rekam'] }],
    );
    expect(recall(base!).recall1).toBe(0);
    expect(recall(stem!).recall1).toBe(1);
    expect(stem!.notes).toEqual([]);
  });

  it('expand: istilah awam menemukan istilah resmi', async () => {
    const [base, exp] = await run(
      [
        { name: 'baseline', config: {} },
        { name: 'expand', config: { expand: true } },
      ],
      [{ id: 'g', pertanyaan: 'stnk', relevan: ['samsat'] }],
    );
    expect(recall(base!).mrr10).toBeLessThan(recall(exp!).mrr10);
    expect(recall(exp!).recall1).toBe(1);
  });

  it('stem + expand bersama: kueri awam "bikin ktp" menemukan perekaman', async () => {
    const [base, both] = await run(
      [
        { name: 'baseline', config: {} },
        { name: 'both', config: { bm25: { stemmed: true }, expand: true } },
      ],
      [{ id: 'g', pertanyaan: 'ngurus pindahan', relevan: ['pindah'] }],
    );
    expect(recall(base!).recall1).toBe(0);
    expect(recall(both!).recall1).toBe(1);
  });

  it('rerank: urutan berubah mengikuti reranker; tanpa reranker = no-op bercatatan', async () => {
    const gold = [{ id: 'g', pertanyaan: 'akta kelahiran', relevan: ['akta'] }];
    const baseOnly = await run([{ name: 'base', config: { rerank: true } }], gold);
    expect(baseOnly[0]!.notes).toHaveLength(1); // tanpa reranker tersuntik: no-op tercatat

    const endpoint: RerankEndpoint = {
      async rerank(req) {
        return req.documents.map((d) => ({ id: d.id, score: d.id === 'umum' ? 1 : 0 }));
      },
    };
    const stages = createQueryStages({ rerank: { endpoint } });
    const [plain, reranked] = await run(
      [
        { name: 'plain', config: {} },
        { name: 'rerank', config: { rerank: true } },
      ],
      gold,
      stages,
    );
    expect(recall(plain!).recall1).toBe(1);
    expect(recall(reranked!).recall1).toBe(0);
    expect(recall(reranked!).mrr10).toBeGreaterThan(0);
  });

  it('abstain: pertanyaan luar cakupan dikosongkan, pertanyaan dalam cakupan tetap dijawab', async () => {
    const gold = [
      { id: 'in', pertanyaan: 'akta kelahiran orang tua', relevan: ['akta'] },
      { id: 'oos', pertanyaan: 'resep rendang padang', relevan: [], luarCakupan: true },
    ];
    const [off, on] = await run(
      [
        { name: 'off', config: { bm25: { stemmed: true } } },
        { name: 'on', config: { bm25: { stemmed: true }, abstain: { minCoverage: 0.3 } } },
      ],
      gold,
    );
    expect(off!.rows[0]!.abstainRecall).toBe(0);
    expect(on!.rows[0]!.abstainRecall).toBe(1);
    expect(on!.rows[0]!.abstainPrecision).toBe(1);
    expect(on!.rows[0]!.recall3).toBe(1);
  });

  it('tahap rerank dan rerankScored dipanggil langsung; hasil berskor di-memo per kueri+kandidat', async () => {
    let calls = 0;
    const endpoint: RerankEndpoint = {
      async rerank(req) {
        calls++;
        return req.documents.map((d) => ({ id: d.id, score: d.id === 'umum' ? 0.9 : 0.1 }));
      },
    };
    const stages = createQueryStages({ rerank: { endpoint } });
    const cands = [
      { id: 'akta', text: 'Akta kelahiran butuh surat keterangan lahir.', judul: 'Akta kelahiran' },
      { id: 'umum', text: 'Layanan kependudukan umum setiap hari kerja.' },
    ];
    expect(await stages.rerank!('akta kelahiran', cands)).toEqual(['umum', 'akta']);
    const a = await stages.rerankScored!('akta kelahiran', cands);
    const b = await stages.rerankScored!('akta kelahiran', cands);
    expect(a[0]).toMatchObject({ id: 'umum', score: 0.9 });
    expect(b).toBe(a);
    expect(calls).toBe(2);
  });
});
