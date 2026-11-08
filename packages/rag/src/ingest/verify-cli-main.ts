import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { CliIo } from '../cli-io.js';
import { openDb } from '../db.js';
import { loadSources } from './sources.js';
import { sourceFreshness } from './state.js';
import { runVerify } from './verify.js';

/** `rag:verify`; exit code 1 bila ada sumber galat. */
export async function verifyMain(argv: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      only: { type: 'string' },
      sources: { type: 'string', default: '../../data/sources.json' },
      db: { type: 'string', default: '.cache/rag.db' },
    },
  });
  const db = openDb(resolve(values.db));
  try {
    const reports = await runVerify({
      db,
      sources: loadSources(resolve(values.sources)),
      only: values.only,
      deps: io.deps,
      ...(io.deps ? { minIntervalMs: 0 } : {}),
    });
    for (const r of reports) io.log(`${r.action.padEnd(9)} ${r.id}${r.reason ? ` (${r.reason})` : ''}`);
    const f = sourceFreshness(db);
    io.log(
      `selesai: ${reports.length} sumber; berubah=${f.changed.length}; umur verifikasi tertua=${f.oldestAgeDays ?? '-'} hari`,
    );
    return reports.some((r) => r.action === 'error') ? 1 : 0;
  } finally {
    db.close();
  }
}
