import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openDb } from '../db.js';
import { loadRealEmbedder } from '../embedder.js';
import { loadGold } from './gold.js';
import { renderMarkdown, runEval } from './run.js';

const { values } = parseArgs({
  options: {
    gold: { type: 'string', default: '../../data/rag-gold.json' },
    db: { type: 'string', default: '.cache/rag.db' },
    out: { type: 'string', default: '../../docs/rag-eval.md' },
    write: { type: 'boolean', default: false },
  },
});

const gold = loadGold(resolve(values.gold));
const db = openDb(resolve(values.db), { readonly: true });
const real = await loadRealEmbedder();
if (!real) console.error('embedding tidak tersedia: hanya mode A (BM25) yang dievaluasi');

const report = await runEval({ db, gold, embed: real?.embed ?? null });
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
