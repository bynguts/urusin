import { promises as dns, type LookupAddress } from 'node:dns';
import { Agent, buildConnector, setGlobalDispatcher } from 'undici';
import {
  assertTargetAllowed,
  assertUrlAllowed,
  buildAllowlist,
  EgressBlockedError,
  isBlockedAddress,
  isLlmProxy,
} from './policy.js';
import type { Allowlist, EgressProfile } from './policy.js';

/** Resolusi DNS (semua alamat). Bisa diganti di tes. */
export type Resolver = (hostname: string) => Promise<LookupAddress[]>;

type LookupCallback = (err: Error | null, address: string | LookupAddress[], family?: number) => void;

export type EgressOptions = {
  /** `runtime` (default: LLM + Jina) atau `ingest` (registry resmi + `.go.id`). */
  profile?: EgressProfile;
  /** Sumber base URL operator (default process.env). */
  env?: Record<string, string | undefined>;
  resolve?: Resolver;
  /** Batas hop redirect yang diikuti (default 5). */
  maxRedirects?: number;
  /** Batas waktu membuka koneksi (ms, default 10000). */
  connectTimeoutMs?: number;
  /** Pengganti transport per hop (hanya tes logika redirect); default fetch global + `agent`. */
  transport?: (url: URL, init: RequestInit) => Promise<Response>;
};

export type EgressFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type Egress = {
  /** Dispatcher undici yang memeriksa tujuan dan setiap alamat hasil DNS sebelum tersambung. */
  agent: Agent;
  /** fetch yang memakai `agent`, redirect manual dan memeriksa ulang setiap hop. */
  fetch: EgressFetch;
  allowlist: Allowlist;
};

const defaultResolve: Resolver = (hostname) => dns.lookup(hostname, { all: true, order: 'verbatim' });

/** Hook `lookup` untuk net/tls.connect: tolak host bila SATU saja alamatnya lokal/privat. */
function guardedLookup(resolve: Resolver) {
  return (hostname: string, options: { all?: boolean }, cb: LookupCallback): void => {
    resolve(hostname).then(
      (addrs) => {
        const bad = addrs.find((a) => isBlockedAddress(a.address));
        if (bad)
          return cb(
            new EgressBlockedError(`${hostname} resolve ke alamat lokal/privat ${bad.address}`),
            '',
            0,
          );
        const first = addrs[0];
        if (!first) return cb(new EgressBlockedError(`${hostname} tidak punya alamat`), '', 0);
        if (options.all) cb(null, addrs);
        else cb(null, first.address, first.family);
      },
      (err: Error) => cb(err, '', 0),
    );
  };
}

const REDIRECT = new Set([301, 302, 303, 307, 308]);
const port = (protocol: string, p: string) => Number(p) || (protocol === 'https:' ? 443 : 80);

/** Body yang aman dikirim ulang pada redirect 307/308. */
const replayable = (b: unknown) =>
  b == null ||
  typeof b === 'string' ||
  b instanceof URLSearchParams ||
  b instanceof ArrayBuffer ||
  ArrayBuffer.isView(b) ||
  b instanceof Blob ||
  b instanceof FormData;

export function createEgress(opts: EgressOptions = {}): Egress {
  const allowlist = buildAllowlist(opts.profile ?? 'runtime', opts.env);
  const maxRedirects = opts.maxRedirects ?? 5;
  const base = buildConnector({
    lookup: guardedLookup(opts.resolve ?? defaultResolve),
    timeout: opts.connectTimeoutMs ?? 10_000,
  } as buildConnector.BuildOptions);
  const agent = new Agent({
    connect: (o, cb) => {
      try {
        // IP literal tidak melewati lookup, jadi tujuan diperiksa di sini juga (bukan hanya di fetch).
        assertTargetAllowed(o.protocol, o.hostname, port(o.protocol, o.port), allowlist);
      } catch (err) {
        return cb(err as Error, null);
      }
      base(o, cb);
    },
  });

  const fetchVia =
    opts.transport ??
    ((url: URL, init: RequestInit) =>
      // Satu-satunya fetch global di server (lint mengecualikan modul ini): selalu dengan dispatcher egress.
      fetch(url.href, { ...init, redirect: 'manual', dispatcher: agent } as RequestInit));

  const egressFetch: EgressFetch = async (input, init = {}) => {
    if (input instanceof Request) throw new EgressBlockedError('objek Request tidak didukung; kirim URL');
    const mode = init.redirect ?? 'follow';
    let url = assertUrlAllowed(input, allowlist);
    const original = url;
    let method = (init.method ?? 'GET').toUpperCase();
    let body = init.body;
    const headers = new Headers(init.headers);
    for (let hop = 0; ; hop++) {
      const res = await fetchVia(url, { ...init, method, body, headers, redirect: 'manual' });
      const location = res.headers.get('location');
      if (mode === 'manual' || !REDIRECT.has(res.status) || !location) return res;
      await res.body?.cancel();
      if (mode === 'error') throw new TypeError(`redirect ${res.status} ditolak (redirect: 'error')`);
      if (hop >= maxRedirects) throw new EgressBlockedError(`lebih dari ${maxRedirects} redirect`);
      const next = assertUrlAllowed(new URL(location, url), allowlist);
      // Host luar (mis. *.go.id) tidak boleh membelokkan permintaan ke proxy LLM lokal (M1).
      if (isLlmProxy(next) && !isLlmProxy(original))
        throw new EgressBlockedError('redirect ke proxy LLM lokal dari host lain ditolak');
      if (
        (res.status === 303 && method !== 'HEAD') ||
        ((res.status === 301 || res.status === 302) && method === 'POST')
      ) {
        method = 'GET';
        body = null;
        headers.delete('content-type');
        headers.delete('content-length');
      } else if (!replayable(body)) {
        throw new EgressBlockedError('redirect dengan body stream tidak bisa diulang');
      }
      if (next.origin !== url.origin) {
        for (const h of ['authorization', 'proxy-authorization', 'cookie']) headers.delete(h);
      }
      url = next;
    }
  };

  return { agent, fetch: egressFetch, allowlist };
}

const shared: Partial<Record<EgressProfile, Egress>> = {};

/** Egress `runtime` bersama proses (dibuat saat pertama dipakai agar env sudah termuat): LLM + Jina. */
export function sharedEgress(): Egress {
  shared.runtime ??= createEgress({ profile: 'runtime' });
  return shared.runtime;
}

/** Egress `ingest` bersama proses: registry resmi + `.go.id` (rag:ingest/verify, CLI kanal/kontak). */
export function sharedIngestEgress(): Egress {
  shared.ingest ??= createEgress({ profile: 'ingest' });
  return shared.ingest;
}

/** fetch server yang sah untuk LLM dan Jina. */
export const egressFetch: EgressFetch = (input, init) => sharedEgress().fetch(input, init);

/** fetch untuk mengambil sumber resmi (korpus, kanal, kontak). */
export const ingestEgressFetch: EgressFetch = (input, init) => sharedIngestEgress().fetch(input, init);

/**
 * Backstop runtime (M2): jadikan Agent egress sebagai dispatcher global undici, sehingga fetch global,
 * `event.fetch`, default SDK openai dan WebSocket undici juga lewat konektor yang dijaga.
 * Panggil sekali saat boot (hooks.server.ts, entry CLI).
 */
export function installEgressBackstop(profile: EgressProfile = 'runtime'): Egress {
  const e = profile === 'ingest' ? sharedIngestEgress() : sharedEgress();
  setGlobalDispatcher(e.agent);
  return e;
}
