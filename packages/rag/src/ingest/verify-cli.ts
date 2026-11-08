import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openDb } from '../db.js';
import { loadSources } from './sources.js';
import { sourceFreshness } from './state.js';
import { runVerify } from './verify.js';

const { values } = parseArgs({
  options: {
    only: { type: 'string' },
    sources: { type: 'string', default: '../../data/sources.json' },
    db: { type: 'string', default: '.cache/rag.db' },
  },
});

const db = openDb(resolve(values.db));
const reports = await runVerify({ db, sources: loadSources(resolve(values.sources)), only: values.only });
for (const r of reports) console.log(`${r.action.padEnd(9)} ${r.id}${r.reason ? ` (${r.reason})` : ''}`);
const f = sourceFreshness(db);
console.log(
  `selesai: ${reports.length} sumber; berubah=${f.changed.length}; umur verifikasi tertua=${f.oldestAgeDays ?? '-'} hari`,
);
db.close();
process.exitCode = reports.some((r) => r.action === 'error') ? 1 : 0;
