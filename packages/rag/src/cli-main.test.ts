import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CliIo } from './cli-io.js';
import { agentEvalMain } from './eval/agent-main.js';
import { evalMain } from './eval/cli-main.js';
import { matrixMain } from './eval/matrix-main.js';
import type { Deps, FetchLike } from './ingest/fetcher.js';
import { ingestMain } from './ingest/cli-main.js';
import { verifyMain } from './ingest/verify-cli-main.js';
import type { FetchFn } from './providers/http.js';

const URL_OK = 'https://disdukcapil.contoh.go.id/layanan';
const URL_BAD = 'https://disdukcapil.contoh.go.id/hilang';
const BOTH_OK = { [URL_OK]: 200, [URL_BAD]: 200 };
const PAGE =
  '<html><body><h1>Akta Kelahiran</h1><p>Syarat akta kelahiran: surat keterangan lahir dan KK.</p></body></html>';

const source = (id: string, url: string) => ({
  id,
  url,
  judul: `Layanan ${id}`,
  instansi: 'Dinas Contoh',
  jenis: 'halaman',
  domain: 'dukcapil',
  kodeWilayah: null,
  layanan: 'adminduk',
  status: 'confirmed',
  robots: 'ditemukan',
  lastFetched: null,
  ingest: true,
  catatan: '',
});

function pageDeps(routes: Record<string, number>): Deps {
  let t = Date.parse('2026-11-01T00:00:00Z');
  const fetch: FetchLike = async (url) => {
    if (url.endsWith('/robots.txt')) {
      return {
        status: 200,
        headers: { get: () => 'text/plain' },
        text: async () => 'User-agent: *\nAllow: /',
      };
    }
    const status = routes[url] ?? 404;
    return {
      status,
      headers: { get: (n) => (n.toLowerCase() === 'content-type' ? 'text/html' : null) },
      text: async () => (status === 200 ? PAGE : ''),
    };
  };
  return {
    fetch,
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
  };
}

/** Penyedia palsu: /embeddings memberi vektor deterministik per teks, /rerank memberi skor menurun. */
const providerFetch: FetchFn = async (url, init) => {
  const body = JSON.parse(init.body) as { input?: string[]; documents?: string[] };
  if (url.endsWith('/embeddings')) {
    return {
      status: 200,
      json: async () => ({
        data: (body.input ?? []).map((t, index) => ({
          index,
          embedding: [t.length % 7, (t.charCodeAt(0) || 1) % 5, 1],
        })),
        usage: { total_tokens: 5 },
      }),
    };
  }
  return {
    status: 200,
    json: async () => ({
      results: (body.documents ?? []).map((_, index) => ({ index, relevance_score: 1 - index * 0.1 })),
      usage: { total_tokens: 9 },
    }),
  };
};

const EMBED_ENV = {
  LLM_EMBED_MODEL: 'm',
  LLM_EMBED_BASE_URL: 'https://e/v1',
  LLM_EMBED_API_KEY: 'k',
  LLM_EMBED_TASK_QUERY: 'q',
  LLM_EMBED_TASK_PASSAGE: 'p',
};
const RERANK_ENV = { RERANK_BASE_URL: 'https://r/v1', RERANK_API_KEY: 'k', RERANK_MODEL: 'rm' };

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'urusin-cli-'));
  const sources = join(dir, 'sources.json');
  writeFileSync(
    sources,
    JSON.stringify({
      version: 1,
      catatan: 'uji',
      sources: [source('uji', URL_OK), source('rusak', URL_BAD)],
    }),
  );
  const gold = join(dir, 'gold.json');
  writeFileSync(
    gold,
    JSON.stringify([
      { id: 'a', pertanyaan: 'syarat akta kelahiran', relevan: [URL_OK] },
      { id: 'o', pertanyaan: 'resep rendang padang', relevan: [], luarCakupan: true },
    ]),
  );
  const pipelines = join(dir, 'pipelines.json');
  writeFileSync(
    pipelines,
    JSON.stringify([{ name: 'rr', config: { bm25: { stemmed: true }, rerank: true } }]),
  );
  return { dir, sources, gold, pipelines, db: join(dir, 'sub', 'rag.db'), cache: join(dir, 'cache.db') };
}

function io(over: Partial<CliIo> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const full: CliIo = { env: {}, log: (l) => out.push(l), error: (l) => err.push(l), ...over };
  return { out, err, io: full };
}

describe('ingestMain', () => {
  it('dry-run: tidak membuat db, tidak memanggil embedding', async () => {
    const s = setup();
    const t = io({ deps: pageDeps({ [URL_OK]: 200 }) });
    const code = await ingestMain(['--dry-run', '--sources', s.sources, '--db', s.db], t.io);
    expect(code).toBe(0);
    expect(t.out.at(-1)).toMatch(/^DRY-RUN selesai: 2 sumber/);
    expect(existsSync(s.db)).toBe(false);
  });
  it('tanpa embedding: BM25 saja; sumber 404 membuat exit code 1', async () => {
    const s = setup();
    const t = io({ deps: pageDeps({ [URL_OK]: 200 }) });
    const code = await ingestMain(['--sources', s.sources, '--db', s.db], t.io);
    expect(code).toBe(1);
    expect(t.out[0]).toMatch(/BM25 saja/);
    expect(t.out.some((l) => /^ingested\s+uji chunks=/.test(l))).toBe(true);
    expect(t.out.some((l) => /^error\s+rusak/.test(l))).toBe(true);
  });
  it('dengan embedding palsu dan --only: sukses exit 0, --vector-mode center diterima', async () => {
    const s = setup();
    const t = io({ env: EMBED_ENV, fetch: providerFetch, deps: pageDeps({ [URL_OK]: 200 }) });
    const code = await ingestMain(
      ['--sources', s.sources, '--db', s.db, '--only', 'uji', '--vector-mode', 'center', '--vector-k', '2'],
      t.io,
    );
    expect(code).toBe(0);
    expect(t.out.at(-1)).toMatch(/selesai: 2 sumber, 0 galat/);
  });
  it('--vector-mode tidak dikenal ditolak', async () => {
    const s = setup();
    await expect(ingestMain(['--sources', s.sources, '--vector-mode', 'x'], io().io)).rejects.toThrow(
      /vector-mode/,
    );
  });
});

describe('verifyMain / evalMain / matrixMain pada db hasil ingest', () => {
  const ingested = async () => {
    const s = setup();
    await ingestMain(['--sources', s.sources, '--db', s.db], io({ deps: pageDeps(BOTH_OK) }).io);
    return s;
  };

  it('verifyMain: sumber tak berubah -> exit 0 dan ringkasan kesegaran', async () => {
    const s = await ingested();
    const t = io({ deps: pageDeps(BOTH_OK) });
    expect(await verifyMain(['--sources', s.sources, '--db', s.db], t.io)).toBe(0);
    expect(t.out.some((l) => /^unchanged\s+uji/.test(l))).toBe(true);
    expect(t.out.at(-1)).toMatch(/^selesai: 2 sumber; berubah=0/);
  });
  it('verifyMain: HTTP 500 -> exit 1; db tetap ditutup', async () => {
    const s = await ingested();
    const t = io({ deps: pageDeps({ [URL_OK]: 500 }) });
    expect(await verifyMain(['--sources', s.sources, '--db', s.db], t.io)).toBe(1);
  });

  it('evalMain: BM25 saja tanpa embedding, tulis berkas dengan --write', async () => {
    const s = await ingested();
    const out = join(s.dir, 'docs', 'eval.md');
    const t = io();
    expect(await evalMain(['--gold', s.gold, '--db', s.db, '--write', '--out', out], t.io)).toBe(0);
    expect(t.err[0]).toMatch(/hanya mode A/);
    expect(readFileSync(out, 'utf8')).toMatch(/^# Evaluasi retrieval RAG/);
    expect(t.out.at(-1)).toMatch(/^ditulis:/);
  });
  it('evalMain: pipeline rerank tanpa reranker -> peringatan; dengan RERANK_* -> jalan', async () => {
    const s = await ingested();
    const none = io();
    await evalMain(['--gold', s.gold, '--db', s.db, '--pipelines', s.pipelines], none.io);
    expect(none.err.some((l) => /rerank menjadi no-op/.test(l))).toBe(true);
    const withRr = io({ env: { ...EMBED_ENV, ...RERANK_ENV }, fetch: providerFetch });
    expect(await evalMain(['--gold', s.gold, '--db', s.db, '--pipelines', s.pipelines], withRr.io)).toBe(0);
    expect(withRr.err).toEqual([]);
  });

  it('matrixMain: --gold wajib', async () => {
    await expect(matrixMain([], io().io)).rejects.toThrow(/--gold wajib/);
  });
  it('matrixMain: embedding, hybrid + rerank dengan penyedia palsu', async () => {
    const s = await ingested();
    const t = io({ env: { ...EMBED_ENV, ...RERANK_ENV }, fetch: providerFetch });
    const code = await matrixMain(
      [
        '--gold',
        s.gold,
        '--db',
        s.db,
        '--cache',
        s.cache,
        '--embed',
        'm:q:p',
        '--rerank',
        'rm',
        '--combo',
        'm:q:p',
        '--floors',
        '0,0.5',
      ],
      t.io,
    );
    expect(code).toBe(0);
    const text = t.out.join('\n');
    expect(text).toMatch(/## Hybrid: m \(task q \/ p\)/);
    expect(text).toMatch(/Rerank: rm/);
    expect(text).toMatch(/Embedding kueri tunggal:/);
    expect(text).toMatch(/lantai-0\.5/);
  });
  it('matrixMain: kredensial embedding/rerank belum diset -> galat', async () => {
    const s = await ingested();
    await expect(
      matrixMain(['--gold', s.gold, '--db', s.db, '--cache', s.cache, '--embed', 'm'], io().io),
    ).rejects.toThrow(/LLM_EMBED_BASE_URL/);
    await expect(
      matrixMain(['--gold', s.gold, '--db', s.db, '--cache', s.cache, '--rerank', 'rm'], io().io),
    ).rejects.toThrow(/RERANK_BASE_URL/);
  });
});

describe('agentEvalMain (jalur agen produksi)', () => {
  const ingestWith = async (env: Record<string, string>) => {
    const s = setup();
    const t = io({ env, fetch: providerFetch, deps: pageDeps({ [URL_OK]: 200 }) });
    await ingestMain(['--sources', s.sources, '--db', s.db, '--only', 'uji'], t.io);
    return s;
  };

  it('tanpa penyedia: BM25 murni, baris per gold, exit 0', async () => {
    const s = await ingestWith({});
    const t = io();
    expect(await agentEvalMain(['--gold', s.gold, '--db', s.db], t.io)).toBe(0);
    expect(t.out[0]).toBe('Jalur agen: vektor=mati, rerank=mati, k=4');
    const row = t.out.at(-1) ?? '';
    expect(row).toContain('| 2 (1/1) | 100.0% | 100.0% | 1.000 |');
    expect(row).toMatch(/\| bm25:2 \| off:2 \|$/);
    expect(t.err).toEqual([]);
  });

  it('embedding + rerank palsu: mode hybrid, tanpa fallback', async () => {
    const s = await ingestWith(EMBED_ENV);
    const t = io({ env: { ...EMBED_ENV, ...RERANK_ENV }, fetch: providerFetch });
    const code = await agentEvalMain(['--gold', s.gold, '--db', s.db, '--strict'], t.io);
    expect(code).toBe(0);
    expect(t.out[0]).toBe('Jalur agen: vektor=m, rerank=rm, k=4');
    // Korpus uji hanya satu chunk: rerank tidak perlu (< 2 kandidat), jadi status `off`, bukan fallback.
    expect(t.out.at(-1)).toMatch(/\| hybrid:2 \| off:2 \|$/);
    expect(t.err).toEqual([]);
  });

  it('embedding gagal: jatuh ke BM25 dilaporkan; --strict -> exit 1', async () => {
    const s = await ingestWith(EMBED_ENV);
    const down: FetchFn = async () => ({ status: 500, json: async () => ({}) });
    const t = io({ env: { ...EMBED_ENV, ...RERANK_ENV }, fetch: down });
    expect(await agentEvalMain(['--gold', s.gold, '--db', s.db, '--strict'], t.io)).toBe(1);
    expect(t.out.at(-1)).toContain('| bm25:2 |');
    expect(t.err[0]).toMatch(/jatuh ke fallback/);
  });
});
