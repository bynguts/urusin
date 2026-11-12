import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  AkunService,
  GoogleOidc,
  Vault,
  akunConfigFromEnv,
  kunciPlaceholderHmac,
  mailerFromEnv,
  type AkunDeps,
  type Mailer,
  type VaultOptions,
} from '@urusin/akun';
import {
  CacheJawaban,
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
import { createRagSearcher, openDb, type RagSearchInfo } from '@urusin/rag';
import type { EventPayload, UrusinEvent } from '@urusin/contracts';
import { embeddingDariEnv, intentEmbedding, type Embedding } from './embedding.js';
import { httpKeluar } from './http-keluar.js';
import { aturStatusProbe, pantauProbe } from './probe-ulang.js';
import { penyimpanIngatan } from './ingatan.js';
import { buatOidcFixture, type OidcFixture } from './oidc-fixture.js';
import { peringatanKuotaJuri, peringatanTurnstile, turnstileFromEnv, type Turnstile } from './turnstile.js';
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
  /**
   * Batas laju: urusan baru per jam dan turn per menit. Urusan baru warga ber-akun (juga salinan demo) dihitung
   * per akun; tamu per sesi, dengan batas per IP longgar sebagai rem banjir saja (CGNAT seluler, warnet, dan
   * kantor kelurahan berbagi satu IP). Akun juga kena plafon per IP yang jauh lebih longgar (`buatPerJamIpAkun`),
   * dihitung BERSAMA batas akun: akun massal dari satu IP tetap punya plafon biaya LLM.
   */
  buatPerJamIp: number;
  buatPerJamSesi: number;
  buatPerJamAkun: number;
  buatPerJamIpAkun: number;
  /** Rem Browser Pendamping portal asli: sesi mulai per jam per akun dan per IP (Mode Uji/juri tidak kena). */
  pendampingPerJamAkun: number;
  pendampingPerJamIp: number;
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
    buatPerJamIp: num(env.URUSIN_LIMIT_BUAT_IP_PER_JAM, 120),
    buatPerJamSesi: num(env.URUSIN_LIMIT_BUAT_SESI_PER_JAM, 10),
    buatPerJamAkun: num(env.URUSIN_LIMIT_BUAT_AKUN_PER_JAM, 30),
    buatPerJamIpAkun: num(env.URUSIN_LIMIT_BUAT_IP_AKUN_PER_JAM, 600),
    pendampingPerJamAkun: num(env.URUSIN_LIMIT_PENDAMPING_AKUN_PER_JAM, 6),
    pendampingPerJamIp: num(env.URUSIN_LIMIT_PENDAMPING_IP_PER_JAM, 30),
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
  | {
      status: 'ready';
      chunks: number;
      vectors: number;
      vectorModel: string | null;
      /** Leg pencarian agen yang aktif (vektor hybrid, rerank endpoint). */
      pencarian?: RagSearchInfo;
    };

/** Hitung isi korpus yang sudah dibuka; `ready` hanya untuk berkas URUSIN_RAG_DB, `demo` untuk korpus contoh. */
export function ragInfo(ragDb: Db, fromFile: boolean, pencarian?: RagSearchInfo): RagInfo {
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
    ...(pencarian ? { pencarian } : {}),
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
  /**
   * Pembatas laju per aksi; kunci IP dan sesi dihitung terpisah. `akun` (bila ada) menggantikan IP + sesi tamu
   * untuk warga yang masuk (akun atau demo), selalu bersama plafon `ipAkun` per IP.
   */
  limits: Record<
    'buat' | 'turn',
    { ip: RateLimiter; sesi: RateLimiter; akun?: RateLimiter; ipAkun?: RateLimiter }
  > & { pendamping: { akun: RateLimiter; ip: RateLimiter } };
  /** Sesi Browser Pendamping portal asli terakhir per akun (satu sesi aktif per akun). */
  sesiAsliAkun: Map<string, { urusanId: string; sidHash: string; executionId: string }>;
  /** Akun warga, sesi login, dan vault terenkripsi per pemilik (ADR 0028). */
  akun: AkunService;
  /** Turnstile untuk "Masuk sebagai juri" dan login setelah 3 kegagalan. */
  turnstile: Turnstile;
  /** IdP OIDC tiruan (hanya e2e, URUSIN_OIDC_FIXTURE=1). */
  oidcFixture?: OidcFixture | undefined;
  /** Sidecar embedding self-hosted (null = mati): jalur cepat intent dan peringkat tautan Navigator. */
  embedding?: Embedding | null | undefined;
};

/** Komponen akun yang bisa diganti tes (mailer palsu, Google palsu, folder vault sementara). */
export type AkunInit = {
  mailer?: Mailer;
  /** null = Google dimatikan walau env terisi. */
  google?: GoogleOidc | null;
  vaultDir?: string;
  kek?: Buffer;
  ttl?: AkunDeps['ttl'];
  limits?: AkunDeps['limits'];
  kuota?: AkunDeps['kuota'];
  vault?: Omit<VaultOptions, 'now'>;
  now?: () => Date;
  turnstile?: Turnstile;
};

type RuntimeInit = {
  config?: Partial<RuntimeConfig>;
  provider?: ChatProvider;
  harness?: Partial<HarnessOptions>;
  mode?: Runtime['mode'];
  akun?: AkunInit;
  /** Env penyedia embedding/rerank dan gerbang abstain untuk pencari RAG (default process.env). */
  env?: Record<string, string | undefined>;
};

/** Folder berkas vault: URUSIN_VAULT_DIR, atau `vault/` di samping DB; DB memori → folder sementara. */
function vaultDirFor(dbPath: string, env: Record<string, string | undefined>): string {
  const dir = env.URUSIN_VAULT_DIR?.trim();
  if (dir) return dir;
  if (dbPath === ':memory:') return mkdtempSync(join(tmpdir(), 'urusin-vault-'));
  return join(dirname(dbPath), 'vault');
}

/**
 * Redirect URI Google dari DOMAIN runtime (`https://${DOMAIN}/auth/google/callback`), sehingga set host
 * mana pun di deploy/hosts.json (primary, fallback) memakai callback-nya sendiri; tanpa DOMAIN (dev) dari
 * origin publik. Setiap URI harus didaftarkan di Google Cloud.
 */
export function googleRedirectUri(env: Record<string, string | undefined>, publicOrigin: string): string {
  const domain = env.DOMAIN?.trim();
  return new URL('/auth/google/callback', domain ? `https://${domain}` : publicOrigin).href;
}

const alertOperator = (pesan: string) => console.error(`[ALERT] ${pesan}`);

function createAkun(
  db: Db,
  config: RuntimeConfig,
  hapusUrusan: (id: string) => void,
  init: AkunInit = {},
  env: Record<string, string | undefined> = process.env,
): { akun: AkunService; oidcFixture?: OidcFixture | undefined } {
  const cfg = akunConfigFromEnv(env);
  const log = (line: string) => console.warn(line);
  const redirectUri = googleRedirectUri(env, config.publicOrigin);
  let oidcFixture: OidcFixture | undefined;
  let google: GoogleOidc | undefined;
  if (init.google === null) google = undefined;
  else if (init.google) google = init.google;
  else if (cfg.oidcFixture) {
    const f = buatOidcFixture(config.publicOrigin, redirectUri);
    oidcFixture = f.fixture;
    google = f.oidc;
  } else if (cfg.google) google = new GoogleOidc({ ...cfg.google, redirectUri, fetch: httpKeluar });
  const mailer = init.mailer ?? mailerFromEnv(env, httpKeluar, log);
  if (mailer.ditahan)
    alertOperator('email ditahan: URUSIN_EMAIL_MODE=log di produksi (Resend belum dikonfigurasi)');
  const akun = new AkunService({
    db,
    mailer,
    vault: new Vault(db, init.kek ?? cfg.kek, init.vaultDir ?? vaultDirFor(config.dbPath, env), {
      kekLama: cfg.kekLama,
      batas: cfg.batasVault,
      alert: alertOperator,
      ...init.vault,
      ...(init.now ? { now: init.now } : {}),
    }),
    publicOrigin: config.publicOrigin,
    limiter: (r) => new RateLimiter(r.limit, r.windowMs),
    google,
    ttl: { ...cfg.ttl, ...init.ttl },
    kuota: { ...cfg.kuota, ...init.kuota },
    ...(init.limits ? { limits: init.limits } : {}),
    ...(init.now ? { now: init.now } : {}),
    hapusUrusan,
    log,
    alert: alertOperator,
  });
  return { akun, oidcFixture };
}

/** Rakit runtime dari komponen yang diberikan (dipakai tes dan `getRuntime`). */
export function createRuntime(init: RuntimeInit = {}): Runtime {
  const config = { ...readConfig(), ...init.config };
  if (config.dbPath !== ':memory:') mkdirSync(dirname(config.dbPath), { recursive: true });
  const db = openHarnessDb(config.dbPath);
  const ragDb: Db = config.ragDbPath ? openDb(config.ragDbPath, { readonly: true }) : createDemoRagDb();
  // Korpus nyata: jalur produksi hybrid (BM25 + vektor Jina) + rerank endpoint, jatuh ke BM25 bila penyedia
  // gagal. Korpus demo tetap BM25 sinkron (tanpa vektor, tanpa jaringan).
  const searcher = config.ragDbPath ? createRagSearcher(ragDb, init.env ?? process.env) : undefined;
  // Ingatan warga (ADR 0031) disimpan di vault akun; AkunService dirakit sesudah harness (butuh store).
  const akunRef: { akun?: AkunService } = {};
  const embedding = embeddingDariEnv(init.env ?? process.env);
  const klasifikasiEmbedding = intentEmbedding(embedding);
  const h = createHarness({
    provider: init.provider ?? new DemoProvider(),
    db,
    ragDb,
    ragSearch: searcher?.search,
    ...(klasifikasiEmbedding ? { intentEmbedding: klasifikasiEmbedding } : {}),
    ingatan: penyimpanIngatan(() => {
      if (!akunRef.akun) throw new Error('akun belum siap');
      return akunRef.akun;
    }),
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
      akun: new RateLimiter(config.buatPerJamAkun, jam),
      ipAkun: new RateLimiter(config.buatPerJamIpAkun, jam),
    },
    turn: {
      ip: new RateLimiter(config.turnPerMenitIp, menit),
      sesi: new RateLimiter(config.turnPerMenitSesi, menit),
    },
    pendamping: {
      akun: new RateLimiter(config.pendampingPerJamAkun, jam),
      ip: new RateLimiter(config.pendampingPerJamIp, jam),
    },
  };
  const { akun, oidcFixture } = createAkun(db, config, (id) => h.store.deleteUrusan(id), init.akun);
  akunRef.akun = akun;
  const turnstile = init.akun?.turnstile ?? turnstileFromEnv();
  for (const peringatan of [
    peringatanTurnstile(turnstile, init.env ?? process.env),
    peringatanKuotaJuri(turnstile, akun.kuota, init.env ?? process.env),
  ])
    if (peringatan) alertOperator(peringatan);
  const rag = ragInfo(ragDb, Boolean(config.ragDbPath), searcher?.info);
  return {
    ...h,
    config,
    rag,
    mode: init.mode ?? 'demo',
    running,
    publish,
    limits,
    sesiAsliAkun: new Map(),
    akun,
    turnstile,
    oidcFixture,
    embedding,
  };
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
    sessionTokenCap: num(env.URUSIN_SESSION_TOKEN_CAP, 400_000),
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

/**
 * Mode LLM hanya bila LLM_BASE_URL, LLM_API_KEY, dan LLM_AGENT_MODEL terisi DAN saklar darurat
 * `URUSIN_LLM_DISABLED=1` tidak aktif (mis. internet venue putus saat demo: DemoProvider, tanpa jaringan).
 */
export function llmAktif(env: Record<string, string | undefined>): boolean {
  if (env.URUSIN_LLM_DISABLED?.trim() === '1') return false;
  return Boolean(env.LLM_BASE_URL && env.LLM_API_KEY && env.LLM_AGENT_MODEL);
}

async function buildFromEnv(): Promise<Runtime> {
  const env = process.env;
  if (!llmAktif(env)) return createRuntime({ mode: 'demo' });

  const cfg = loadLlmConfig(env);
  const provider = new OpenAIProvider(cfg);
  // LLM_CAPS_PIN (rencana §3.11) menang atas probe. Tanpa pin: probe saat boot; probe yang GALAT (proxy sibuk,
  // timeout) tidak membuat degraded selamanya: diulang di latar dengan backoff (probe-ulang.ts) sampai pulih.
  const pin = pinnedCaps(env.LLM_CAPS_PIN);
  const probe = async () =>
    applyForcedOff(await probeCapabilities({ provider, models: cfg.models }), cfg.forcedOff);
  let laporan: Awaited<ReturnType<typeof probe>> | null = null;
  if (!pin) laporan = await probe().catch(() => null);
  const caps = pin ?? (laporan ? { ...laporan.flags } : { ...ALL_OFF });
  const prices: Prices = cfg.prices;
  const piiKey = piiKeyFromEnv(env, true);
  const rt = createRuntime({
    mode: 'llm',
    provider,
    harness: {
      model: cfg.models.agent,
      caps,
      prices,
      quota: quotaFromEnv(env),
      // Masukan jawaban bersumber yang sama persis (pesan + potongan) tidak menunggu model lagi; verifikasi
      // kutipan tetap dijalankan ulang tiap kali.
      cacheJawaban: new CacheJawaban(),
      // Kunci HMAC placeholder = HKDF(URUSIN_PII_KEY, 'urusin/placeholder-hmac/v1'), terpisah dari KEK vault.
      ...(piiKey ? { piiKey: kunciPlaceholderHmac(piiKey) } : {}),
    },
  });
  if (pin) aturStatusProbe({ status: 'pin' });
  else pantauProbe({ caps: rt.deps.caps, laporan, probe, catat: (p) => console.warn(`llm: ${p}`) });
  return rt;
}

let instance: Promise<Runtime> | undefined;

/** Singleton proses (server tunggal). Membersihkan sesi/token akun kedaluwarsa saat boot lalu tiap jam. */
export function getRuntime(): Promise<Runtime> {
  instance ??= buildFromEnv().then((rt) => {
    rt.akun.bersihkan();
    setInterval(() => rt.akun.bersihkan(), 3_600_000).unref();
    return rt;
  });
  return instance;
}

/**
 * Runtime bila siap dalam `ms`; `memuat` bila masih dirakit (mis. probe LLM lambat, perakitan berlanjut di latar
 * belakang), `error` bila gagal dirakit. Dipakai endpoint status agar tidak pernah menggantung.
 */
export async function runtimeWithin(ms: number): Promise<Runtime | 'memuat' | 'error'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wait = new Promise<'memuat'>((resolve) => {
    timer = setTimeout(() => resolve('memuat'), ms);
  });
  try {
    return await Promise.race([getRuntime(), wait]);
  } catch {
    return 'error';
  } finally {
    clearTimeout(timer);
  }
}

/** Hanya untuk tes: ganti/hapus singleton (Promise = runtime yang masih dirakit atau gagal dirakit). */
export function setRuntimeForTests(rt: Runtime | Promise<Runtime> | undefined): void {
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
