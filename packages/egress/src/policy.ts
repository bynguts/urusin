import { BlockList, isIP } from 'node:net';
import { EGRESS_PIHAK_KETIGA, OFFICIAL_DOMAINS } from '@urusin/core';

/**
 * Kebijakan egress server (review v11 B2). Web berjalan di network host, jadi SSRF bisa menjangkau
 * layanan loopback milik pengguna (mis. admin API Caddy di 127.0.0.1:2019). Aturannya:
 * - Alamat lokal yang boleh hanya: persis `127.0.0.1:20128` (proxy LLM di host), sebagai IP literal, dan
 *   HANYA bila `LLM_BASE_URL` memang origin itu; serta origin internal worker Browser Pendamping yang
 *   dikonfigurasi operator (`PENDAMPING_INTERNAL_URL` / `PENDAMPING_WORKERS[].url`), HANYA http, IP literal
 *   127.0.0.1 atau Tailscale 100.64.0.0/10 dengan port eksplisit, persis (profil runtime). Nama DNS yang
 *   resolve ke loopback tetap ditolak.
 * - Gateway LLM Tailscale pada port 20128 hanya boleh pada origin persis `LLM_BASE_URL`, profil runtime.
 * - Dua profil terpisah (L2):
 *   - `runtime` (server web): host Jina + host akun (Google, Resend) + origin base URL
 *     LLM/embedding/rerank dari env operator.
 *   - `ingest` (rag:ingest/verify, CLI kanal/kontak): registry domain resmi + sufiks `.go.id`, https:443.
 *   - `browser` (proxy CONNECT peramban Browser Pendamping, `checkConnect`): HANYA https:443 ke host persis
 *     yang ada di set sesi DAN di union registry (domain resmi + pihak ketiga terdaftar, mis. Turnstile).
 *     Tanpa pengecualian proxy LLM, tanpa wildcard `*.go.id`, tanpa IP literal.
 * - Setiap alamat hasil resolusi DNS diperiksa: loopback, privat, link-local, CGNAT, dan padanan IPv6
 *   ditolak. Satu alamat terlarang saja sudah cukup untuk menolak seluruh host.
 */

export type EgressProfile = 'runtime' | 'ingest' | 'browser';

export const LLM_PROXY = Object.freeze({ host: '127.0.0.1', port: 20128 });

/** Host API Jina (embedding, rerank, reader). */
export const JINA_HOSTS: readonly string[] = Object.freeze(['api.jina.ai', 'r.jina.ai', 's.jina.ai']);

/**
 * Host akun warga (ADR 0028): Google OAuth/OIDC (otorisasi, token, JWKS) dan API Resend untuk email
 * verifikasi/atur ulang. Hanya profil runtime.
 */
export const AUTH_HOSTS: readonly string[] = Object.freeze([
  'accounts.google.com',
  'oauth2.googleapis.com',
  'www.googleapis.com',
  'api.resend.com',
]);

/** Verifikasi token Turnstile (siteverify) untuk "Masuk sebagai juri" dan login setelah 3 kegagalan. */
export const TURNSTILE_HOSTS: readonly string[] = Object.freeze(['challenges.cloudflare.com']);

/** Sufiks domain pemerintah yang boleh diambil korpus RAG (`rag:ingest` / `rag:verify`). */
export const OFFICIAL_SUFFIX = '.go.id';

/** Variabel env berisi base URL yang dikonfigurasi operator (tepercaya, bukan input pengguna). */
export const CONFIGURED_URL_VARS: readonly string[] = Object.freeze([
  'LLM_BASE_URL',
  'LLM_TRANSCRIBE_BASE_URL',
  'LLM_EMBED_BASE_URL',
  'RERANK_BASE_URL',
]);

export class EgressBlockedError extends Error {
  readonly code = 'EGRESS_BLOCKED';
  constructor(reason: string) {
    super(`Egress diblokir: ${reason}`);
    this.name = 'EgressBlockedError';
  }
}

const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // privat
  ['100.64.0.0', 10], // CGNAT (juga tailscale)
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, termasuk metadata cloud 169.254.169.254
  ['172.16.0.0', 12], // privat (termasuk bridge Docker)
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // dokumentasi
  ['192.88.99.0', 24], // relay 6to4
  ['192.168.0.0', 16], // privat
  ['198.18.0.0', 15], // benchmark
  ['198.51.100.0', 24], // dokumentasi
  ['203.0.113.0', 24], // dokumentasi
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // cadangan + broadcast
] as const)
  BLOCKED.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['::', 96], // IPv4-compatible (usang)
  ['::ffff:0:0:0', 96], // IPv4-translated (SIIT)
  ['64:ff9b::', 96], // NAT64 (bisa membungkus alamat privat)
  ['64:ff9b:1::', 48], // NAT64 lokal
  ['100::', 64], // discard
  ['2001::', 23], // IETF special (Teredo, dokumentasi, ORCHID)
  ['2001:db8::', 32], // dokumentasi
  ['2002::', 16], // 6to4 (membungkus IPv4)
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (usang)
  ['ff00::', 8], // multicast
] as const)
  BLOCKED.addSubnet(net, prefix, 'ipv6');

const unbracket = (h: string) => (h.startsWith('[') && h.endsWith(']') ? h.slice(1, -1) : h);

/** true bila alamat IP literal termasuk rentang terlarang (IPv4-mapped IPv6 ikut diperiksa sebagai IPv4). */
export function isBlockedAddress(address: string): boolean {
  const ip = unbracket(address);
  const family = isIP(ip);
  if (family === 0) return true; // bukan IP: jangan pernah dianggap aman
  return BLOCKED.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

export type Allowlist = {
  /** Host persis (huruf kecil) yang boleh lewat https:443. */
  hosts: ReadonlySet<string>;
  /** Sufiks host (mis. `.go.id`) yang boleh lewat https:443. */
  suffixes: readonly string[];
  /** Origin persis `protocol//host:port` dari env operator (port eksplisit). */
  configured: ReadonlySet<string>;
  /** true hanya bila LLM_BASE_URL = 127.0.0.1:20128: pengecualian loopback proxy LLM aktif. */
  llmProxy: boolean;
  /** Gateway LLM Tailscale: origin IP literal persis dari LLM_BASE_URL, hanya port 20128. */
  llmTailscale?: string;
  /** Origin internal worker pendamping (`http://IP:port`, loopback/Tailscale) yang boleh persis. */
  internal?: ReadonlySet<string>;
};

const defaultPort = (protocol: string) => (protocol === 'https:' ? 443 : protocol === 'http:' ? 80 : NaN);

function originKey(protocol: string, host: string, port: number): string {
  return `${protocol}//${host.toLowerCase()}:${port}`;
}

const parseOrigin = (raw: string | undefined): { protocol: string; host: string; port: number } | null => {
  const v = raw?.trim();
  if (!v) return null;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  return {
    protocol: u.protocol,
    host: unbracket(u.hostname),
    port: Number(u.port) || defaultPort(u.protocol),
  };
};

const TAILSCALE = new BlockList();
TAILSCALE.addSubnet('100.64.0.0', 10, 'ipv4');
/** Port lokal yang tidak pernah boleh jadi origin internal (admin Caddy, proxy LLM). */
const PORT_TERLARANG = new Set([2019, LLM_PROXY.port]);

/**
 * Origin internal worker Browser Pendamping dari env operator: `PENDAMPING_INTERNAL_URL` dan setiap `url`
 * di JSON `PENDAMPING_WORKERS`. Hanya `http:` dengan IP literal 127.0.0.1 atau 100.64.0.0/10 (Tailscale)
 * dan port eksplisit; selain itu diabaikan (tetap diblokir).
 */
export function pendampingInternalOrigins(env: Record<string, string | undefined>): Set<string> {
  const raw: (string | undefined)[] = [env.PENDAMPING_INTERNAL_URL];
  try {
    const w: unknown = JSON.parse(env.PENDAMPING_WORKERS ?? '[]');
    if (Array.isArray(w))
      for (const x of w)
        if (x && typeof x === 'object' && 'url' in x && typeof x.url === 'string') raw.push(x.url);
  } catch {
    /* JSON rusak: tidak ada worker tambahan */
  }
  const out = new Set<string>();
  for (const r of raw) {
    let u: URL;
    try {
      u = new URL(r ?? '');
    } catch {
      continue;
    }
    const host = unbracket(u.hostname);
    const port = Number(u.port);
    if (u.protocol !== 'http:' || !port || PORT_TERLARANG.has(port) || isIP(host) !== 4) continue;
    if (host !== '127.0.0.1' && !TAILSCALE.check(host, 'ipv4')) continue;
    out.add(originKey('http:', host, port));
  }
  return out;
}

/** true bila URL menuju persis origin internal worker pendamping yang dikonfigurasi. */
export function isPendampingInternal(u: URL, allow: Allowlist): boolean {
  const port = Number(u.port) || defaultPort(u.protocol);
  return allow.internal?.has(originKey(u.protocol, unbracket(u.hostname), port)) ?? false;
}

/** true bila URL menuju persis proxy LLM 127.0.0.1:20128. */
export function isLlmProxy(u: URL): boolean {
  return u.hostname === LLM_PROXY.host && (Number(u.port) || defaultPort(u.protocol)) === LLM_PROXY.port;
}

export function isLlmTailscale(u: URL, allow: Allowlist): boolean {
  return (
    allow.llmTailscale ===
    originKey(u.protocol, unbracket(u.hostname), Number(u.port) || defaultPort(u.protocol))
  );
}

/** Allowlist per profil. `runtime` memakai origin base URL dari env operator; `ingest` tidak. */
export function buildAllowlist(
  profile: EgressProfile = 'runtime',
  env: Record<string, string | undefined> = process.env,
): Allowlist {
  if (profile === 'browser') {
    return { hosts: browserUnion(), suffixes: [], configured: new Set(), llmProxy: false };
  }
  if (profile === 'ingest') {
    return {
      hosts: new Set(OFFICIAL_DOMAINS.map((d) => d.host)),
      suffixes: [OFFICIAL_SUFFIX],
      configured: new Set(),
      llmProxy: false,
    };
  }
  const configured = new Set<string>();
  for (const name of CONFIGURED_URL_VARS) {
    const o = parseOrigin(env[name]);
    if (o) configured.add(originKey(o.protocol, o.host, o.port));
  }
  const llm = parseOrigin(env.LLM_BASE_URL);
  return {
    hosts: new Set([...JINA_HOSTS, ...AUTH_HOSTS, ...TURNSTILE_HOSTS]),
    suffixes: [],
    configured,
    llmProxy: !!llm && llm.host === LLM_PROXY.host && llm.port === LLM_PROXY.port,
    ...(llm && isIP(llm.host) === 4 && TAILSCALE.check(llm.host, 'ipv4') && llm.port === LLM_PROXY.port
      ? { llmTailscale: originKey(llm.protocol, llm.host, llm.port) }
      : {}),
    internal: pendampingInternalOrigins(env),
  };
}

/**
 * Putuskan apakah tujuan (sebelum DNS) boleh. Melempar EgressBlockedError bila tidak.
 * Mengembalikan true bila tujuan adalah IP literal (tidak ada resolusi DNS), false bila hostname.
 */
export function assertTargetAllowed(
  protocol: string,
  hostname: string,
  port: number,
  allow: Allowlist,
): boolean {
  const host = unbracket(hostname).toLowerCase().replace(/\.$/, '');
  if (protocol !== 'https:' && protocol !== 'http:')
    throw new EgressBlockedError(`skema ${protocol} tidak didukung`);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new EgressBlockedError(`port ${port} tidak valid`);
  if (isIP(host) !== 0) {
    if (allow.llmProxy && host === LLM_PROXY.host && port === LLM_PROXY.port) return true;
    if (allow.llmTailscale === originKey(protocol, host, port)) return true;
    if (allow.internal?.has(originKey(protocol, host, port))) return true;
    if (isBlockedAddress(host)) throw new EgressBlockedError(`alamat ${host}:${port} lokal/privat`);
    if (allow.configured.has(originKey(protocol, host, port))) return true;
    throw new EgressBlockedError(`IP literal ${host}:${port} tidak di allowlist`);
  }
  if (allow.configured.has(originKey(protocol, host, port))) return false;
  const listed = allow.hosts.has(host) || allow.suffixes.some((sfx) => host.endsWith(sfx));
  if (!listed) throw new EgressBlockedError(`host ${host} tidak di allowlist`);
  if (protocol !== 'https:' || port !== 443)
    throw new EgressBlockedError(`host ${host} hanya lewat https:443`);
  return false;
}

/** Periksa URL lengkap (dipakai sebelum request dan pada setiap hop redirect). */
export function assertUrlAllowed(raw: string | URL, allow: Allowlist): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new EgressBlockedError('URL tidak valid');
  }
  if (u.username || u.password) throw new EgressBlockedError('URL dengan userinfo ditolak');
  assertTargetAllowed(u.protocol, u.hostname, Number(u.port) || defaultPort(u.protocol), allow);
  return u;
}

/**
 * Union global host peramban: domain resmi registry + pihak ketiga terdaftar (`EGRESS_PIHAK_KETIGA`) + tambahan
 * operator (mis. host fixture publik). Batas atas yang tidak bisa diperlebar oleh set per sesi.
 */
export function browserUnion(tambahan: readonly string[] = []): Set<string> {
  return new Set(
    [...OFFICIAL_DOMAINS.map((d) => d.host), ...EGRESS_PIHAK_KETIGA.map((e) => e.host), ...tambahan].map(
      (h) => h.toLowerCase(),
    ),
  );
}

/** Lingkup satu sesi peramban: host persis sesi itu; `union` = batas global (bawaan `browserUnion()`). */
export type BrowserScope = { sesi: ReadonlySet<string>; union?: ReadonlySet<string> };

/**
 * Keputusan CONNECT proxy peramban (profil `browser`), dipanggil SETELAH proxy me-resolve DNS sendiri untuk
 * SETIAP alamat hasil resolusi; proxy lalu tersambung ke alamat yang sudah diperiksa ini. Melempar
 * EgressBlockedError bila: bukan https:443, host IP literal, host di luar union global atau di luar set
 * sesi, atau alamat terlarang (loopback, privat, CGNAT/Tailscale, link-local/metadata, `::ffff:`, NAT64,
 * 6to4, IPv4-compatible). Port proxy LLM (20128) dan admin Caddy (2019) tidak pernah lolos (hanya :443).
 */
export function checkConnect(
  host: string,
  port: number,
  resolvedIp: string,
  profile: 'browser',
  scope: BrowserScope,
): void {
  const h = checkConnectHost(host, port, profile, scope);
  if (isBlockedAddress(resolvedIp))
    throw new EgressBlockedError(`${h} resolve ke alamat terlarang ${resolvedIp}`);
}

const BROWSER_UNION = browserUnion();

/**
 * Bagian `checkConnect` yang tidak butuh DNS (profil, port, IP literal, union, set sesi). Dipanggil proxy
 * SEBELUM me-resolve, agar host di luar izin tidak pernah memicu kueri DNS. Mengembalikan host ternormalisasi.
 */
export function checkConnectHost(
  host: string,
  port: number,
  profile: 'browser',
  scope: BrowserScope,
): string {
  if (profile !== 'browser') throw new EgressBlockedError(`profil ${String(profile)} bukan untuk CONNECT`);
  const h = unbracket(host).toLowerCase().replace(/\.$/, '');
  if (port !== 443) throw new EgressBlockedError(`${h}:${port} bukan https:443`);
  if (isIP(h) !== 0) throw new EgressBlockedError(`IP literal ${h} tidak diizinkan untuk peramban`);
  if (!(scope.union ?? BROWSER_UNION).has(h))
    throw new EgressBlockedError(`host ${h} di luar union registry`);
  if (!scope.sesi.has(h)) throw new EgressBlockedError(`host ${h} di luar allowlist sesi`);
  return h;
}
