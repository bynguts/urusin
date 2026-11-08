import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Layar virtual untuk Chromium headed di server (Linux tanpa DISPLAY): satu Xvfb untuk semua sesi, dimiliki
 * proses Node ini (berhenti bersama layanan). Tidak ada yang ditampilkan atau direkam.
 * - `-nolisten tcp`: tidak ada port X.
 * - `-auth` dengan cookie MIT-MAGIC-COOKIE acak: dengan network_mode host, soket abstrak X berada di namespace
 *   jaringan host, jadi proses lain di host tidak boleh bisa tersambung ke layar (melihat/menyuntik input)
 *   tanpa cookie ini.
 * Di luar Linux, saat headless, atau bila DISPLAY sudah ada: tidak melakukan apa-apa.
 */
export type Xvfb = { display: string; xauthority: string; stop(): void };

export type XvfbDeps = {
  platform?: NodeJS.Platform;
  spawn?: (cmd: string, args: string[]) => ChildProcess;
  xauth?: (args: string[]) => void;
  exists?: (path: string) => boolean;
  timeoutMs?: number;
};

const spawnXvfb = (cmd: string, args: string[]) =>
  spawn(cmd, args, { stdio: ['ignore', 'ignore', 'ignore', 'pipe'] });

export async function ensureDisplay(
  env: Record<string, string | undefined>,
  headless: boolean,
  deps: XvfbDeps = {},
): Promise<Xvfb | undefined> {
  if (headless || (deps.platform ?? process.platform) !== 'linux' || env.DISPLAY) return undefined;
  const exists = deps.exists ?? existsSync;
  let n = 99;
  while (exists(`/tmp/.X${n}-lock`) && n < 199) n++;
  const dir = mkdtempSync(join(tmpdir(), 'urusin-x-'));
  const xauthority = join(dir, 'Xauthority');
  (deps.xauth ?? ((a) => void execFileSync('xauth', a, { stdio: 'ignore' })))([
    '-q',
    '-f',
    xauthority,
    'add',
    `:${n}`,
    '.',
    randomBytes(16).toString('hex'),
  ]);
  const child = (deps.spawn ?? spawnXvfb)('Xvfb', [
    `:${n}`,
    '-auth',
    xauthority,
    '-screen',
    '0',
    '1280x1024x24',
    '-nolisten',
    'tcp',
    // Xvfb menulis nomor display ke fd 3 saat siap menerima koneksi.
    '-displayfd',
    '3',
  ]);
  const ready = child.stdio[3] as NodeJS.ReadableStream | null | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Xvfb tidak siap')), deps.timeoutMs ?? 10_000);
      const done = (e?: Error) => {
        clearTimeout(timer);
        if (e) reject(e);
        else resolve();
      };
      ready?.on('data', (d: Buffer) => /\d/.test(d.toString()) && done());
      child.once('error', (e) => done(e));
      child.once('exit', (code) => done(new Error(`Xvfb berhenti (${code})`)));
    });
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
