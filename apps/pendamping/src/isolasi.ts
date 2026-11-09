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

/**
 * `userns`: tautan /proc/<pid>/ns/user, undefined bila tidak terbaca (proses sandbox setuid tidak dumpable,
 * jadi tautan ns-nya EACCES). `pidns`: kedalaman namespace PID dari baris `NSpid` (1 = tidak bersarang).
 */
export type ProsesInfo = { userns?: string | undefined; pidns: number; filter: number };
export type JenisSandbox = 'userns' | 'setuid';

function infoProses(pid: string, proc: string): ProsesInfo | undefined {
  let st: string;
  try {
    st = readFileSync(join(proc, pid, 'status'), 'utf8');
  } catch {
    return undefined;
  }
  let userns: string | undefined;
  try {
    userns = readlinkSync(join(proc, pid, 'ns', 'user'));
  } catch {
    userns = undefined;
  }
  return {
    userns,
    pidns: (/NSpid:\s*([^\n]*)/.exec(st)?.[1] ?? '').trim().split(/\s+/).filter(Boolean).length,
    filter: Number(/Seccomp_filters:\s*(\d+)/.exec(st)?.[1] ?? 0),
  };
}

/**
 * Jenis sandbox renderer, atau null bila tidak ada renderer tersandbox. Keduanya WAJIB punya filter seccomp
 * lebih banyak dari proses ini (filter kontainer + seccomp-bpf Chromium; `Seccomp: 2` saja tidak cukup):
 * - `userns`: sandbox namespace (renderer di user namespace lain);
 * - `setuid`: sandbox setuid `chrome-sandbox` (host yang mematikan userns tak berhak, mis. agent-vm): renderer
 *   di namespace PID baru (NSpid bersarang) dalam user namespace yang sama.
 */
export function jenisSandboxRenderer(
  pids: readonly number[],
  baca: (pid: string) => ProsesInfo | undefined = (pid) => infoProses(pid, '/proc'),
): JenisSandbox | null {
  const aku = baca('self');
  if (!aku?.userns || aku.pidns < 1) return null;
  let jenis: JenisSandbox | null = null;
  for (const pid of pids) {
    const p = baca(String(pid));
    if (!p || p.filter <= aku.filter) continue;
    if (p.userns !== undefined && p.userns !== aku.userns) return 'userns';
    if (p.pidns > aku.pidns) jenis = 'setuid';
  }
  return jenis;
}

/**
 * Boot gagal-tertutup: luncurkan Chromium persis seperti sesi (sandbox aktif), muat satu halaman lokal, lalu
 * pastikan renderernya tersandbox (userns ATAU setuid `chrome-sandbox`), lalu kembalikan jenisnya. Tanpa
 * userns dan tanpa helper setuid yang berfungsi (SYS_ADMIN + SYS_CHROOT, tanpa no-new-privileges), Chromium
 * gagal start atau renderer tidak tersandbox: pendamping menolak start. Tidak pernah --no-sandbox.
 */
export async function periksaSandbox(
  config: Pick<Config, 'headless' | 'chromiumPath'>,
  pidsOfProfile: (dir: string) => number[],
): Promise<JenisSandbox> {
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
      const jenis = jenisSandboxRenderer(pidsOfProfile(dir));
      if (!jenis) throw new Error('renderer Chromium tidak tersandbox (userns/setuid + seccomp-bpf)');
      return jenis;
    } finally {
      await ctx.close().catch(() => undefined);
    }
  } catch (e) {
    throw new Error(
      `sandbox Chromium tidak aktif; pendamping menolak start (butuh profil seccomp Playwright + SYS_CHROOT; sandbox setuid juga SYS_ADMIN tanpa no-new-privileges): ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`,
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
