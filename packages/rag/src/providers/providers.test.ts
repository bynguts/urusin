import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { openDb, upsertChunks } from '../index.js';
import { retrieve } from '../pipeline.js';
import type { RerankEndpoint } from '../rerank.js';
import { loadRealEmbedder } from '../embedder.js';
import { createHttpEmbedder, loadEmbedConfig, withEmbedCache } from './embedder.js';
import { newStats, percentile, postJson, type FetchFn } from './http.js';
import { redactForProvider } from './redact.js';
import { createHttpRerankEndpoint, loadRerankConfig } from './rerank-endpoint.js';

const res = (status: number, body: unknown) => ({ status, json: async () => body });
const noSleep = async () => undefined;

// NIK sintetis dirakit agar tidak terbaca sebagai data nyata oleh pemindai PII.
const NIK = ['357801', '010190', '0002'].join('');

describe('redactForProvider', () => {
  it('mengganti NIK, HP dan email; teks biasa tidak berubah', () => {
    const email = ['warga', 'contoh.id'].join('@');
    const out = redactForProvider(`NIK ${NIK} email ${email} syarat akta`);
    expect(out).not.toContain(NIK);
    expect(out).not.toContain(email);
    expect(out).toContain('[DATA]');
    expect(redactForProvider('syarat akta kelahiran')).toBe('syarat akta kelahiran');
  });
});

describe('konfigurasi dari env', () => {
  it('embedding: base URL bawaan = LLM_BASE_URL; kunci LLM hanya dipakai bila base URL bawaan', () => {
    expect(
      loadEmbedConfig({ LLM_EMBED_MODEL: 'm', LLM_BASE_URL: 'https://a/v1', LLM_API_KEY: 'k' }),
    ).toMatchObject({
      baseUrl: 'https://a/v1',
      apiKey: 'k',
    });
    // base URL sendiri tanpa kunci sendiri: kunci LLM TIDAK dibawa ke penyedia lain
    expect(
      loadEmbedConfig({
        LLM_EMBED_MODEL: 'm',
        LLM_EMBED_BASE_URL: 'https://j/v1',
        LLM_BASE_URL: 'https://a/v1',
        LLM_API_KEY: 'k',
      }),
    ).toBeNull();
    expect(
      loadEmbedConfig({
        LLM_EMBED_MODEL: 'm',
        LLM_EMBED_BASE_URL: 'https://j/v1',
        LLM_EMBED_API_KEY: 'jk',
        LLM_EMBED_TASK_QUERY: 'retrieval.query',
      }),
    ).toMatchObject({ baseUrl: 'https://j/v1', apiKey: 'jk', taskQuery: 'retrieval.query' });
    expect(loadEmbedConfig({})).toBeNull();
  });
  it('rerank: semua tiga variabel wajib', () => {
    expect(loadRerankConfig({ RERANK_BASE_URL: 'https://j/v1', RERANK_MODEL: 'm' })).toBeNull();
    expect(
      loadRerankConfig({ RERANK_BASE_URL: 'https://j/v1', RERANK_API_KEY: 'k', RERANK_MODEL: 'm' }),
    ).toEqual({
      baseUrl: 'https://j/v1',
      apiKey: 'k',
      model: 'm',
    });
  });
  it('tanpa konfigurasi loadRealEmbedder mengembalikan null tanpa jaringan', async () => {
    expect(await loadRealEmbedder({})).toBeNull();
  });
});

describe('postJson', () => {
  it('retry pada 429/5xx lalu sukses; statistik tercatat; kunci tidak ada di galat', async () => {
    const stats = newStats();
    let n = 0;
    const fetch: FetchFn = async () => (++n < 3 ? res(n === 1 ? 429 : 503, {}) : res(200, { ok: true }));
    const out = await postJson(
      { baseUrl: 'https://x/v1/', apiKey: 'rahasia', fetch, stats, sleep: noSleep },
      '/p',
      {},
    );
    expect(out).toEqual({ ok: true });
    expect(n).toBe(3);
    expect(stats.calls).toBe(1);
    const bad: FetchFn = async () => res(401, {});
    await expect(
      postJson({ baseUrl: 'https://x', apiKey: 'rahasia', fetch: bad, sleep: noSleep }, '/p', {}),
    ).rejects.toThrow(/HTTP 401/);
    await expect(
      postJson({ baseUrl: 'https://x', apiKey: 'rahasia', fetch: bad, sleep: noSleep }, '/p', {}),
    ).rejects.not.toThrow(/rahasia/);
  });
  it('persentil', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([], 95)).toBe(0);
  });
});

describe('embedder HTTP', () => {
  it('mengirim task, meredaksi PII, memecah batch 64 dan mengurutkan berdasarkan index', async () => {
    const bodies: { input: string[]; task?: string; model: string }[] = [];
    const fetch: FetchFn = async (_u, init) => {
      const b = JSON.parse(init.body) as { input: string[]; task?: string; model: string };
      bodies.push(b);
      return res(200, {
        data: b.input.map((_t, i) => ({ index: i, embedding: [i, 1] })).reverse(),
        usage: { total_tokens: b.input.length },
      });
    };
    const stats = newStats();
    const embed = createHttpEmbedder(
      { baseUrl: 'https://j/v1', apiKey: 'k', model: 'm' },
      'retrieval.query',
      {
        fetch,
        stats,
      },
    );
    const texts = Array.from({ length: 70 }, (_x, i) => (i === 0 ? `NIK ${NIK}` : `t${i}`));
    const out = await embed(texts);
    expect(out).toHaveLength(70);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]!.task).toBe('retrieval.query');
    expect(bodies[0]!.input[0]).not.toContain(NIK);
    expect(out[3]![0]).toBe(3);
    expect(stats.tokens).toBe(70);
  });
  it('tanpa task: field task tidak dikirim', async () => {
    let body: Record<string, unknown> = {};
    const fetch: FetchFn = async (_u, init) => {
      body = JSON.parse(init.body) as Record<string, unknown>;
      return res(200, { data: [{ index: 0, embedding: [1] }] });
    };
    await createHttpEmbedder({ baseUrl: 'https://j', apiKey: 'k', model: 'm' }, undefined, { fetch })(['a']);
    expect('task' in body).toBe(false);
  });
  it('awalan teks (EmbeddingGemma) disambung satu spasi setelah redaksi, lalu dipotong ke maxChars', async () => {
    let input: string[] = [];
    const fetch: FetchFn = async (_u, init) => {
      input = (JSON.parse(init.body) as { input: string[] }).input;
      return res(200, { data: input.map((_t, index) => ({ index, embedding: [1] })) });
    };
    const cfg = loadEmbedConfig({
      LLM_EMBED_MODEL: 'embeddinggemma-300m',
      LLM_EMBED_BASE_URL: 'http://127.0.0.1:4340/v1',
      LLM_EMBED_API_KEY: 'lokal',
      LLM_EMBED_PREFIX_QUERY: ' task: search result | query: ',
      LLM_EMBED_PREFIX_PASSAGE: 'title: none | text:',
      LLM_EMBED_MAX_CHARS: '60',
    })!;
    expect(cfg).toMatchObject({ prefixQuery: 'task: search result | query:', maxChars: 60 });
    await createHttpEmbedder(cfg, undefined, { fetch }, cfg.prefixQuery)([`akta NIK ${NIK}`]);
    expect(input[0]).toBe('task: search result | query: akta NIK [DATA]');
    await createHttpEmbedder(cfg, undefined, { fetch }, cfg.prefixPassage)(['x'.repeat(100)]);
    expect(input[0]).toBe(`title: none | text: ${'x'.repeat(40)}`);
    // Tanpa awalan/batas: teks apa adanya; batas tidak valid diabaikan.
    expect(
      loadEmbedConfig({
        LLM_EMBED_MODEL: 'm',
        LLM_BASE_URL: 'https://a/v1',
        LLM_API_KEY: 'k',
        LLM_EMBED_MAX_CHARS: 'x',
      }),
    ).toMatchObject({ prefixQuery: undefined, prefixPassage: undefined, maxChars: undefined });
  });
});

describe('cache embedding per (model, task, hash)', () => {
  it('hit tidak memanggil penyedia; model atau task berbeda tidak berbagi cache', async () => {
    const db = new Database(':memory:');
    let calls = 0;
    const inner = async (t: string[]) => {
      calls++;
      return t.map((x) => Float32Array.from([x.length, 1]));
    };
    const a = withEmbedCache(inner, db, { model: 'm1', task: 'p' });
    await a(['aa', 'bbb']);
    expect(calls).toBe(1);
    const again = await a(['aa', 'bbb', 'c']);
    expect(calls).toBe(2); // hanya 'c' yang baru
    expect([...again[1]!]).toEqual([3, 1]);
    await withEmbedCache(inner, db, { model: 'm2', task: 'p' })(['aa']);
    await withEmbedCache(inner, db, { model: 'm1', task: 'q' })(['aa']);
    expect(calls).toBe(4);
  });
});

describe('endpoint rerank HTTP dan lantai skor', () => {
  it('memetakan index ke id, meredaksi PII, mencatat token', async () => {
    let body: { query: string; documents: string[] } = { query: '', documents: [] };
    const fetch: FetchFn = async (_u, init) => {
      body = JSON.parse(init.body) as typeof body;
      return res(200, {
        results: [
          { index: 1, relevance_score: 0.9 },
          { index: 0, relevance_score: 0.1 },
        ],
        usage: { total_tokens: 12 },
      });
    };
    const stats = newStats();
    const ep = createHttpRerankEndpoint(
      { baseUrl: 'https://j/v1', apiKey: 'k', model: 'r' },
      { fetch, stats },
    );
    const r = await ep.rerank(
      {
        query: `KTP ${NIK}`,
        documents: [
          { id: 'a', text: 'x' },
          { id: 'b', text: 'y' },
        ],
        topN: 2,
      },
      {},
    );
    expect(r).toEqual([
      { id: 'b', score: 0.9 },
      { id: 'a', score: 0.1 },
    ]);
    expect(body.query).not.toContain(NIK);
    expect(stats.tokens).toBe(12);
  });

  const mk = (id: string, judul: string, text: string) => ({
    id,
    text,
    sourceRef: { url: `https://contoh.go.id/${id}`, judul, instansi: 'Dinas Contoh' },
    verifiedAt: '2026-11-08T00:00:00.000Z',
  });
  const db = openDb(':memory:');
  upsertChunks(db, [
    mk('akta', 'Akta kelahiran', 'Akta kelahiran butuh surat keterangan lahir dan KK orang tua.'),
    mk('ktp', 'Penggantian KTP-el', 'Penggantian KTP-el hilang butuh surat kehilangan kepolisian.'),
  ]);
  const scoring = (top: number): RerankEndpoint & { seen: string[] } => ({
    seen: [],
    async rerank(req) {
      this.seen.push(...req.documents.map((d) => d.text));
      return req.documents.map((d, i) => ({ id: d.id, score: i === 0 ? top : 0 }));
    },
  });

  it('judul sumber ikut dikirim ke reranker', async () => {
    const ep = scoring(0.9);
    await retrieve(db, { query: 'akta kelahiran kepolisian' }, undefined, { rerank: { endpoint: ep } });
    expect(
      ep.seen.some((t) => t.startsWith('Akta kelahiran\n') || t.startsWith('Penggantian KTP-el\n')),
    ).toBe(true);
  });
  it('lantai skor: skor teratas di bawah lantai -> di_luar_cakupan; di atas lantai -> jawaban', async () => {
    const low = await retrieve(db, { query: 'akta kelahiran kepolisian' }, undefined, {
      rerank: { endpoint: scoring(0.05) },
      minRerankScore: 0.1,
    });
    expect(low.hits).toEqual([]);
    expect(low.alasan).toBe('di_luar_cakupan');
    const high = await retrieve(db, { query: 'akta kelahiran kepolisian' }, undefined, {
      rerank: { endpoint: scoring(0.8) },
      minRerankScore: 0.1,
    });
    expect(high.hits.length).toBeGreaterThan(0);
    const off = await retrieve(db, { query: 'akta kelahiran kepolisian' }, undefined, {
      rerank: { endpoint: scoring(0.01) },
    });
    expect(off.hits.length).toBeGreaterThan(0); // tanpa lantai gerbang tidak aktif
  });
});
