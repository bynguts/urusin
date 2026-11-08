import { describe, expect, it } from 'vitest';
import { openDb } from './db.js';
import { loadRealEmbedder, QUERY_EMBED_TIMEOUT_MS } from './embedder.js';
import type { FetchFn } from './providers/http.js';
import { tryLoadSqliteVec } from './vec.js';

const env = { LLM_EMBED_MODEL: 'm', LLM_EMBED_BASE_URL: 'https://e/v1', LLM_EMBED_API_KEY: 'k' };

type Call = { url: string; body: { input: string[]; task?: string } };

function fakeFetch(dim = 3, status = 200): { fetch: FetchFn; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchFn = async (url, init) => {
    const body = JSON.parse(init.body) as Call['body'];
    calls.push({ url, body });
    return {
      status,
      json: async () => ({
        data: body.input.map((_, index) => ({ index, embedding: Array<number>(dim).fill(0.5) })),
        usage: { total_tokens: 7 },
      }),
    };
  };
  return { fetch, calls };
}

describe('loadRealEmbedder', () => {
  it('konfigurasi lengkap + uji sukses: embedder dokumen dan kueri membawa task masing-masing', async () => {
    const f = fakeFetch();
    const real = await loadRealEmbedder(
      { ...env, LLM_EMBED_TASK_QUERY: 'retrieval.query', LLM_EMBED_TASK_PASSAGE: 'retrieval.passage' },
      { fetch: f.fetch },
    );
    expect(real?.model).toBe('m');
    const q = await real!.embedQuery(['halo']);
    const d = await real!.embed(['dok']);
    expect(q[0]).toHaveLength(3);
    expect(d[0]).toHaveLength(3);
    const tasks = f.calls.map((c) => c.body.task);
    expect(tasks).toContain('retrieval.query');
    expect(tasks).toContain('retrieval.passage');
    expect(real!.stats.query.tokens).toBe(7);
    expect(real!.stats.passage.tokens).toBe(7);
    expect(QUERY_EMBED_TIMEOUT_MS).toBe(2000);
  });
  it('cache pada db dipakai bila disediakan', async () => {
    const f = fakeFetch();
    const real = await loadRealEmbedder(env, { fetch: f.fetch, cache: openDb(':memory:') });
    await real!.embed(['sama']);
    const before = f.calls.length;
    await real!.embed(['sama']);
    expect(f.calls.length).toBe(before);
  });
  it('panggilan uji gagal atau vektor kosong: null (BM25 saja)', async () => {
    expect(await loadRealEmbedder(env, { fetch: fakeFetch(3, 401).fetch })).toBeNull();
    expect(await loadRealEmbedder(env, { fetch: fakeFetch(0).fetch })).toBeNull();
  });
});

describe('tryLoadSqliteVec', () => {
  it('false bila sqlite-vec tidak terpasang', async () => {
    expect(await tryLoadSqliteVec(openDb(':memory:'))).toBe(false);
  });
});
