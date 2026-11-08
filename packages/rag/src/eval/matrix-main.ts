import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { CliIo } from '../cli-io.js';
import Database from 'better-sqlite3';
import { openDb } from '../db.js';
import { costUsd, createBreaker, priceFromEnv } from '../providers/breaker.js';
import { createHttpEmbedder, withEmbedCache } from '../providers/embedder.js';
import { newStats, percentile, type ProviderStats } from '../providers/http.js';
import { createHttpRerankEndpoint } from '../providers/rerank-endpoint.js';
import { loadGold } from './gold.js';
import { createQueryStages } from './query-stages.js';
import { renderMarkdown, runEval, type NamedPipeline, type RetrievalPipeline } from './run.js';

/**
 * Matriks evaluasi penyedia nyata (embedding + rerank). Kredensial dari env (tidak pernah dicetak):
 *   LLM_EMBED_BASE_URL / LLM_EMBED_API_KEY, RERANK_BASE_URL / RERANK_API_KEY.
 * Model: --embed "model[:taskQuery:taskPassage],..." dan --rerank "model,...".
 * Panggilan kueri tidak di-cache supaya latensi nyata; hanya dokumen yang di-cache per (model, task, hash).
 */
export async function matrixMain(argv: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      gold: { type: 'string' },
      db: { type: 'string', default: '.cache/rag.db' },
      cache: { type: 'string', default: '.cache/embed-cache.db' },
      embed: { type: 'string', default: '' },
      rerank: { type: 'string', default: '' },
      floors: { type: 'string', default: '-1,-0.5,0,0.05,0.1,0.15,0.2,0.3,0.4,0.5,0.6' },
      coverage: { type: 'string', default: '0.1' },
      /** "model:taskQuery:taskPassage": gabungkan vektor ini dengan tiap reranker (hybrid + rerank). */
      combo: { type: 'string', default: '' },
      'combo-transform': { type: 'string', default: 'center' },
    },
  });
  if (!values.gold) throw new Error('--gold wajib');

  const gold = loadGold(resolve(values.gold));
  const db = openDb(resolve(values.db), { readonly: true });
  const cachePath = resolve(values.cache ?? '.cache/embed-cache.db');
  mkdirSync(dirname(cachePath), { recursive: true });
  const cacheDb = new Database(cachePath);
  const minCoverage = Number(values.coverage);
  const env = io.env;

  const fmt = (s: ProviderStats, perQuery: number, pricePerMTok = 0) =>
    `p50 ${percentile(s.latenciesMs, 50).toFixed(0)} ms, p95 ${percentile(s.latenciesMs, 95).toFixed(0)} ms, ` +
    `${(s.tokens / Math.max(1, perQuery)).toFixed(1)} token/kueri, ` +
    `USD ${(costUsd(s.tokens, pricePerMTok) / Math.max(1, perQuery)).toFixed(6)}/kueri, galat ${s.errors}`;

  const stages0 = createQueryStages();
  const base: NamedPipeline[] = [
    { name: 'stem+expand', config: { bm25: { stemmed: true }, expand: true } },
    {
      name: `stem+expand+abstain-${minCoverage}`,
      config: { bm25: { stemmed: true }, expand: true, abstain: { minCoverage } },
    },
  ];

  for (const spec of (values.embed ?? '').split(',').filter(Boolean)) {
    const [model = '', taskQuery, taskPassage] = spec.split(':');
    const baseUrl = env['LLM_EMBED_BASE_URL'];
    const apiKey = env['LLM_EMBED_API_KEY'];
    if (!baseUrl || !apiKey) throw new Error('LLM_EMBED_BASE_URL / LLM_EMBED_API_KEY belum diset');
    const cfg = { baseUrl, apiKey, model };
    const pStats = newStats();
    const embedQuery = createHttpEmbedder(cfg, taskQuery, { fetch: io.fetch });
    const embed = withEmbedCache(
      createHttpEmbedder(cfg, taskPassage, { stats: pStats, fetch: io.fetch }),
      cacheDb,
      {
        model,
        task: taskPassage,
      },
    );
    const report = await runEval({
      db,
      gold,
      embed,
      embedQuery,
      ignoreStoredVectors: true,
      pipelines: base,
      stages: stages0,
    });
    io.log(`\n## Hybrid: ${model} (task ${taskQuery ?? '-'} / ${taskPassage ?? '-'})\n`);
    io.log(renderMarkdown(report));
    // Latensi per kueri tunggal (seperti produksi), bukan satu batch 50 kueri.
    const single = newStats();
    const one = createHttpEmbedder(cfg, taskQuery, { stats: single, fetch: io.fetch });
    for (const g of gold.slice(0, 20)) await one([g.pertanyaan]);
    io.log(
      `Embedding kueri tunggal: ${fmt(single, 20, priceFromEnv(env, 'LLM_EMBED_PRICE_PER_MTOK'))}. Embedding dokumen baru (di luar cache): ${pStats.tokens} token.`,
    );
  }

  const comboMode = (values['combo-transform'] ?? 'center') as 'none' | 'center' | 'whiten';
  const combo = (() => {
    if (!values.combo) return null;
    const [model = '', tq, tp] = values.combo.split(':');
    const baseUrl = env['LLM_EMBED_BASE_URL'];
    const apiKey = env['LLM_EMBED_API_KEY'];
    if (!baseUrl || !apiKey) throw new Error('LLM_EMBED_BASE_URL / LLM_EMBED_API_KEY belum diset');
    const cfg = { baseUrl, apiKey, model };
    return {
      model,
      embedQuery: createHttpEmbedder(cfg, tq, { fetch: io.fetch }),
      embed: withEmbedCache(createHttpEmbedder(cfg, tp, { fetch: io.fetch }), cacheDb, { model, task: tp }),
    };
  })();
  const floors = (values.floors ?? '').split(',').filter(Boolean).map(Number);
  for (const model of (values.rerank ?? '').split(',').filter(Boolean)) {
    const baseUrl = env['RERANK_BASE_URL'];
    const apiKey = env['RERANK_API_KEY'];
    if (!baseUrl || !apiKey) throw new Error('RERANK_BASE_URL / RERANK_API_KEY belum diset');
    const rStats = newStats();
    const endpoint = createHttpRerankEndpoint(
      { baseUrl, apiKey, model },
      // Eval mengukur kualitas: retry untuk 429 dan tanpa pemutus sirkuit (produksi: 3 s, tanpa retry, dengan pemutus).
      { stats: rStats, maxRetries: 4, timeoutMs: 20_000, fetch: io.fetch },
      createBreaker({ threshold: Number.MAX_SAFE_INTEGER }),
    );
    const stages = createQueryStages({ rerank: { endpoint, timeoutMs: 30_000 } });
    const withVec = (c: RetrievalPipeline): RetrievalPipeline =>
      combo ? { ...c, vector: { transform: { mode: comboMode } } } : c;
    const raw: NamedPipeline[] = [
      { name: 'stem+expand+rerank', config: { bm25: { stemmed: true }, expand: true, rerank: true } },
      {
        name: `rerank+abstain-${minCoverage}`,
        config: { bm25: { stemmed: true }, expand: true, rerank: true, abstain: { minCoverage } },
      },
      ...floors.map<NamedPipeline>((f) => ({
        name: `rerank+abstain-${minCoverage}+lantai-${f}`,
        config: {
          bm25: { stemmed: true },
          expand: true,
          rerank: true,
          abstain: { minCoverage, minRerankScore: f },
        },
      })),
      ...floors.map<NamedPipeline>((f) => ({
        name: `rerank-saja+lantai-${f}`,
        config: {
          bm25: { stemmed: true },
          expand: true,
          rerank: true,
          abstain: { minCoverage: 0, minRerankScore: f },
        },
      })),
    ];
    const pipelines = raw.map((p) => ({ ...p, config: withVec(p.config) }));
    const report = await runEval({
      db,
      gold,
      embed: combo?.embed ?? null,
      ...(combo ? { embedQuery: combo.embedQuery, ignoreStoredVectors: true } : {}),
      pipelines,
      stages,
    });
    io.log(`\n## ${combo ? `Hybrid (${combo.model}, ${comboMode}) + ` : ''}Rerank: ${model}\n`);
    io.log(renderMarkdown(report));
    io.log(`Rerank: ${fmt(rStats, gold.length, priceFromEnv(env, 'RERANK_PRICE_PER_MTOK'))}.`);
  }
  db.close();
  cacheDb.close();
  return 0;
}
