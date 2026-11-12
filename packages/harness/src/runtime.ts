import type { RagSearcher } from '@urusin/rag';
import { ALL_ON, type CapabilityFlags, type ChatProvider, type Prices } from '@urusin/llm';
import { redactingProvider } from './guarded-llm.js';
import type { AgentDeps } from './agent.js';
import { EventBus } from './bus.js';
import { builtinTools } from './builtin-tools.js';
import { openHarnessDb, type Db } from './db.js';
import type { CacheJawaban } from './grounding.js';
import { DEFAULT_QUOTA, QuotaMeter, type QuotaConfig } from './quota.js';
import { ingatanIngat, type PenyimpanIngatan } from './ingatan.js';
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
  /** Pencari produksi (hybrid + rerank) atas ragDb; tanpa ini retrieval BM25 sinkron. */
  ragSearch?: RagSearcher['search'];
  tools?: readonly ToolDef[];
  /** Rahasia HMAC pemetaan placeholder PII (lihat `StoreOptions.piiKey`). */
  piiKey?: string;
  /** Ingatan warga lintas urusan (ADR 0031): bila ada, tool `ingatan__ingat` ikut terdaftar. */
  ingatan?: PenyimpanIngatan;
  /** Cache keluaran generator jawaban bersumber (mode LLM produksi); tanpa ini tiap jawaban memanggil model. */
  cacheJawaban?: CacheJawaban;
};

/** Komposisi akar: store + registry + kuota + tracer + bus → `AgentDeps` siap dipakai `runTurn`. */
export function createHarness(opts: HarnessOptions) {
  const now = opts.now ?? (() => new Date());
  const store = new HarnessStore(opts.db ?? openHarnessDb(), {
    now,
    ...(opts.piiKey ? { piiKey: opts.piiKey } : {}),
  });
  const registry = new ToolRegistry([
    ...(opts.tools ?? builtinTools()),
    ...(opts.ingatan ? [ingatanIngat] : []),
  ]);
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
    ragSearch: opts.ragSearch,
    bus,
    config: opts.config,
    now,
    locks: new Set(),
    ingatan: opts.ingatan,
    cacheJawaban: opts.cacheJawaban,
  };
  return { deps, store, registry, quota, bus };
}
