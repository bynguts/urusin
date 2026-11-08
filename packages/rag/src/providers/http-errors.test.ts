import { describe, expect, it } from 'vitest';
import { loadRealRerankDeps } from '../eval/llm-rerank.js';
import { newStats, postJson, type FetchFn } from './http.js';

const noSleep = async () => undefined;

describe('postJson: kegagalan jaringan', () => {
  it('fetch melempar: dicoba ulang lalu galat dengan nama saja (tanpa isi) dan statistik galat', async () => {
    let calls = 0;
    const fetch: FetchFn = async () => {
      calls++;
      throw new TypeError('rahasia-di-pesan');
    };
    const stats = newStats();
    const err = await postJson(
      { baseUrl: 'https://p/v1', apiKey: 'k', fetch, maxRetries: 2, sleep: noSleep, stats },
      '/x',
      {},
    )
      .then(() => null)
      .catch((e: Error) => e);
    expect(calls).toBe(3);
    expect(err?.message).toBe('panggilan penyedia gagal: TypeError');
    expect(err?.message).not.toContain('rahasia');
    expect(stats.errors).toBe(1);
  });
  it('gagal sekali lalu sukses: hasil dikembalikan dan latensi tercatat', async () => {
    let n = 0;
    const fetch: FetchFn = async () => {
      if (n++ === 0) throw new Error('putus');
      return { status: 200, json: async () => ({ ok: true }) };
    };
    const stats = newStats();
    expect(
      await postJson({ baseUrl: 'https://p', apiKey: 'k', fetch, sleep: noSleep, stats }, '/x', {}),
    ).toEqual({
      ok: true,
    });
    expect(stats.calls).toBe(1);
    expect(stats.latenciesMs).toHaveLength(1);
  });
  it('timeout: AbortSignal membatalkan fetch yang menggantung', async () => {
    const fetch: FetchFn = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    await expect(
      postJson({ baseUrl: 'https://p', apiKey: 'k', fetch, timeoutMs: 5, maxRetries: 0 }, '/x', {}),
    ).rejects.toThrow('AbortError');
  });
});

describe('loadRealRerankDeps', () => {
  it('endpoint khusus dari env RERANK_*', async () => {
    const deps = await loadRealRerankDeps({
      RERANK_BASE_URL: 'https://r/v1',
      RERANK_API_KEY: 'k',
      RERANK_MODEL: 'm',
    });
    expect(deps?.endpoint?.rerank).toBeTypeOf('function');
    expect(deps?.timeoutMs).toBe(20_000);
  });
  it('tanpa konfigurasi apa pun: null (tahap rerank no-op)', async () => {
    expect(await loadRealRerankDeps({})).toBeNull();
  });
});
