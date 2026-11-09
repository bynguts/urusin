import { createHash, timingSafeEqual } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import net, { BlockList, isIP } from 'node:net';
import type { networkInterfaces } from 'node:os';
import type { Duplex } from 'node:stream';
import { browserUnion, checkConnect, checkConnectHost, EgressBlockedError } from '@urusin/egress';
import { dialUpstream, type Resolver } from './egress.js';
import { bacaIsiBertanda, createPenjagaUlang, headerDari } from './tanda.js';

/**
 * pendamping-edge: kontainer kecil di DUA jaringan compose (internal `pendamping_internal` + bridge biasa).
 * Kontainer pendamping (Node + Chromium) hanya ada di jaringan internal (`internal: true`, gateway host
 * terisolasi), jadi tidak punya rute ke host maupun internet; satu-satunya jalan keluarnya edge ini.
 *
 * Tugas 1, proxy balik (bridge, dipublikasikan 127.0.0.1:4330): HANYA `/ws/<uuid>` (upgrade), `/internal/*`,
 * `/health`, dan `/debug*` bila PENDAMPING_DEBUG_TOKEN diisi, dicocokkan pada jalur MENTAH yang kanonik (lihat
 * `jalurMentah`; `/ws/..%2finternal` dan sejenisnya 404). Header Host/Origin/Cookie diteruskan apa adanya;
 * HMAC kanal internal tetap diperiksa pendamping.
 *
 * Tugas 2, proxy CONNECT (antarmuka internal): SATU-SATUNYA egress Chromium. Kredensial proxy acak per sesi
 * (didaftarkan pendamping lewat kanal kontrol bertanda HMAC). Edge me-resolve DNS sendiri, memeriksa SETIAP
 * alamat dengan `checkConnect` profil `browser` (https:443, host persis sesi DAN union registry global,
 * loopback/RFC1918/CGNAT/link-local/`::ffff:`/NAT64/dst. ditolak), lalu tersambung ke alamat yang sudah
 * diperiksa. Union global dan daftar blokir SELALU berlaku walau pendamping yang mendaftar sesi disusupi.
 */

export type EdgeConfig = {
  /** Rahasia HMAC pendamping -> edge (kanal kontrol). */
  token: string;
  /** Layanan pendamping di jaringan internal (mis. http://pendamping:4330). */
  hulu: URL;
  /** /debug ikut diteruskan (hanya bila PENDAMPING_DEBUG_TOKEN diisi). */
  debug: boolean;
  /** Batas global host CONNECT: registry resmi + pihak ketiga terdaftar + fixture https publik. */
  union: ReadonlySet<string>;
  /** Proxy hulu milik operator (opsional). */
  upstreamProxy: URL | undefined;
  portBalik: number;
  portProxy: number;
  portKontrol: number;
  maksSesi: number;
  maksTerowongan: number;
};

const TTL_MAKS_MS = 2 * 60 * 60_000;
const USER_RE = /^[a-z0-9]{16,64}$/;

export function loadEdgeConfig(env: Record<string, string | undefined> = process.env): EdgeConfig {
  const token = env.PENDAMPING_EDGE_TOKEN ?? '';
  if (token.length < 32) throw new Error('PENDAMPING_EDGE_TOKEN wajib (>= 32 karakter)');
  const hulu = new URL(env.EDGE_PENDAMPING_URL ?? 'http://pendamping:4330');
  if (hulu.protocol !== 'http:' || hulu.pathname !== '/' || !hulu.port)
    throw new Error('EDGE_PENDAMPING_URL harus http://host:port');
  // Fixture publik (Mode Uji) hanya lewat https:443, sama seperti situs resmi.
  const fixture: string[] = [];
  for (const o of (env.PENDAMPING_FIXTURE_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const u = new URL(o);
    if (u.protocol !== 'https:' || (u.port && u.port !== '443') || isIP(u.hostname))
      throw new Error(`origin fixture edge harus https://host (tanpa port/IP): ${o}`);
    fixture.push(u.hostname);
  }
  let upstreamProxy: URL | undefined;
  if (env.PENDAMPING_UPSTREAM_PROXY?.trim()) {
    upstreamProxy = new URL(env.PENDAMPING_UPSTREAM_PROXY.trim());
    if (upstreamProxy.protocol !== 'http:' || upstreamProxy.pathname !== '/')
      throw new Error('PENDAMPING_UPSTREAM_PROXY harus http://[user:pass@]host:port');
  }
  const debugToken = env.PENDAMPING_DEBUG_TOKEN?.trim() ?? '';
  return {
    token,
    hulu,
    debug: debugToken.length >= 32,
    union: browserUnion(fixture),
    upstreamProxy,
    portBalik: Number(env.EDGE_PORT_BALIK ?? 4330),
    portProxy: Number(env.EDGE_PORT_PROXY ?? 3128),
    portKontrol: Number(env.EDGE_PORT_KONTROL ?? 3129),
    maksSesi: 64,
    maksTerowongan: 256,
  };
}

/**
 * Pilih alamat ikat: `internal` = antarmuka yang subnetnya memuat alamat pendamping, `publik` = satu-satunya
 * IPv4 non-loopback lainnya. Tidak pernah wildcard.
 */
export function pilihAntarmuka(
  alamatHulu: string,
  ifaces: ReturnType<typeof networkInterfaces>,
): { internal: string; publik: string } {
  const v4 = Object.values(ifaces)
    .flat()
    .filter((a) => a !== undefined && a.family === 'IPv4' && !a.internal && a.cidr)
    .map((a) => a!);
  const memuat = (cidr: string) => {
    const [net4, bits] = cidr.split('/');
    const bl = new BlockList();
    bl.addSubnet(net4!, Number(bits), 'ipv4');
    return bl.check(alamatHulu, 'ipv4');
  };
  const internal = v4.filter((a) => memuat(a.cidr!));
  const publik = v4.filter((a) => !memuat(a.cidr!));
  if (internal.length !== 1 || publik.length !== 1)
    throw new Error(
      `edge butuh tepat satu antarmuka internal dan satu publik (internal ${internal.length}, publik ${publik.length})`,
    );
  return { internal: internal[0]!.address, publik: publik[0]!.address };
}

type Entri = { sandi: Buffer; sesi: Set<string>; exp: number };

const sha = (s: string) => createHash('sha256').update(s).digest();

/** Daftar kredensial proxy per sesi (di memori edge saja). */
export function createDaftarSesi(maks: number, now: () => number = Date.now) {
  const m = new Map<string, Entri>();
  const bersihkan = () => {
    const t = now();
    for (const [k, e] of m) if (e.exp <= t) m.delete(k);
  };
  return {
    pasang(user: string, sandi: string, hosts: readonly string[], ttlMs: number, union: ReadonlySet<string>) {
      bersihkan();
      if (!m.has(user) && m.size >= maks) return false;
      const sesi = new Set(hosts.map((h) => h.toLowerCase()).filter((h) => union.has(h)));
      m.set(user, { sandi: sha(sandi), sesi, exp: now() + Math.min(ttlMs, TTL_MAKS_MS) });
      return true;
    },
    hapus(user: string) {
      m.delete(user);
    },
    /** Kredensial Basic -> set host sesi; undefined bila tidak sah/kedaluwarsa. */
    periksa(header: string | undefined): Set<string> | undefined {
      const b64 = /^Basic ([A-Za-z0-9+/=]+)$/.exec(header ?? '')?.[1];
      if (!b64) return undefined;
      const [user, sandi] = Buffer.from(b64, 'base64').toString('utf8').split(':');
      if (!user || !sandi) return undefined;
      const e = m.get(user);
      if (!e || e.exp <= now()) return undefined;
      return timingSafeEqual(e.sandi, sha(sandi)) ? e.sesi : undefined;
    },
    get ukuran() {
      bersihkan();
      return m.size;
    },
  };
}

const defaultResolver: Resolver = async (host) =>
  (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address);

function parseAuthority(authority: string): { host: string; port: number } | null {
  const m = /^(\[[0-9a-fA-F:.]+\]|[^:[\]/]+):(\d{1,5})$/.exec(authority);
  if (!m?.[1] || !m[2]) return null;
  const port = Number(m[2]);
  return port > 0 && port < 65536
    ? {
        host: m[1]
          .replace(/^\[|\]$/g, '')
          .replace(/\.$/, '')
          .toLowerCase(),
        port,
      }
    : null;
}

const tolak = (s: Duplex, status: string, extra = '') =>
  s.end(`HTTP/1.1 ${status}\r\n${extra}Content-Length: 0\r\nConnection: close\r\n\r\n`);

/** Proxy CONNECT edge. `decide` diekspor lewat objek hasil untuk diuji tanpa jaringan. */
export function createEdgeProxy(
  cfg: Pick<EdgeConfig, 'union' | 'upstreamProxy' | 'maksTerowongan'>,
  daftar: ReturnType<typeof createDaftarSesi>,
  resolve: Resolver = defaultResolver,
) {
  const sockets = new Set<Duplex>();
  const track = (s: Duplex) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
    s.on('error', () => s.destroy());
  };

  /** Keputusan untuk satu CONNECT: alamat yang sudah diperiksa, atau alasan tolak. */
  async function decide(
    sesi: ReadonlySet<string>,
    host: string,
    port: number,
  ): Promise<{ ok: true; address: string } | { ok: false; reason: string }> {
    let addresses: string[];
    try {
      // Port, IP literal, union, set sesi diperiksa SEBELUM DNS: host di luar izin tidak pernah di-resolve.
      checkConnectHost(host, port, 'browser', { sesi, union: cfg.union });
      addresses = await resolve(host);
    } catch (e) {
      return { ok: false, reason: e instanceof EgressBlockedError ? e.message : 'dns_gagal' };
    }
    if (addresses.length === 0) return { ok: false, reason: 'dns_kosong' };
    try {
      for (const ip of addresses) checkConnect(host, port, ip, 'browser', { sesi, union: cfg.union });
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : 'diblokir' };
    }
    return { ok: true, address: addresses[0]! };
  }

  const server = http.createServer((_req, res) => {
    // Hanya CONNECT (https). Permintaan HTTP biasa (absolute-form) tidak pernah diteruskan.
    res.writeHead(403, { connection: 'close' }).end();
  });
  server.on('connection', track);
  server.on('connect', async (req, client: Duplex, head: Buffer) => {
    track(client);
    const sesi = daftar.periksa(req.headers['proxy-authorization']);
    if (!sesi)
      return tolak(
        client,
        '407 Proxy Authentication Required',
        'Proxy-Authenticate: Basic realm="urusin"\r\n',
      );
    if (sockets.size > cfg.maksTerowongan * 2) return tolak(client, '503 Service Unavailable');
    const target = parseAuthority(req.url ?? '');
    const d = target
      ? await decide(sesi, target.host, target.port)
      : ({ ok: false, reason: 'rusak' } as const);
    if (!target || !d.ok) return tolak(client, '403 Forbidden');
    const sambung = (up: net.Socket) => {
      track(up);
      up.setTimeout(10 * 60_000, () => up.destroy());
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) up.write(head);
      up.pipe(client);
      client.pipe(up);
    };
    const gagal = () => tolak(client, '502 Bad Gateway');
    if (cfg.upstreamProxy) {
      dialUpstream(cfg.upstreamProxy, target.host, target.port).then(sambung, gagal);
      return;
    }
    const up = net.connect(target.port, d.address, () => sambung(up));
    up.on('error', gagal);
  });
  return {
    server,
    decide,
    tutup() {
      for (const s of sockets) s.destroy();
    },
  };
}

const JALUR_WS = /^\/ws\/[0-9a-f-]{36}$/;

/**
 * Jalur MENTAH (tanpa query) bila sudah kanonik, selain itu undefined. Perutean edge memakai jalur mentah,
 * tidak pernah hasil normalisasi `new URL()` (yang mengubah `/ws/../internal` dan `/ws/%2e%2e/internal`
 * menjadi `/internal`). Hanya `[A-Za-z0-9._~-]` per segmen: penyandian persen, `\`, `;` (`..;`), `//`, dan
 * segmen yang diawali titik (`.`, `..`) ditolak.
 */
export function jalurMentah(url: string): string | undefined {
  const q = url.indexOf('?');
  const path = q === -1 ? url : url.slice(0, q);
  if (!/^(\/[A-Za-z0-9_~-][A-Za-z0-9._~-]*)+\/?$|^\/$/.test(path)) return undefined;
  return path;
}

/** Jalur yang boleh diteruskan proxy balik. */
export function jalurDiizinkan(path: string, debug: boolean): boolean {
  if (path === '/health' || path.startsWith('/internal/')) return true;
  return debug && (path === '/debug' || path.startsWith('/debug/'));
}

/** Proxy balik 127.0.0.1:4330 -> pendamping (jaringan internal). */
export function createEdgeBalik(cfg: Pick<EdgeConfig, 'hulu' | 'debug'>) {
  const huluPort = Number(cfg.hulu.port);
  const huluHost = cfg.hulu.hostname;
  const server = http.createServer((req, res) => {
    const path = jalurMentah(req.url ?? '');
    if (path === undefined || !jalurDiizinkan(path, cfg.debug)) {
      res.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end('{"kode":"SESI_TIDAK_ADA","pesanWarga":"Tidak ditemukan."}');
      return;
    }
    const up = http.request(
      {
        host: huluHost,
        port: huluPort,
        method: req.method,
        path: req.url,
        headers: req.headers,
        setHost: false,
      },
      (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      },
    );
    up.setTimeout(30_000, () => up.destroy());
    up.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
      res.end('{"kode":"LAYANAN_TIDAK_TERSEDIA","pesanWarga":"Layanan pendamping tidak tersedia."}');
    });
    req.pipe(up);
  });
  server.on('upgrade', (req, socket: Duplex, head: Buffer) => {
    socket.on('error', () => socket.destroy());
    if (!JALUR_WS.test(req.url ?? '')) return tolak(socket, '404 Not Found');
    const up = net.connect(huluPort, huluHost, () => {
      const baris = [`${req.method} ${req.url} HTTP/1.1`];
      for (let i = 0; i + 1 < req.rawHeaders.length; i += 2)
        baris.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      up.write(`${baris.join('\r\n')}\r\n\r\n`);
      if (head.length > 0) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    up.on('error', () => tolak(socket, '502 Bad Gateway'));
    socket.on('close', () => up.destroy());
    up.on('close', () => socket.destroy());
  });
  return server;
}

/** Kanal kontrol (antarmuka internal): PUT/DELETE /sesi/<user> bertanda HMAC, GET /health. */
export function createEdgeKontrol(
  cfg: Pick<EdgeConfig, 'token' | 'union' | 'maksSesi'>,
  daftar: ReturnType<typeof createDaftarSesi>,
) {
  const periksa = createPenjagaUlang(cfg.token);
  return http.createServer(async (req, res) => {
    const kirim = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    if (req.method === 'GET' && path === '/health') return kirim(200, { ok: true, sesi: daftar.ukuran });
    const user = /^\/sesi\/([^/]+)$/.exec(path)?.[1];
    if (!user || !USER_RE.test(user) || (req.method !== 'PUT' && req.method !== 'DELETE'))
      return kirim(404, { ok: false });
    // Tanda tangan header (termasuk panjang + hash isi yang dideklarasikan) diperiksa sebelum isi dibaca.
    const h = headerDari(req);
    if (!periksa(h, req.method, path)) {
      res.setHeader('connection', 'close');
      return kirim(401, { ok: false });
    }
    if (Number(h.panjang) > 16 * 1024) {
      res.setHeader('connection', 'close');
      return kirim(413, { ok: false });
    }
    const raw = await bacaIsiBertanda(req, h, 16 * 1024);
    if (raw === null) return kirim(413, { ok: false });
    if (raw === false) return kirim(401, { ok: false });
    if (req.method === 'DELETE') {
      daftar.hapus(user);
      return kirim(200, { ok: true });
    }
    let body: { sandi?: unknown; hosts?: unknown; ttlMs?: unknown };
    try {
      body = JSON.parse(raw.toString('utf8')) as typeof body;
    } catch {
      return kirim(422, { ok: false });
    }
    const { sandi, hosts, ttlMs } = body;
    if (
      typeof sandi !== 'string' ||
      !/^[0-9a-f]{32,128}$/.test(sandi) ||
      !Array.isArray(hosts) ||
      hosts.length > 32 ||
      !hosts.every((x) => typeof x === 'string' && x.length <= 253) ||
      typeof ttlMs !== 'number' ||
      !(ttlMs > 0)
    )
      return kirim(422, { ok: false });
    if (!daftar.pasang(user, sandi, hosts as string[], ttlMs, cfg.union)) return kirim(503, { ok: false });
    return kirim(201, { ok: true });
  });
}
