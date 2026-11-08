import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { CliIo } from '../cli-io.js';
import { openDb, type Db } from '../db.js';
import { loadRealEmbedder } from '../embedder.js';
import { runIngest } from './ingest.js';
import { loadSources } from './sources.js';

/** `rag:ingest`; mengembalikan exit code (1 bila ada sumber galat). */
export async function ingestMain(argv: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      'dry-run': { type: 'boolean', default: false },
      only: { type: 'string' },
      sources: { type: 'string', default: '../../data/sources.json' },
      db: { type: 'string', default: '.cache/rag.db' },
      'vector-mode': { type: 'string', default: 'none' },
      'vector-k': { type: 'string' },
    },
  });

  const mode = values['vector-mode'];
  if (mode !== 'none' && mode !== 'center' && mode !== 'whiten') {
    throw new Error('--vector-mode harus none | center | whiten');
  }
  const sources = loadSources(resolve(values.sources));
  const dryRun = values['dry-run'] === true;
  let db: Db | undefined;
  if (!dryRun) {
    const path = resolve(values.db);
    mkdirSync(dirname(path), { recursive: true });
    db = openDb(path);
  }

  const real = dryRun ? null : await loadRealEmbedder(io.env, { fetch: io.fetch });
  if (!dryRun && !real) io.log('embedding tidak tersedia: mode BM25 saja');

  const reports = await runIngest({
    sources,
    only: values.only,
    dryRun,
    db,
    embed: real?.embed,
    embedModel: real?.model,
    vectorMode: mode,
    vectorK: values['vector-k'] ? Number(values['vector-k']) : undefined,
    deps: io.deps,
  });
  for (const r of reports) {
    const extra = `${r.chunks !== undefined ? ` chunks=${r.chunks}` : ''}${r.reason ? ` (${r.reason})` : ''}`;
    io.log(`${r.action.padEnd(8)} ${r.id}${extra}`);
  }
  const failed = reports.filter((r) => r.action === 'error').length;
  io.log(`${dryRun ? 'DRY-RUN ' : ''}selesai: ${reports.length} sumber, ${failed} galat`);
  db?.close();
  return failed ? 1 : 0;
}
