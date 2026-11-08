import { beforeEach, describe, expect, it } from 'vitest';
import { fakeEmbedder } from './eval/fake-embedder.js';
import { createRagSearcher, embedAndFit, openDb, upsertChunks, type Db } from './index.js';
import type { FetchFn } from './providers/http.js';

const NOW = '2026-11-08T00:00:00.000Z';
const mk = (id: string, judul: string, text: string) => ({
  id,
  text,
  sourceRef: { url: `https://contoh.go.id/${id}`, judul, instansi: 'Dinas Contoh' },
  verifiedAt: NOW,
  layanan: 'adminduk',
});
const CORPUS = [
  mk(
    'akta',
    'Akta kelahiran',
    'Pencatatan akta kelahiran memerlukan surat keterangan lahir dan KK orang tua.',
  ),
  mk(
    'akta-2',
    'Akta kelahiran terlambat',
    'Akta kelahiran yang terlambat dicatat memerlukan SPTJM kebenaran data.',
  ),
  mk('ktp', 'Penggantian KTP-el hilang', 'Penggantian KTP-el yang hilang memerlukan surat kehilangan.'),
  mk('kk', 'KK baru', 'Pengurusan kartu keluarga baru membutuhkan akta nikah.'),
];
const MODEL = 'uji-embed';
const ENV = {
  LLM_EMBED_BASE_URL: 'https://embed.contoh.test/v1',
  LLM_EMBED_API_KEY: 'k-embed',
  LLM_EMBED_MODEL: MODEL,
  LLM_EMBED_TASK_QUERY: 'retrieval.query',
  RERANK_BASE_URL: 'https://rerank.contoh.test/v1',
  RERANK_API_KEY: 'k-rerank',
  RERANK_MODEL: 'uji-rerank',
};
const embed = fakeEmbedder({ dim: 16 });

type Call = { url: string; body: Record<string, unknown> };
/** fetch palsu: /embeddings memakai fakeEmbedder; /rerank memberi skor `scores(dokumen)` per dokumen. */
function fakeFetch(
  opts: {
    embedFails?: boolean;
    rerankFails?: boolean;
    scores?: (docs: string[]) => number[];
  } = {},
): { fetch: FetchFn; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchFn = async (url, init) => {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    calls.push({ url, body });
    if (url.endsWith('/embeddings')) {
      if (opts.embedFails) throw new Error('jaringan putus');
      const vecs = await embed(body['input'] as string[]);
      return {
        status: 200,
        json: async () => ({ data: vecs.map((v, index) => ({ index, embedding: [...v] })) }),
      };
    }
    if (opts.rerankFails) return { status: 503, json: async () => ({}) };
    const docs = body['documents'] as string[];
    const scores = opts.scores ? opts.scores(docs) : docs.map((_, i) => i / 10);
    return {
      status: 200,
      json: async () => ({ results: scores.map((relevance_score, index) => ({ index, relevance_score })) }),
    };
  };
  return { fetch, calls };
}

let db: Db;
beforeEach(async () => {
  db = openDb(':memory:');
  upsertChunks(db, CORPUS);
  await embedAndFit(db, embed, { mode: 'none', model: MODEL });
});

describe('createRagSearcher (jalur agen produksi)', () => {
  it('hybrid + rerank endpoint: urutan mengikuti skor rerank, mode hybrid, status endpoint', async () => {
    // Rerank memberi skor tertinggi ke dokumen terakhir yang dikirim: urutan fusi dibalik.
    const { fetch, calls } = fakeFetch();
    const s = createRagSearcher(db, ENV, { fetch });
    expect(s.info).toEqual({ vektor: true, rerank: true, embedModel: MODEL, rerankModel: 'uji-rerank' });
    const out = await s.search({ query: 'syarat akta kelahiran', k: 4 });
    expect(out.mode).toBe('hybrid');
    expect(out.debug?.rerankStatus).toBe('endpoint');
    expect(out.hasil.length).toBeGreaterThan(0);
    expect(calls.map((c) => c.url)).toEqual([
      'https://embed.contoh.test/v1/embeddings',
      'https://rerank.contoh.test/v1/rerank',
    ]);
    expect(calls[0]!.body['task']).toBe('retrieval.query');
  });

  it('embedding gagal: tetap menjawab lewat BM25 (tanpa melempar)', async () => {
    const { fetch } = fakeFetch({ embedFails: true });
    const out = await createRagSearcher(db, ENV, { fetch }).search({ query: 'syarat akta kelahiran', k: 4 });
    expect(out.mode).toBe('bm25');
    expect(out.hasil.map((h) => h.id)).toContain('akta');
  });

  it('rerank gagal: urutan fusi dipakai (status fallback)', async () => {
    const { fetch } = fakeFetch({ rerankFails: true });
    const out = await createRagSearcher(db, ENV, { fetch }).search({ query: 'syarat akta kelahiran', k: 4 });
    expect(out.debug?.rerankStatus).toBe('fallback');
    expect(out.hasil.length).toBeGreaterThan(0);
  });

  it('lantai skor rerank: skor teratas di bawah lantai -> abstain', async () => {
    const { fetch } = fakeFetch({ scores: (docs) => docs.map(() => 0.01) });
    const env = { ...ENV, RAG_ABSTAIN_MIN_RERANK_SCORE: '0.05' };
    const out = await createRagSearcher(db, env, { fetch }).search({ query: 'syarat akta kelahiran', k: 4 });
    expect(out.tanpaHasil).toBe(true);
    expect(out.alasan).toBe('di_luar_cakupan');
  });

  it('lantai skor rerank: skor di atas lantai tetap menjawab', async () => {
    const { fetch } = fakeFetch({ scores: (docs) => docs.map(() => 0.5) });
    const env = { ...ENV, RAG_ABSTAIN_MIN_RERANK_SCORE: '0.05' };
    const out = await createRagSearcher(db, env, { fetch }).search({ query: 'syarat akta kelahiran', k: 4 });
    expect(out.tanpaHasil).toBeFalsy();
    expect(out.hasil.length).toBeGreaterThan(0);
  });

  it('PII diredaksi sebelum embedding; rerank dilewati untuk kueri sensitif', async () => {
    const nik = ['3312', '0115', '0890', '0001'].join('');
    const { fetch, calls } = fakeFetch();
    const out = await createRagSearcher(db, ENV, { fetch }).search({
      query: `akta kelahiran NIK ${nik}`,
      k: 4,
    });
    const sent = JSON.stringify(calls.map((c) => c.body));
    expect(sent).not.toContain(nik);
    expect(calls.some((c) => c.url.endsWith('/rerank'))).toBe(false);
    expect(out.debug?.rerankStatus).toBe('skipped');
  });

  it('model embedding env berbeda dari vektor DB: leg vektor mati, tanpa panggilan embedding', async () => {
    const { fetch, calls } = fakeFetch();
    const s = createRagSearcher(db, { ...ENV, LLM_EMBED_MODEL: 'model-lain' }, { fetch });
    expect(s.info.vektor).toBe(false);
    const out = await s.search({ query: 'syarat akta kelahiran', k: 4 });
    expect(out.mode).toBe('bm25');
    expect(calls.some((c) => c.url.endsWith('/embeddings'))).toBe(false);
  });

  it('tanpa konfigurasi penyedia: BM25 murni, tanpa jaringan', async () => {
    const { fetch, calls } = fakeFetch();
    const s = createRagSearcher(db, {}, { fetch });
    expect(s.info).toEqual({ vektor: false, rerank: false, embedModel: null, rerankModel: null });
    const out = await s.search({ query: 'syarat akta kelahiran', k: 4 });
    expect(out.hasil.map((h) => h.id)).toContain('akta');
    expect(calls).toEqual([]);
  });
});
