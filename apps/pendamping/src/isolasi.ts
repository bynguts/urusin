import { randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync, readlinkSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import type { Config } from './config.js';
import { headerTanda } from './tanda.js';

/**
 * Isolasi produksi Browser Pendamping (temuan keamanan B1):
 *  - kredensial proxy edge per sesi (`daftarEdge`), satu-satunya jalan keluar Chromium;
 *  - pemeriksaan boot gagal-tertutup: sandbox Chromium benar-benar aktif (`periksaSandbox`) dan kontainer
 *    tidak punya rute keluar langsung (`periksaTanpaRute`).
 */

export type ProxyEdge = {
  server: string;
  username: string;
  password: string;
  hapus(): Promise<void>;
};

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Daftarkan kredensial proxy acak untuk satu sesi di edge (PUT /sesi/<user>, bertanda HMAC). Chromium tidak
 * bisa me-resolve nama (host-resolver-rules), jadi alamat proxy = IP edge hasil DNS Docker di sini.
 */
export async function daftarEdge(
  edge: NonNullable<Config['edge']>,
  hosts: readonly string[],
  ttlMs: number,
  fetcher: Fetcher = fetch,
  resolve: (host: string) => Promise<string> = async (h) => (await lookup(h, { family: 4 })).address,
): Promise<ProxyEdge> {
  const username = randomBytes(12).toString('hex');
  const password = randomBytes(24).toString('hex');
  const path = `/sesi/${username}`;
  const url = new URL(path, edge.kontrol).href;
  const isi = JSON.stringify({ sandi: password, hosts, ttlMs });
  const r = await fetcher(url, {
    method: 'PUT',
    headers: { ...headerTanda(edge.token, 'PUT', path, isi), 'content-type': 'application/json' },
    body: isi,
    signal: AbortSignal.timeout(5000),
  });
  if (r.status !== 201) throw new Error(`edge menolak pendaftaran sesi (${r.status})`);
  const ip = await resolve(edge.kontrol.hostname);
  return {
    server: `http://${ip}:${edge.proxyPort}`,
    username,
    password,
    async hapus() {
      await fetcher(url, {
        method: 'DELETE',
        headers: headerTanda(edge.token, 'DELETE', path),
        signal: AbortSignal.timeout(5000),
      }).catch(() => undefined);
    },
  };
}

export type ProsesInfo = { userns: string; filter: number };

function infoProses(pid: string, proc: string): ProsesInfo | undefined {
  try {
    const st = readFileSync(join(proc, pid, 'status'), 'utf8');
    return {
      userns: readlinkSync(join(proc, pid, 'ns', 'user')),
      filter: Number(/Seccomp_filters:\s*(\d+)/.exec(st)?.[1] ?? 0),
    };
  } catch {
    return undefined;
  }
}

/**
 * Renderer tersandbox = berada di user namespace lain DAN punya filter seccomp lebih banyak dari proses ini
 * (filter kontainer + seccomp-bpf Chromium). `Seccomp: 2` saja tidak cukup: filter kontainer sudah membuatnya 2.
 */
export function adaRendererTersandbox(
  pids: readonly number[],
  baca: (pid: string) => ProsesInfo | undefined = (pid) => infoProses(pid, '/proc'),
): boolean {
  const aku = baca('self');
  if (!aku) return false;
  return pids.some((pid) => {
    const p = baca(String(pid));
    return p !== undefined && p.userns !== aku.userns && p.filter > aku.filter;
  });
}

/**
 * Boot gagal-tertutup: luncurkan Chromium persis seperti sesi (sandbox aktif), muat satu halaman lokal, lalu
 * pastikan renderernya tersandbox. Di Ubuntu 24.04 (AppArmor membatasi userns) atau tanpa profil seccomp
 * Playwright + SYS_CHROOT, Chromium gagal start atau renderer tidak tersandbox: pendamping menolak start.
 */
export async function periksaSandbox(
  config: Pick<Config, 'headless' | 'chromiumPath'>,
  pidsOfProfile: (dir: string) => number[],
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'urusin-sandbox-'));
  try {
    const ctx = await chromium.launchPersistentContext(dir, {
      headless: config.headless,
      chromiumSandbox: true,
      ...(config.chromiumPath ? { executablePath: config.chromiumPath } : {}),
      // Tanpa jaringan sama sekali: proxy ke port tertutup, DNS dimatikan.
      proxy: { server: 'http://127.0.0.1:9', bypass: '<-loopback>' },
      args: ['--disable-gpu', '--host-resolver-rules=MAP * ~NOTFOUND'],
    });
    try {
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      await page.setContent('<p>sandbox</p>');
      if (!adaRendererTersandbox(pidsOfProfile(dir)))
        throw new Error('renderer Chromium tidak tersandbox (userns + seccomp-bpf)');
    } finally {
      await ctx.close().catch(() => undefined);
    }
  } catch (e) {
    throw new Error(
      `sandbox Chromium tidak aktif; pendamping menolak start (butuh profil seccomp Playwright + cap SYS_CHROOT): ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`,
      { cause: e },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Baris rute default (tujuan 0/0) di /proc/net/route dan /proc/net/ipv6_route. */
export function ruteBawaan(proc = '/proc'): string[] {
  const out: string[] = [];
  try {
    for (const baris of readFileSync(join(proc, 'net', 'route'), 'utf8')
      .split('\n')
      .slice(1)) {
      const k = baris.trim().split(/\s+/);
      if (k.length > 7 && k[1] === '00000000' && k[7] === '00000000') out.push(`ipv4 via ${k[0]}`);
    }
  } catch {
    // tanpa IPv4 sama sekali
  }
  try {
    for (const baris of readFileSync(join(proc, 'net', 'ipv6_route'), 'utf8').split('\n')) {
      const k = baris.trim().split(/\s+/);
      if (k.length > 9 && /^0{32}$/.test(k[0]!) && k[1] === '00' && k[9] !== 'lo')
        out.push(`ipv6 via ${k[9]}`);
    }
  } catch {
    // IPv6 mati
  }
  return out;
}

/** true bila TCP ke alamat ini tersambung dalam `ms` (artinya ada rute keluar langsung). */
export function bisaTersambung(host: string, port: number, ms = 2000): Promise<boolean> {
  return new Promise((ok) => {
    const s = net.connect({ host, port });
    const selesai = (v: boolean) => {
      s.destroy();
      ok(v);
    };
    s.setTimeout(ms, () => selesai(false));
    s.once('connect', () => selesai(true));
    s.once('error', () => selesai(false));
  });
}

/**
 * Boot gagal-tertutup di produksi: kontainer pendamping (jaringan internal saja) tidak boleh punya rute
 * default, dan sambungan langsung ke internet harus gagal. Edge adalah satu-satunya jalan keluar.
 */
export async function periksaTanpaRute(
  proc = '/proc',
  coba: (host: string, port: number) => Promise<boolean> = bisaTersambung,
): Promise<void> {
  const rute = ruteBawaan(proc);
  if (rute.length > 0)
    throw new Error(`pendamping punya rute keluar langsung (${rute.join(', ')}); menolak start`);
  for (const [host, port] of [
    ['1.1.1.1', 443],
    ['8.8.8.8', 53],
  ] as const)
    if (await coba(host, port))
      throw new Error(`pendamping tersambung langsung ke ${host}:${port}; menolak start`);
}
