import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import net, { isIP } from 'node:net';
import type { Duplex } from 'node:stream';
import { isBlockedAddress } from '@urusin/egress';

/**
 * Proxy egress pengizin (allowlisting forward proxy) per sesi. Chromium memakai `--proxy-server` ke sini
 * (termasuk loopback: `<-loopback>`), jadi SEMUA permintaan peramban lewat titik ini:
 *  1. host:port harus persis ada di allowlist (domain resmi + pihak ketiga terdaftar di :443, fixture persis);
 *  2. DNS di-resolve DI SINI, lalu setiap alamat diperiksa: privat, loopback, link-local (metadata
 *     169.254.169.254), CGNAT, multicast, dst. ditolak kecuali entri yang memang eksplisit lokal (fixture);
 *  3. koneksi dibuka ke ALAMAT yang sudah diperiksa, bukan nama host (aman dari DNS rebinding).
 * Tidak mencatat path, query, header, atau isi; hanya host yang ditolak.
 */

/**
 * Klasifikasi alamat (privat, loopback, link-local/metadata, CGNAT, `::ffff:`/NAT64/6to4, dst.) diambil dari
 * `@urusin/egress`: satu sumber kebenaran daftar blokir untuk semua jalur keluar server. Allowlist host
 * persis per sesi tetap di sini (lebih ketat dari kebijakan `*.go.id` milik egress server).
 */
export { isBlockedAddress };

export type EgressRule = {
  /** Host persis, huruf kecil (tanpa wildcard). */
  host: string;
  port: number;
  /** Hanya untuk fixture lokal yang didaftarkan eksplisit: boleh ke alamat privat/loopback. */
  allowPrivate?: boolean;
};

export type Resolver = (host: string) => Promise<string[]>;

const defaultResolver: Resolver = async (host) =>
  (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address);

/** `local`: tujuan fixture lokal terdaftar (tidak pernah lewat proxy hulu). */
export type EgressDecision = { ok: true; address: string; local: boolean } | { ok: false; reason: string };

export type EgressProxy = {
  port: number;
  /** Host yang ditolak sejak dibuat (untuk event `diblokir`, tanpa path). */
  onBlocked(listener: (host: string) => void): void;
  decide(host: string, port: number): Promise<EgressDecision>;
  close(): Promise<void>;
};

/** Normalisasi host dari permintaan (buang kurung IPv6, titik akhir, huruf besar). */
function normHost(host: string): string {
  return host
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
}

export function createEgressPolicy(rules: readonly EgressRule[], resolve: Resolver = defaultResolver) {
  const byKey = new Map(rules.map((r) => [`${normHost(r.host)}:${r.port}`, r]));
  return async function decide(rawHost: string, port: number): Promise<EgressDecision> {
    const host = normHost(rawHost);
    const rule = byKey.get(`${host}:${port}`);
    if (!rule) return { ok: false, reason: 'host_tidak_diizinkan' };
    let addresses: string[];
    try {
      addresses = isIP(host) ? [host] : await resolve(host);
    } catch {
      return { ok: false, reason: 'dns_gagal' };
    }
    if (addresses.length === 0) return { ok: false, reason: 'dns_kosong' };
    // Semua alamat harus lolos: satu alamat privat = tolak (cegah rebinding berbasis round-robin).
    if (!rule.allowPrivate && addresses.some(isBlockedAddress)) return { ok: false, reason: 'alamat_privat' };
    return { ok: true, address: addresses[0]!, local: rule.allowPrivate === true };
  };
}

function parseAuthority(authority: string): { host: string; port: number } | null {
  const m = /^(\[[0-9a-fA-F:.]+\]|[^:[\]/]+):(\d{1,5})$/.exec(authority);
  if (!m?.[1] || !m[2]) return null;
  const port = Number(m[2]);
  return port > 0 && port < 65536 ? { host: m[1], port } : null;
}

const HOP_BY_HOP = [
  'proxy-connection',
  'proxy-authorization',
  'connection',
  'keep-alive',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
];

const proxyAuth = (u: URL) =>
  u.username
    ? `Basic ${Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString('base64')}`
    : undefined;

/**
 * Terowongan lewat proxy hulu milik operator (PENDAMPING_UPSTREAM_PROXY): CONNECT host:port. Nama host (bukan
 * IP hasil resolusi lokal) dikirim agar CDN memilih lokasi sesuai egress hulu; kebijakan allowlist dan
 * penolakan alamat privat SUDAH diterapkan sebelum titik ini.
 */
export function dialUpstream(upstream: URL, host: string, port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const s = net.connect(Number(upstream.port || 80), upstream.hostname);
    const auth = proxyAuth(upstream);
    const authority = `${isIP(host) === 6 ? `[${host}]` : host}:${port}`;
    s.once('connect', () =>
      s.write(
        `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n${auth ? `Proxy-Authorization: ${auth}\r\n` : ''}\r\n`,
      ),
    );
    let buf = Buffer.alloc(0);
    const onData = (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      const end = buf.indexOf('\r\n\r\n');
      if (end < 0) {
        if (buf.length > 8192) fail(new Error('jawaban proxy hulu terlalu panjang'));
        return;
      }
      s.off('data', onData);
      if (!/^HTTP\/1\.[01] 200/.test(buf.toString('latin1', 0, end)))
        return fail(new Error('proxy hulu menolak'));
      const rest = buf.subarray(end + 4);
      if (rest.length > 0) s.unshift(rest);
      resolve(s);
    };
    const fail = (e: Error) => {
      s.destroy();
      reject(e);
    };
    s.on('data', onData);
    s.once('error', fail);
  });
}

export async function startEgressProxy(
  rules: readonly EgressRule[],
  opts: { resolve?: Resolver; upstream?: URL | undefined } = {},
): Promise<EgressProxy> {
  const decide = createEgressPolicy(rules, opts.resolve);
  const listeners: ((host: string) => void)[] = [];
  const sockets = new Set<Duplex>();
  const blocked = (host: string) => {
    for (const l of listeners) l(normHost(host));
  };
  const track = (s: Duplex) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
    s.on('error', () => s.destroy());
  };

  const server = http.createServer(async (req, res) => {
    // Permintaan HTTP biasa lewat proxy memakai absolute-form: GET http://host:port/path
    let url: URL;
    try {
      url = new URL(req.url ?? '');
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (url.protocol !== 'http:') {
      res.writeHead(400).end();
      return;
    }
    const port = Number(url.port || 80);
    const d = await decide(url.hostname, port);
    if (!d.ok) {
      blocked(url.hostname);
      res.writeHead(403, { 'content-type': 'text/plain' }).end('Diblokir oleh allowlist egress Urusin');
      return;
    }
    const headers: http.OutgoingHttpHeaders = { ...req.headers, host: url.host };
    for (const h of HOP_BY_HOP) delete headers[h];
    const viaHulu = opts.upstream && !d.local ? opts.upstream : undefined;
    const auth = viaHulu ? proxyAuth(viaHulu) : undefined;
    const upstream = http.request(
      viaHulu
        ? {
            host: viaHulu.hostname,
            port: Number(viaHulu.port || 80),
            method: req.method,
            path: url.href,
            headers: auth ? { ...headers, 'proxy-authorization': auth } : headers,
            setHost: false,
          }
        : {
            host: d.address,
            port,
            method: req.method,
            path: url.pathname + url.search,
            headers,
            setHost: false,
          },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });
  server.on('connection', track);

  server.on('connect', async (req, client: Duplex, head: Buffer) => {
    track(client);
    const target = parseAuthority(req.url ?? '');
    const d = target ? await decide(target.host, target.port) : ({ ok: false, reason: 'rusak' } as const);
    if (!target || !d.ok) {
      if (target) blocked(target.host);
      client.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    const sambung = (upstream: net.Socket) => {
      track(upstream);
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    };
    const gagal = () => client.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n');
    if (opts.upstream && !d.local) {
      dialUpstream(opts.upstream, normHost(target.host), target.port).then(sambung, gagal);
      return;
    }
    const upstream = net.connect(target.port, d.address, () => sambung(upstream));
    upstream.on('error', gagal);
  });

  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    onBlocked: (l) => void listeners.push(l),
    decide,
    close: () =>
      new Promise<void>((ok) => {
        for (const s of sockets) s.destroy();
        server.close(() => ok());
      }),
  };
}

/** Aturan egress satu sesi: host https resmi + pihak ketiga (:443) dan origin fixture persis. */
export function egressRules(httpsHosts: readonly string[], fixtureOrigins: readonly string[]): EgressRule[] {
  const rules: EgressRule[] = httpsHosts.map((host) => ({ host, port: 443 }));
  for (const origin of fixtureOrigins) {
    const u = new URL(origin);
    const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
    const host = normHost(u.hostname);
    const local = host === 'localhost' || (isIP(host) !== 0 && isBlockedAddress(host));
    rules.push({ host, port, allowPrivate: local });
  }
  return rules;
}
