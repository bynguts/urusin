import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { CliIo } from '../cli-io.js';
import { openDb } from '../db.js';
import { loadRealEmbedder } from '../embedder.js';
import { loadGold } from './gold.js';
import { loadRealRerankDeps } from './llm-rerank.js';
import { createQueryStages } from './query-stages.js';
import { renderMarkdown, runEval, type NamedPipeline } from './run.js';

/** `rag:eval`; mencetak tabel Markdown dan menulisnya ke `--out` bila `--write`. */
export async function evalMain(argv: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args: argv,
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
  const real = await loadRealEmbedder(io.env, { fetch: io.fetch });
  if (!real) io.error('embedding tidak tersedia: hanya mode A (BM25) yang dievaluasi');

  const pipelines = values.pipelines
    ? (JSON.parse(readFileSync(resolve(values.pipelines), 'utf8')) as NamedPipeline[])
    : undefined;
  const wantsRerank = pipelines?.some((p) => p.config.rerank) === true;
  const rerank = wantsRerank ? await loadRealRerankDeps(io.env, undefined, io.fetch) : null;
  if (wantsRerank && !rerank) io.error('LLM untuk rerank tidak tersedia: tahap rerank menjadi no-op');
  const stages = createQueryStages({ rerank: rerank ?? undefined });
  const report = await runEval({ db, gold, embed: real?.embed ?? null, pipelines, stages });
  db.close();

  const md = renderMarkdown(report);
  io.log(md);
  if (values.write) {
    const header = `# Evaluasi retrieval RAG\n\nDibuat oleh \`pnpm rag:eval --write\`. Mode vektor aktif dipilih dari tabel ini; jangan diasumsikan.\n\n`;
    const out = resolve(values.out);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, header + md);
    io.log(`ditulis: ${out}`);
  }
  return 0;
}
