import { ALL_ON, type CapabilityFlags, type ChatProvider, type Prices } from '@urusin/llm';
import { redactingProvider } from './guarded-llm.js';
import type { AgentDeps } from './agent.js';
import { EventBus } from './bus.js';
import { builtinTools } from './builtin-tools.js';
import { openHarnessDb, type Db } from './db.js';
import { DEFAULT_QUOTA, QuotaMeter, type QuotaConfig } from './quota.js';
import { HarnessStore } from './store.js';
import { ToolRegistry, type ToolDef } from './tools.js';
import { Tracer } from './trace.js';

export type HarnessOptions = {
  provider: ChatProvider;
  model?: string;
  caps?: Partial<CapabilityFlags>;
  config?: AgentDeps['config'];
  quota?: Partial<QuotaConfig>;
  prices?: Prices;
  now?: () => Date;
  /** Database harness (default: memori). */
  db?: Db;
  /** Basis pengetahuan RAG untuk tool retrieval. */
  ragDb?: Db;
  tools?: readonly ToolDef[];
};

/** Komposisi akar: store + registry + kuota + tracer + bus → `AgentDeps` siap dipakai `runTurn`. */
export function createHarness(opts: HarnessOptions) {
  const now = opts.now ?? (() => new Date());
  const store = new HarnessStore(opts.db ?? openHarnessDb(), { now });
  const registry = new ToolRegistry(opts.tools ?? builtinTools());
  const quota = new QuotaMeter(store, opts.prices ?? { inputPerMTok: 0, outputPerMTok: 0, audioPerMin: 0 }, {
    ...DEFAULT_QUOTA,
    ...opts.quota,
  });
  const bus = new EventBus();
  const deps: AgentDeps = {
    store,
    provider: redactingProvider(opts.provider),
    model: opts.model ?? 'fake-model',
    caps: { ...ALL_ON, ...opts.caps },
    registry,
    quota,
    tracer: new Tracer(store),
    ragDb: opts.ragDb,
    bus,
    config: opts.config,
    now,
    locks: new Set(),
  };
  return { deps, store, registry, quota, bus };
}
