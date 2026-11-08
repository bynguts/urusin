/** Utilitas tes (tidak diekspor dari index). */
import type { Db } from './db.js';

export * from './pii-fixtures.js';

/** Seluruh isi semua tabel sebagai satu string (untuk grep PII). */
export function dumpDb(db: Db): string {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  return tables
    .map((t) => JSON.stringify(db.prepare(`SELECT * FROM "${t.name}"`).all()))
    .join(String.fromCharCode(10));
}

import type { CapabilityFlags, ChatProvider } from '@urusin/llm';
import { createDemoRagDb } from './demo.js';
import { openHarnessDb } from './db.js';
import { createHarness, type HarnessOptions } from './runtime.js';

export type TestEnvOptions = Omit<HarnessOptions, 'ragDb'> & {
  provider: ChatProvider;
  caps?: Partial<CapabilityFlags>;
  ragDb?: Db;
};

/** Lingkungan agen untuk tes: korpus demo + DB memori. */
export function makeEnv(opts: TestEnvOptions) {
  return createHarness({ ...opts, db: opts.db ?? openHarnessDb(), ragDb: opts.ragDb ?? createDemoRagDb() });
}
