import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openDb } from '../db.js';
import { loadRealEmbedder } from '../embedder.js';
import { loadGold } from './gold.js';
import { loadRealRerankDeps } from './llm-rerank.js';
import { createQueryStages } from './query-stages.js';
import { renderMarkdown, runEval, type NamedPipeline } from './run.js';

const { values } = parseArgs({
  options: {
    gold: { type: 'string', default: '../../data/rag-gold.json' },
    db: { type: 'string', default: '.cache/rag.db' },
    out: { type: 'string', default: '../../docs/rag-eval.md' },
    write: { type: 'boolean', default: false },
    /** Berkas JSON: larik { name, config: RetrievalPipeline }. Tahap tanpa implementasi menjadi no-op. */
    pipelines: { type: 'string' },
  },
});

const gold = loadGold(resolve(values.gold));
const db = openDb(resolve(values.db), { readonly: true });
const real = await loadRealEmbedder();
if (!real) console.error('embedding tidak tersedia: hanya mode A (BM25) yang dievaluasi');

const pipelines = values.pipelines
  ? (JSON.parse(readFileSync(resolve(values.pipelines), 'utf8')) as NamedPipeline[])
  : undefined;
const rerank = pipelines?.some((p) => p.config.rerank) ? await loadRealRerankDeps() : null;
if (pipelines?.some((p) => p.config.rerank) && !rerank)
  console.error('LLM untuk rerank tidak tersedia: tahap rerank menjadi no-op');
const stages = createQueryStages({ rerank: rerank ?? undefined });
const report = await runEval({ db, gold, embed: real?.embed ?? null, pipelines, stages });
db.close();

const md = renderMarkdown(report);
console.log(md);
if (values.write) {
  const header = `# Evaluasi retrieval RAG\n\nDibuat oleh \`pnpm rag:eval --write\`. Mode vektor aktif dipilih dari tabel ini; jangan diasumsikan.\n\n`;
  const out = resolve(values.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, header + md);
  console.log(`ditulis: ${out}`);
}
