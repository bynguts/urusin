/**
 * Konfigurasi layanan pendamping: SATU-SATUNYA tempat default (dibaca sekali saat boot dari env).
 * Default aman untuk host bersama (agent-vm). Tabel lengkap juga ada di docs/adr/0028-browser-pendamping.md.
 *
 * | Env                              | Default      | Arti                                                        |
 * | -------------------------------- | ------------ | ----------------------------------------------------------- |
 * | HOST                             | 127.0.0.1    | Alamat ikat; wildcard (0.0.0.0, ::) DITOLAK                 |
 * | PORT                             | 4330         | Port HTTP + WebSocket                                       |
 * | PENDAMPING_INTERNAL_TOKEN        | (dev saja)   | Bearer web -> pendamping; wajib >= 32 karakter di produksi  |
 * | PENDAMPING_ALLOWED_ORIGINS       | URUSIN_PUBLIC_ORIGIN | Origin persis yang boleh membuka WebSocket          |
 * | PENDAMPING_PUBLIC_WS_URL         | ws://HOST:PORT/ws | URL WS yang diberikan ke perangkat                     |
 * | PENDAMPING_MAX_SESSIONS          | 2            | Sesi Chromium aktif bersamaan (sisanya antre FIFO)          |
 * | PENDAMPING_MAX_QUEUE             | 20           | Panjang antrean maksimum                                    |
 * | PENDAMPING_TTL_MS                | 900000       | Umur sesi maksimum (15 menit)                               |
 * | PENDAMPING_IDLE_MS               | 180000       | Tanpa aktivitas warga/AI (3 menit) -> sesi dihancurkan      |
 * | PENDAMPING_TICKET_TTL_MS         | 30000        | Umur tiket WS sekali pakai                                  |
 * | PENDAMPING_HALO_TIMEOUT_MS       | 5000         | Batas waktu pesan pertama `halo`                            |
 * | PENDAMPING_MSG_PER_DETIK         | 200          | Batas pesan klien per detik per koneksi                     |
 * | PENDAMPING_FPS                   | 8            | Batas frame layar per detik ke perangkat                    |
 * | PENDAMPING_FRAME_INFLIGHT        | 2            | Frame belum di-ack maksimum                                 |
 * | PENDAMPING_WS_BUFFER_BYTES       | 131072       | Frame dilewati bila buffer kirim WS melebihi ini            |
 * | PENDAMPING_SESSION_MEM_MB        | 450          | Pengawas RSS per sesi (di bawah anggaran 512 MB/sesi)       |
 * | PENDAMPING_MEM_CHECK_MS          | 10000        | Interval pengawas memori                                    |
 * | PENDAMPING_JS_HEAP_MB            | 256          | Batas heap V8 per renderer                                  |
 * | PENDAMPING_HEADLESS              | (mati)       | 1 = headless; HANYA non-produksi dengan origin fixture      |
 * | PENDAMPING_FIXTURE_ORIGINS       | (kosong)     | Origin fixture yang diizinkan egress (dev/uji/Mode Uji)     |
 * | PENDAMPING_ORIGIN_OVERRIDES      | (kosong)     | `resmi=fixture[/awalan]`, fixture wajib di FIXTURE_ORIGINS  |
 * | PENDAMPING_UPSTREAM_PROXY        | (tidak ada)  | Proxy HTTP hulu milik operator (mis. egress Indonesia)      |
 * | PENDAMPING_DEBUG_TOKEN           | (mati)       | >= 32 karakter: aktifkan /debug (kemudi manual via stream)  |
 * | PENDAMPING_DEV_PAGE              | (mati)       | 1 = halaman /dev untuk e2e; tidak pernah di produksi        |
 * | PENDAMPING_CHROMIUM_PATH         | (Playwright) | Lokasi Chromium alternatif                                  |
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
  haloTimeoutMs: number;
  msgPerDetik: number;
  fps: number;
  frameInflight: number;
  wsBufferBytes: number;
  /** Batas RSS pohon proses Chromium per sesi (MB); lewat = sesi dihancurkan. */
  sessionMemMb: number;
  memCheckMs: number;
  /** Batas heap V8 per renderer (MB). */
  jsHeapMb: number;
  /** Origin fixture (persis, termasuk port) yang diizinkan selain domain resmi: dev/uji/demo. */
  fixtureOrigins: string[];
  /** Pemetaan origin resmi -> origin fixture (dev/uji/demo), mis. "https://telunjuksakti...=http://127.0.0.1:4320". */
  originOverrides: Map<string, string>;
  /** Proxy HTTP hulu (CONNECT) yang dipakai proxy egress setelah lolos kebijakan; undefined = langsung. */
  upstreamProxy: URL | undefined;
  /** Token halaman /debug (kemudi manual oleh penguji manusia); undefined = mati. */
  debugToken: string | undefined;
  /** Halaman /dev (penampil tanpa gaya untuk e2e). Tidak pernah aktif bila NODE_ENV=production. */
  devPage: boolean;
  chromiumPath: string | undefined;
  /**
   * Headed (bawaan, di server lewat Xvfb): situs dengan Cloudflare menantang Chromium headless.
   * Headless hanya untuk CI terhadap fixture; sesi ke origin non-fixture ditolak saat headless.
   */
  headless: boolean;
};

export const DEFAULTS = Object.freeze({
  host: '127.0.0.1',
  port: 4330,
  maxSessions: 2,
  maxQueue: 20,
  ttlMs: 15 * 60_000,
  idleMs: 3 * 60_000,
  ticketTtlMs: 30_000,
  haloTimeoutMs: 5_000,
  msgPerDetik: 200,
  fps: 8,
  frameInflight: 2,
  wsBufferBytes: 128 * 1024,
  sessionMemMb: 450,
  memCheckMs: 10_000,
  jsHeapMb: 256,
});

const WILDCARD = new Set(['', '0.0.0.0', '::', '[::]', '0:0:0:0:0:0:0:0']);

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

/** Target override: origin persis, boleh diikuti awalan jalur (`http://127.0.0.1:4320/smg`), tanpa query. */
function originBerawalan(raw: string): string {
  const u = new URL(raw);
  const awalan = u.pathname.replace(/\/+$/, '');
  if (`${u.origin}${awalan}` !== raw.replace(/\/+$/, '') || !['http:', 'https:'].includes(u.protocol))
    throw new Error(`target override tidak valid (skema://host[:port][/awalan]): ${raw}`);
  return `${u.origin}${awalan}`;
}

function upstream(raw: string | undefined): URL | undefined {
  if (!raw?.trim()) return undefined;
  const u = new URL(raw.trim());
  if (u.protocol !== 'http:' || u.pathname !== '/' || u.search || u.hash)
    throw new Error('PENDAMPING_UPSTREAM_PROXY harus http://[user:pass@]host:port');
  return u;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const internalToken = env.PENDAMPING_INTERNAL_TOKEN ?? '';
  if (production && internalToken.length < 32)
    throw new Error('PENDAMPING_INTERNAL_TOKEN wajib (>= 32 karakter) di produksi');
  const allowedOrigins = list(env.PENDAMPING_ALLOWED_ORIGINS ?? env.URUSIN_PUBLIC_ORIGIN).map(exactOrigin);
  if (production && allowedOrigins.length === 0)
    throw new Error('PENDAMPING_ALLOWED_ORIGINS wajib di produksi');
  const host = (env.HOST ?? DEFAULTS.host).trim();
  if (WILDCARD.has(host))
    throw new Error(`HOST=${host || '(kosong)'} ditolak: ikat ke alamat tertentu (bawaan 127.0.0.1)`);
  const port = num(env.PORT, DEFAULTS.port);
  const originOverrides = new Map<string, string>();
  for (const pair of list(env.PENDAMPING_ORIGIN_OVERRIDES)) {
    const [from, to] = pair.split('=');
    if (!from || !to) throw new Error(`PENDAMPING_ORIGIN_OVERRIDES rusak: ${pair}`);
    originOverrides.set(exactOrigin(from), originBerawalan(to));
  }
  const fixtureOrigins = list(env.PENDAMPING_FIXTURE_ORIGINS).map(exactOrigin);
  for (const to of originOverrides.values())
    if (!fixtureOrigins.includes(new URL(to).origin))
      throw new Error(`override ${to} harus terdaftar di PENDAMPING_FIXTURE_ORIGINS`);
  const headless = env.PENDAMPING_HEADLESS === '1';
  if (headless && (production || fixtureOrigins.length === 0))
    throw new Error('PENDAMPING_HEADLESS=1 hanya untuk CI/dev terhadap fixture (bukan produksi)');
  const debugToken = env.PENDAMPING_DEBUG_TOKEN?.trim() || undefined;
  if (debugToken && debugToken.length < 32) throw new Error('PENDAMPING_DEBUG_TOKEN harus >= 32 karakter');
  return {
    port,
    host,
    internalToken: internalToken || 'dev-token-bukan-rahasia-hanya-untuk-lokal',
    allowedOrigins,
    publicWsUrl: env.PENDAMPING_PUBLIC_WS_URL ?? `ws://${host}:${port}/ws`,
    maxSessions: Math.max(1, num(env.PENDAMPING_MAX_SESSIONS, DEFAULTS.maxSessions)),
    maxQueue: Math.max(0, num(env.PENDAMPING_MAX_QUEUE, DEFAULTS.maxQueue)),
    ttlMs: num(env.PENDAMPING_TTL_MS, DEFAULTS.ttlMs),
    idleMs: num(env.PENDAMPING_IDLE_MS, DEFAULTS.idleMs),
    ticketTtlMs: num(env.PENDAMPING_TICKET_TTL_MS, DEFAULTS.ticketTtlMs),
    haloTimeoutMs: num(env.PENDAMPING_HALO_TIMEOUT_MS, DEFAULTS.haloTimeoutMs),
    msgPerDetik: Math.max(10, num(env.PENDAMPING_MSG_PER_DETIK, DEFAULTS.msgPerDetik)),
    fps: Math.min(30, Math.max(1, num(env.PENDAMPING_FPS, DEFAULTS.fps))),
    frameInflight: Math.max(1, num(env.PENDAMPING_FRAME_INFLIGHT, DEFAULTS.frameInflight)),
    wsBufferBytes: Math.max(16 * 1024, num(env.PENDAMPING_WS_BUFFER_BYTES, DEFAULTS.wsBufferBytes)),
    sessionMemMb: num(env.PENDAMPING_SESSION_MEM_MB, DEFAULTS.sessionMemMb),
    memCheckMs: Math.max(200, num(env.PENDAMPING_MEM_CHECK_MS, DEFAULTS.memCheckMs)),
    jsHeapMb: num(env.PENDAMPING_JS_HEAP_MB, DEFAULTS.jsHeapMb),
    fixtureOrigins,
    originOverrides,
    upstreamProxy: upstream(env.PENDAMPING_UPSTREAM_PROXY),
    debugToken,
    devPage: !production && env.PENDAMPING_DEV_PAGE === '1',
    chromiumPath: env.PENDAMPING_CHROMIUM_PATH || undefined,
    headless,
  };
}
