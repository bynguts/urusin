import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  DemoProvider,
  HarnessError,
  createDemoRagDb,
  createHarness,
  openHarnessDb,
  prepareTurn,
  type Db,
  type HarnessOptions,
} from '@urusin/harness';
import {
  ALL_OFF,
  CAPABILITIES,
  OpenAIProvider,
  applyForcedOff,
  loadLlmConfig,
  probeCapabilities,
  type CapabilityFlags,
  type ChatProvider,
  type Prices,
} from '@urusin/llm';
import { openDb } from '@urusin/rag';

/** Konfigurasi runtime dari env (dibaca sekali saat boot). Semua opsional kecuali yang bertanda. */
export type RuntimeConfig = {
  /** Origin publik: pemeriksaan CSRF membandingkan header Origin PERSIS dengan ini. */
  publicOrigin: string;
  dbPath: string;
  ragDbPath?: string | undefined;
  /** Jeda sebelum loop LLM dibatalkan setelah semua pelanggan SSE putus. */
  disconnectGraceMs: number;
  heartbeatMs: number;
};

export function readConfig(env: Record<string, string | undefined> = process.env): RuntimeConfig {
  const num = (v: string | undefined, d: number) =>
    v && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : d;
  const dbUrl = env.URUSIN_DB_PATH ?? env.DATABASE_URL?.replace(/^file:/, '') ?? '.data/urusin.sqlite';
  return {
    publicOrigin: env.URUSIN_PUBLIC_ORIGIN?.trim() || 'http://localhost:3000',
    dbPath: dbUrl,
    ragDbPath: env.URUSIN_RAG_DB?.trim() || undefined,
    disconnectGraceMs: num(env.URUSIN_SSE_DISCONNECT_GRACE_MS, 10_000),
    heartbeatMs: num(env.URUSIN_SSE_HEARTBEAT_MS, 15_000),
  };
}

export function publicOrigin(): string {
  return readConfig().publicOrigin;
}

export type Runtime = ReturnType<typeof createHarness> & {
  config: RuntimeConfig;
  /** 'demo' = FakeProvider berskrip (tanpa kunci LLM); 'llm' = provider OpenAI-compatible nyata. */
  mode: 'demo' | 'llm';
  /** Turn yang sedang berjalan per urusan (untuk pembatalan saat klien putus). */
  running: Map<string, AbortController>;
};

type RuntimeInit = {
  config?: Partial<RuntimeConfig>;
  provider?: ChatProvider;
  harness?: Partial<HarnessOptions>;
  mode?: Runtime['mode'];
};

/** Rakit runtime dari komponen yang diberikan (dipakai tes dan `getRuntime`). */
export function createRuntime(init: RuntimeInit = {}): Runtime {
  const config = { ...readConfig(), ...init.config };
  if (config.dbPath !== ':memory:') mkdirSync(dirname(config.dbPath), { recursive: true });
  const db = openHarnessDb(config.dbPath);
  const ragDb: Db = config.ragDbPath ? openDb(config.ragDbPath, { readonly: true }) : createDemoRagDb();
  const h = createHarness({
    provider: init.provider ?? new DemoProvider(),
    db,
    ragDb,
    ...init.harness,
  });
  h.store.abandonRunningTurns();
  return { ...h, config, mode: init.mode ?? 'demo', running: new Map() };
}

function pinnedCaps(raw: string | undefined): CapabilityFlags | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const flags = { ...ALL_OFF } as CapabilityFlags;
    for (const c of CAPABILITIES) flags[c] = parsed[c] === true;
    return flags;
  } catch {
    return undefined;
  }
}

async function buildFromEnv(): Promise<Runtime> {
  const env = process.env;
  const haveLlm = Boolean(env.LLM_BASE_URL && env.LLM_API_KEY && env.LLM_AGENT_MODEL);
  if (!haveLlm) return createRuntime({ mode: 'demo' });

  const cfg = loadLlmConfig(env);
  const provider = new OpenAIProvider(cfg);
  // LLM_CAPS_PIN (rencana §3.11) menang atas probe; tanpa pin, probe saat boot (gagal = mode degraded).
  let caps = pinnedCaps(env.LLM_CAPS_PIN);
  if (!caps) {
    try {
      const report = await probeCapabilities({ provider, models: cfg.models });
      caps = applyForcedOff(report, cfg.forcedOff).flags;
    } catch {
      caps = { ...ALL_OFF };
    }
  }
  const prices: Prices = cfg.prices;
  const num = (v: string | undefined, d: number) => (v && v.trim() !== '' ? Number(v) : d);
  return createRuntime({
    mode: 'llm',
    provider,
    harness: {
      model: cfg.models.agent,
      caps,
      prices,
      quota: {
        idrPerUsd: num(env.IDR_PER_USD, 16_500),
        sessionTurnCap: num(env.URUSIN_SESSION_TURN_CAP, 40),
        sessionTokenCap: num(env.URUSIN_SESSION_TOKEN_CAP, 200_000),
        dailyIdrCap: num(env.URUSIN_DAILY_IDR_CAP, 0),
      },
    },
  });
}

let instance: Promise<Runtime> | undefined;

/** Singleton proses (server tunggal). */
export function getRuntime(): Promise<Runtime> {
  instance ??= buildFromEnv();
  return instance;
}

/** Hanya untuk tes: ganti/hapus singleton. */
export function setRuntimeForTests(rt: Runtime | undefined): void {
  instance = rt ? Promise.resolve(rt) : undefined;
}

/** Klaim turn secara sinkron lalu jalankan di latar belakang; hasilnya mengalir lewat tabel events + bus. */
export function startTurnInBackground(
  rt: Runtime,
  args: { urusanId: string; userText: string; expectedVersion?: number },
): { turnId: string } {
  const prepared = prepareTurn(rt.deps, args); // melempar HarnessError 409/404 sebelum apa pun dialirkan
  const ctrl = new AbortController();
  rt.running.set(args.urusanId, ctrl);
  void prepared
    .run(ctrl.signal)
    .catch(() => undefined)
    .finally(() => {
      if (rt.running.get(args.urusanId) === ctrl) rt.running.delete(args.urusanId);
    });
  return { turnId: prepared.turnId };
}

export function isHarnessError(e: unknown): e is HarnessError {
  return e instanceof HarnessError;
}
