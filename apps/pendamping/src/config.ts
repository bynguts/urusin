/**
 * Konfigurasi layanan pendamping dari env (dibaca sekali saat boot). Default aman untuk host bersama
 * (agent-vm): 2 sesi aktif, TTL 15 menit, idle 3 menit.
 */
export type Config = {
  port: number;
  host: string;
  /** Token bersama web -> pendamping untuk API internal (Authorization: Bearer). Wajib di produksi. */
  internalToken: string;
  /** Origin halaman web app yang boleh membuka WebSocket (cek header Origin persis). */
  allowedOrigins: string[];
  /** URL WebSocket publik yang diberikan ke perangkat (mis. wss://urusinai.web.id/pendamping/ws). */
  publicWsUrl: string;
  maxSessions: number;
  maxQueue: number;
  ttlMs: number;
  idleMs: number;
  ticketTtlMs: number;
  /** Batas RSS pohon proses Chromium per sesi (MB); lewat = sesi dihancurkan. Linux saja. */
  sessionMemMb: number;
  /** Batas heap V8 per renderer (MB). */
  jsHeapMb: number;
  /** Origin fixture (persis, termasuk port) yang diizinkan selain domain resmi: dev/uji/demo. */
  fixtureOrigins: string[];
  /** Pemetaan origin resmi -> origin fixture (dev/uji/demo), mis. "https://telunjuksakti...=http://127.0.0.1:4320". */
  originOverrides: Map<string, string>;
  /** Halaman /dev (penampil tanpa gaya untuk e2e). Tidak pernah aktif bila NODE_ENV=production. */
  devPage: boolean;
  chromiumPath: string | undefined;
  headless: boolean;
};

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);
const list = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

function exactOrigin(raw: string): string {
  const u = new URL(raw);
  if (u.origin !== raw || !['http:', 'https:'].includes(u.protocol))
    throw new Error(`origin tidak valid (harus persis skema://host[:port]): ${raw}`);
  return u.origin;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const internalToken = env.PENDAMPING_INTERNAL_TOKEN ?? '';
  if (production && internalToken.length < 32)
    throw new Error('PENDAMPING_INTERNAL_TOKEN wajib (>= 32 karakter) di produksi');
  const allowedOrigins = list(env.PENDAMPING_ALLOWED_ORIGINS ?? env.URUSIN_PUBLIC_ORIGIN).map(exactOrigin);
  if (production && allowedOrigins.length === 0)
    throw new Error('PENDAMPING_ALLOWED_ORIGINS wajib di produksi');
  const port = num(env.PORT, 4000);
  const originOverrides = new Map<string, string>();
  for (const pair of list(env.PENDAMPING_ORIGIN_OVERRIDES)) {
    const [from, to] = pair.split('=');
    if (!from || !to) throw new Error(`PENDAMPING_ORIGIN_OVERRIDES rusak: ${pair}`);
    originOverrides.set(exactOrigin(from), exactOrigin(to));
  }
  const fixtureOrigins = list(env.PENDAMPING_FIXTURE_ORIGINS).map(exactOrigin);
  for (const to of originOverrides.values())
    if (!fixtureOrigins.includes(to))
      throw new Error(`override ${to} harus terdaftar di PENDAMPING_FIXTURE_ORIGINS`);
  return {
    port,
    host: env.HOST ?? '0.0.0.0',
    internalToken: internalToken || 'dev-token-bukan-rahasia-hanya-untuk-lokal',
    allowedOrigins,
    publicWsUrl: env.PENDAMPING_PUBLIC_WS_URL ?? `ws://127.0.0.1:${port}/ws`,
    maxSessions: Math.max(1, num(env.PENDAMPING_MAX_SESSIONS, 2)),
    maxQueue: Math.max(0, num(env.PENDAMPING_MAX_QUEUE, 20)),
    ttlMs: num(env.PENDAMPING_TTL_MS, 15 * 60_000),
    idleMs: num(env.PENDAMPING_IDLE_MS, 3 * 60_000),
    ticketTtlMs: num(env.PENDAMPING_TICKET_TTL_MS, 30_000),
    sessionMemMb: num(env.PENDAMPING_SESSION_MEM_MB, 700),
    jsHeapMb: num(env.PENDAMPING_JS_HEAP_MB, 256),
    fixtureOrigins,
    originOverrides,
    devPage: !production && env.PENDAMPING_DEV_PAGE === '1',
    chromiumPath: env.PENDAMPING_CHROMIUM_PATH || undefined,
    headless: env.PENDAMPING_HEADFUL !== '1',
  };
}
