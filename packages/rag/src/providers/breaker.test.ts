import { describe, expect, it } from 'vitest';
import { fakeEmbedder } from '../eval/fake-embedder.js';
import { openDb, upsertChunks } from '../index.js';
import { embedAndFit, vectorIdsForQuery } from '../vector/pipeline.js';
import { BreakerOpenError, costUsd, createBreaker, priceFromEnv } from './breaker.js';
import { createHttpRerankEndpoint, RERANK_TIMEOUT_MS } from './rerank-endpoint.js';
import type { FetchFn } from './http.js';

describe('pemutus sirkuit', () => {
  it('terbuka setelah 3 gagal beruntun, melepas satu percobaan setelah cooldown, menutup bila sukses', async () => {
    let t = 0;
    const b = createBreaker({ threshold: 3, cooldownMs: 1000, now: () => t });
    let calls = 0;
    const bad = async () => {
      calls++;
      throw new Error('x');
    };
    for (let i = 0; i < 3; i++) await expect(b.run(bad)).rejects.toThrow('x');
    expect(b.isOpen).toBe(true);
    await expect(b.run(bad)).rejects.toBeInstanceOf(BreakerOpenError);
    expect(calls).toBe(3); // panggilan keempat tidak menyentuh penyedia
    t = 1500;
    await expect(b.run(async () => 'ok')).resolves.toBe('ok');
    expect(b.isOpen).toBe(false);
    // setengah terbuka lalu gagal: kembali terbuka langsung
    for (let i = 0; i < 3; i++) await expect(b.run(bad)).rejects.toThrow('x');
    t = 3000;
    await expect(b.run(bad)).rejects.toThrow('x');
    expect(b.isOpen).toBe(true);
  });
  it('endpoint rerank memakai timeout 3 detik tanpa retry dan memutus sirkuit', async () => {
    let calls = 0;
    let signalSeen = false;
    const fetch: FetchFn = async (_u, init) => {
      calls++;
      signalSeen = init.signal !== undefined;
      return { status: 503, json: async () => ({}) };
    };
    expect(RERANK_TIMEOUT_MS).toBe(3000);
    const ep = createHttpRerankEndpoint({ baseUrl: 'https://j/v1', apiKey: 'k', model: 'r' }, { fetch });
    const req = { query: 'q', documents: [{ id: 'a', text: 'x' }], topN: 1 };
    for (let i = 0; i < 3; i++) await expect(ep.rerank(req, {})).rejects.toThrow();
    expect(calls).toBe(3); // maxRetries 0: satu panggilan per percobaan
    expect(signalSeen).toBe(true);
    await expect(ep.rerank(req, {})).rejects.toBeInstanceOf(BreakerOpenError);
    expect(calls).toBe(3);
  });
  it('meter harga dari env', () => {
    expect(priceFromEnv({ RERANK_PRICE_PER_MTOK: '0.5' }, 'RERANK_PRICE_PER_MTOK')).toBe(0.5);
    expect(priceFromEnv({}, 'RERANK_PRICE_PER_MTOK')).toBe(0);
    expect(priceFromEnv({ X: '-1' }, 'X')).toBe(0);
    expect(costUsd(2_000_000, 0.25)).toBeCloseTo(0.5);
  });
});

describe('vektor dan model embedding', () => {
  it('kueri ditolak (BM25 saja) bila model embedder berbeda dari model vektor tersimpan', async () => {
    const db = openDb(':memory:');
    upsertChunks(db, [
      {
        id: 'a',
        text: 'akta kelahiran butuh surat lahir',
        sourceRef: { url: 'https://contoh.go.id/a', judul: 'Akta', instansi: 'Dinas Contoh' },
        verifiedAt: '2026-11-08T00:00:00.000Z',
      },
      {
        id: 'b',
        text: 'penggantian KTP-el hilang',
        sourceRef: { url: 'https://contoh.go.id/b', judul: 'KTP', instansi: 'Dinas Contoh' },
        verifiedAt: '2026-11-08T00:00:00.000Z',
      },
    ]);
    const embed = fakeEmbedder();
    await embedAndFit(db, embed, { mode: 'none', model: 'model-a' });
    expect(await vectorIdsForQuery(db, embed, 'akta lahir', {}, 5, 'model-a')).toBeDefined();
    expect(await vectorIdsForQuery(db, embed, 'akta lahir', {}, 5, 'model-b')).toBeUndefined();
    // tanpa model yang diminta: perilaku lama
    expect(await vectorIdsForQuery(db, embed, 'akta lahir', {}, 5)).toBeDefined();
  });
});
