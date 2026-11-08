import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openDb } from '../db.js';
import { runIngest } from './ingest.js';
import { loadSources } from './sources.js';

const { values } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    only: { type: 'string' },
    sources: { type: 'string', default: '../../data/sources.json' },
    db: { type: 'string', default: '.cache/rag.db' },
  },
});

const sources = loadSources(resolve(values.sources));
const dryRun = values['dry-run'] === true;
let db;
if (!dryRun) {
  const path = resolve(values.db);
  mkdirSync(dirname(path), { recursive: true });
  db = openDb(path);
}

const reports = await runIngest({ sources, only: values.only, dryRun, db });
for (const r of reports) {
  const extra = r.chunks !== undefined ? ` chunks=${r.chunks}` : r.reason ? ` (${r.reason})` : '';
  console.log(`${r.action.padEnd(8)} ${r.id}${extra}`);
}
const failed = reports.filter((r) => r.action === 'error').length;
console.log(`${dryRun ? 'DRY-RUN ' : ''}selesai: ${reports.length} sumber, ${failed} galat`);
db?.close();
process.exitCode = failed ? 1 : 0;
