import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  DemoProvider,
  HarnessError,
  createDemoRagDb,
  createHarness,
  openHarnessDb,
  prepareTurn,
  toEvent,
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
import type { EventPayload, UrusinEvent } from '@urusin/contracts';
import { RateLimiter } from './limiter.js';
import { setRunningTurnsSource } from './running-turns.js';

/** Konfigurasi runtime dari env (dibaca sekali saat boot). Semua opsional kecuali yang bertanda. */
export type RuntimeConfig = {
  /** Origin publik: pemeriksaan CSRF membandingkan header Origin PERSIS dengan ini. */
  publicOrigin: string;
  dbPath: string;
  ragDbPath?: string | undefined;
  /** Jeda sebelum loop LLM dibatalkan setelah semua pelanggan SSE putus. */
  disconnectGraceMs: number;
  heartbeatMs: number;
  /** Batas laju: urusan baru per jam dan turn per menit, masing-masing per IP dan per sesi. */
  buatPerJamIp: number;
  buatPerJamSesi: number;
  turnPerMenitIp: number;
  turnPerMenitSesi: number;
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
    buatPerJamIp: num(env.URUSIN_LIMIT_BUAT_IP_PER_JAM, 20),
    buatPerJamSesi: num(env.URUSIN_LIMIT_BUAT_SESI_PER_JAM, 10),
    turnPerMenitIp: num(env.URUSIN_LIMIT_TURN_IP_PER_MENIT, 30),
    turnPerMenitSesi: num(env.URUSIN_LIMIT_TURN_SESI_PER_MENIT, 20),
  };
}

export function publicOrigin(): string {
  return readConfig().publicOrigin;
}

/** Status korpus RAG yang dipakai runtime (dilaporkan /api/health). */
export type RagInfo =
  | { status: 'demo'; chunks: number }
  | { status: 'ready'; chunks: number; vectors: number; vectorModel: string | null };

/** Hitung isi korpus yang sudah dibuka; `ready` hanya untuk berkas URUSIN_RAG_DB, `demo` untuk korpus contoh. */
export function ragInfo(ragDb: Db, fromFile: boolean): RagInfo {
  const count = (sql: string) => (ragDb.prepare(sql).get() as { n: number }).n;
  const chunks = count('SELECT count(*) AS n FROM chunks');
  if (!fromFile) return { status: 'demo', chunks };
  const t = ragDb.prepare('SELECT model FROM vector_transform WHERE id = 1').get() as
    { model: string | null } | undefined;
  return {
    status: 'ready',
    chunks,
    vectors: count('SELECT count(*) AS n FROM chunk_vectors'),
    vectorModel: t?.model ?? null,
  };
}

export type Runtime = ReturnType<typeof createHarness> & {
  config: RuntimeConfig;
  /** Korpus RAG yang terbuka (dihitung sekali saat runtime dirakit). */
  rag: RagInfo;
  /** 'demo' = FakeProvider berskrip (tanpa kunci LLM); 'llm' = provider OpenAI-compatible nyata. */
  mode: 'demo' | 'llm';
  /** Turn yang sedang berjalan per urusan (untuk pembatalan saat klien putus). */
  running: Map<string, AbortController>;
  /** Catat + siarkan satu event di luar turn (hasil eksekusi, konfirmasi): sumber kebenaran tetap tabel events. */
  publish(urusanId: string, e: EventPayload): UrusinEvent;
  /** Pembatas laju per aksi; kunci IP dan sesi dihitung terpisah. */
  limits: Record<'buat' | 'turn', { ip: RateLimiter; sesi: RateLimiter }>;
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
  h.store.reapExpiredTurns();
  const publish = (urusanId: string, e: EventPayload): UrusinEvent => {
    const { type, ...isi } = e;
    const ev = toEvent(h.store.appendEvent(urusanId, type, isi));
    h.bus.publish(urusanId, ev);
    return ev;
  };
  const running = new Map<string, AbortController>();
  setRunningTurnsSource(() => running.size);
  const jam = 3_600_000;
  const menit = 60_000;
  const limits: Runtime['limits'] = {
    buat: {
      ip: new RateLimiter(config.buatPerJamIp, jam),
      sesi: new RateLimiter(config.buatPerJamSesi, jam),
    },
    turn: {
      ip: new RateLimiter(config.turnPerMenitIp, menit),
      sesi: new RateLimiter(config.turnPerMenitSesi, menit),
    },
  };
  const rag = ragInfo(ragDb, Boolean(config.ragDbPath));
  return { ...h, config, rag, mode: init.mode ?? 'demo', running, publish, limits };
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

const num = (v: string | undefined, d: number) => (v && v.trim() !== '' ? Number(v) : d);

/**
 * Kunci HMAC placeholder PII dari env: base64, minimal 32 byte. Di mode LLM wajib (kunci acak per proses membuat token
 * placeholder berbeda antar instance blue/green dan antar restart). Mode demo/dev boleh tanpa kunci (acak per proses).
 */
export function piiKeyFromEnv(env: Record<string, string | undefined>, wajib: boolean): string | undefined {
  const raw = env.URUSIN_PII_KEY?.trim();
  if (!raw) {
    if (wajib) throw new Error('URUSIN_PII_KEY wajib di mode LLM (base64 dari minimal 32 byte acak)');
    return undefined;
  }
  if (Buffer.from(raw, 'base64').length < 32)
    throw new Error('URUSIN_PII_KEY terlalu pendek: butuh base64 dari minimal 32 byte');
  return raw;
}

/**
 * Kuota dari env. Mode LLM menolak boot tanpa batas biaya harian yang berhingga > 0 (0 atau NaN = tanpa batas
 * berarti tagihan tak terbatas), dan setiap angka lain harus berhingga.
 */
export function quotaFromEnv(env: Record<string, string | undefined>) {
  const quota = {
    idrPerUsd: num(env.IDR_PER_USD, 16_500),
    sessionTurnCap: num(env.URUSIN_SESSION_TURN_CAP, 40),
    sessionTokenCap: num(env.URUSIN_SESSION_TOKEN_CAP, 200_000),
    dailyIdrCap: num(env.URUSIN_DAILY_IDR_CAP, 0),
  };
  for (const [k, v] of Object.entries(quota)) {
    if (!Number.isFinite(v) || v < 0) throw new Error(`konfigurasi kuota tidak valid: ${k}=${String(v)}`);
  }
  if (quota.dailyIdrCap <= 0) {
    throw new Error(
      'URUSIN_DAILY_IDR_CAP wajib diisi (angka > 0) di mode LLM; tanpa batas berarti biaya tak terbatas',
    );
  }
  return quota;
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
  const piiKey = piiKeyFromEnv(env, true);
  return createRuntime({
    mode: 'llm',
    provider,
    harness: {
      model: cfg.models.agent,
      caps,
      prices,
      quota: quotaFromEnv(env),
      ...(piiKey ? { piiKey } : {}),
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
