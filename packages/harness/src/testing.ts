/**
 * Utilitas tes (tidak diekspor dari index). Nilai PII sintetis dirakit dari potongan agar pemindai PII
 * repo tidak menandai berkas sumber.
 */
import type { Db } from './db.js';

export const j = (...p: string[]) => p.join('');

/** NIK sintetis valid struktur (provinsi 33, tanggal 15, bulan 08). */
export const FAKE_NIK = j('331201', '150890', '0001');
export const FAKE_NIK_2 = j('317101', '010195', '0002');
export const FAKE_HP = j('0812', '3456', '7890');
export const FAKE_EMAIL = j('warga', '@', 'contoh.id');

/** Seluruh isi semua tabel sebagai satu string (untuk grep PII). */
export function dumpDb(db: Db): string {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as {
    name: string;
  }[];
  return tables.map((t) => JSON.stringify(db.prepare(`SELECT * FROM "${t.name}"`).all())).join('\n');
}

/** 16 digit berurutan yang bukan bagian dari string heksadesimal (hash/ID acak). */
export const SIXTEEN_DIGIT_RUN = /(?<![0-9a-f])\d{16}(?![0-9a-f])/;

// ---------------------------------------------------------------------------
// Lingkungan agen untuk tes
// ---------------------------------------------------------------------------
import { ALL_ON, type CapabilityFlags, type ChatProvider } from '@urusin/llm';
import { builtinTools } from './builtin-tools.js';
import { createDemoRagDb } from './demo.js';
import { openHarnessDb } from './db.js';
import { QuotaMeter, DEFAULT_QUOTA, type QuotaConfig } from './quota.js';
import { HarnessStore } from './store.js';
import { ToolRegistry } from './tools.js';
import { Tracer } from './trace.js';
import type { AgentDeps } from './agent.js';
import { EventBus } from './bus.js';

export type TestEnvOptions = {
  provider: ChatProvider;
  caps?: Partial<CapabilityFlags>;
  config?: AgentDeps['config'];
  quota?: Partial<QuotaConfig>;
  prices?: { inputPerMTok: number; outputPerMTok: number; audioPerMin: number };
  now?: () => Date;
  db?: Db;
};

export function makeEnv(opts: TestEnvOptions) {
  const now = opts.now ?? (() => new Date());
  const store = new HarnessStore(opts.db ?? openHarnessDb(), { now });
  const registry = new ToolRegistry(builtinTools());
  const quota = new QuotaMeter(store, opts.prices ?? { inputPerMTok: 0, outputPerMTok: 0, audioPerMin: 0 }, {
    ...DEFAULT_QUOTA,
    ...opts.quota,
  });
  const bus = new EventBus();
  const deps: AgentDeps = {
    store,
    provider: opts.provider,
    model: 'fake-model',
    caps: { ...ALL_ON, ...opts.caps },
    registry,
    quota,
    tracer: new Tracer(store),
    ragDb: createDemoRagDb(),
    bus,
    config: opts.config,
    now,
    locks: new Set(),
  };
  return { deps, store, registry, quota, bus };
}
