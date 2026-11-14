import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Layar virtual untuk Chromium headed di server (Linux tanpa DISPLAY): satu Xvfb untuk semua sesi, dimiliki
 * proses Node ini (berhenti bersama layanan). Tidak ada yang ditampilkan atau direkam.
 * - `-nolisten tcp`: tidak ada port X.
 * - `-auth` dengan cookie MIT-MAGIC-COOKIE acak: dengan network_mode host, soket abstrak X berada di namespace
 *   jaringan host, jadi proses lain di host tidak boleh bisa tersambung ke layar (melihat/menyuntik input)
 *   tanpa cookie ini.
 * Nomor display dipilih Xvfb sendiri (`-displayfd` tanpa `:n`): Xvfb mencoba mengikat soket tiap nomor dan
 * melewati yang sudah dipakai, termasuk soket abstrak `@/tmp/.X11-unix/X<n>` milik Xvfb lain di namespace
 * jaringan yang sama (network_mode host: host produksi sudah punya Xvfb :99). Memeriksa berkas lock di /tmp
 * kontainer saja tidak cukup untuk itu. Cookie dimuat server dari berkas `-auth` saat start (tidak terikat
 * nomor display); entri klien untuk nomor yang terpilih ditambahkan setelah Xvfb siap.
 * Di luar Linux, saat headless, atau bila DISPLAY sudah ada: tidak melakukan apa-apa.
 */
export type Xvfb = { display: string; xauthority: string; stop(): void };

export type XvfbDeps = {
  platform?: NodeJS.Platform;
  spawn?: (cmd: string, args: string[]) => ChildProcess;
  xauth?: (args: string[]) => void;
  timeoutMs?: number;
};

// stderr ditampung (baris terakhir masuk pesan galat); stdout dibuang; fd 3 = nomor display saat siap.
const spawnXvfb = (cmd: string, args: string[]) =>
  spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe'] });

/** Baris tidak kosong terakhir dari keluaran stderr Xvfb (untuk pesan galat), dipotong 300 karakter. */
export function barisTerakhir(teks: string): string {
  const baris = teks
    .split('\n')
    .map((b) => b.trim())
    .filter(Boolean);
  return (baris.at(-1) ?? '').slice(0, 300);
}

export async function ensureDisplay(
  env: Record<string, string | undefined>,
  headless: boolean,
  deps: XvfbDeps = {},
): Promise<Xvfb | undefined> {
  if (headless || (deps.platform ?? process.platform) !== 'linux' || env.DISPLAY) return undefined;
  const dir = mkdtempSync(join(tmpdir(), 'urusin-x-'));
  const xauthority = join(dir, 'Xauthority');
  const cookie = randomBytes(16).toString('hex');
  const xauth = deps.xauth ?? ((a) => void execFileSync('xauth', a, { stdio: 'ignore' }));
  const tambahCookie = (display: string) => xauth(['-q', '-f', xauthority, 'add', display, '.', cookie]);
  // Entri awal hanya agar server memuat cookie dari -auth; nomor display belum diketahui.
  tambahCookie(':0');
  const child = (deps.spawn ?? spawnXvfb)('Xvfb', [
    '-auth',
    xauthority,
    '-screen',
    '0',
    '1280x1024x24',
    '-nolisten',
    'tcp',
    // Tanpa `:n`: Xvfb memilih display bebas pertama dan menulis nomornya ke fd 3 saat siap.
    '-displayfd',
    '3',
  ]);
  const ready = child.stdio[3] as NodeJS.ReadableStream | null | undefined;
  let stderr = '';
  (child.stdio[2] as NodeJS.ReadableStream | null | undefined)?.on('data', (d: Buffer) => {
    stderr = (stderr + d.toString()).slice(-4096);
  });
  let n: number;
  try {
    n = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Xvfb tidak siap')), deps.timeoutMs ?? 10_000);
      let keluar = '';
      const done = (e?: Error, nomor?: number) => {
        clearTimeout(timer);
        if (e) reject(e);
        else resolve(nomor!);
      };
      ready?.on('data', (d: Buffer) => {
        keluar += d.toString();
        const m = /^(\d+)\n/.exec(keluar);
        if (m) done(undefined, Number(m[1]));
      });
      child.once('error', (e) => done(e));
      // Beri stderr kesempatan tiba sebelum pesan disusun.
      child.once('exit', (code) =>
        setImmediate(() => {
          const sebab = barisTerakhir(stderr);
          done(new Error(`Xvfb berhenti (${code})${sebab ? `: ${sebab}` : ''}`));
        }),
      );
    });
    if (n !== 0) tambahCookie(`:${n}`);
  } catch (e) {
    child.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  env.DISPLAY = `:${n}`;
  env.XAUTHORITY = xauthority;
  return {
    display: `:${n}`,
    xauthority,
    stop() {
      child.kill('SIGTERM');
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
