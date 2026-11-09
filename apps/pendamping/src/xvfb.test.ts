import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { barisTerakhir, ensureDisplay } from './xvfb.js';

function fakeChild() {
  const fd3 = new PassThrough();
  const err = new PassThrough();
  const child = Object.assign(new EventEmitter(), {
    stdio: [null, null, err, fd3],
    killed: [] as string[],
    kill(sig: string) {
      child.killed.push(sig);
      return true;
    },
  });
  return { child, fd3, err };
}

describe('ensureDisplay (Xvfb)', () => {
  it('tidak melakukan apa-apa: headless, bukan Linux, atau DISPLAY sudah ada', async () => {
    expect(await ensureDisplay({}, true, { platform: 'linux' })).toBeUndefined();
    expect(await ensureDisplay({}, false, { platform: 'win32' })).toBeUndefined();
    expect(await ensureDisplay({ DISPLAY: ':0' }, false, { platform: 'linux' })).toBeUndefined();
  });

  it('Linux headed: Xvfb memilih display sendiri (-displayfd, tanpa :n); cookie untuk display terpilih', async () => {
    const { child, fd3 } = fakeChild();
    const calls: { xauth: string[][]; xvfb?: string[] } = { xauth: [] };
    const env: Record<string, string | undefined> = {};
    const p = ensureDisplay(env, false, {
      platform: 'linux',
      xauth: (a) => void calls.xauth.push(a),
      spawn: (_cmd, args) => {
        calls.xvfb = args;
        // Host sudah punya Xvfb :99 (soket abstrak di namespace jaringan yang sama): Xvfb melompat ke :100,
        // menulis nomornya dalam dua potong.
        setTimeout(() => fd3.write('10'), 5);
        setTimeout(() => fd3.write('0\n'), 10);
        return child as unknown as ChildProcess;
      },
    });
    const x = await p;
    expect(x?.display).toBe(':100');
    expect(env).toMatchObject({ DISPLAY: ':100', XAUTHORITY: x?.xauthority });
    expect(calls.xvfb).toEqual(expect.arrayContaining(['-auth', '-nolisten', 'tcp', '-displayfd', '3']));
    expect(calls.xvfb?.some((a) => /^:\d+$/.test(a))).toBe(false);
    // Cookie yang sama: dimuat server lewat entri awal, lalu entri klien untuk :100.
    expect(calls.xauth.map((a) => a[4])).toEqual([':0', ':100']);
    expect(calls.xauth[0]?.[6]).toMatch(/^[0-9a-f]{32}$/);
    expect(calls.xauth[1]?.[6]).toBe(calls.xauth[0]?.[6]);
    x?.stop();
    expect(child.killed).toEqual(['SIGTERM']);
    expect(existsSync(x!.xauthority)).toBe(false);
  });

  it('Xvfb berhenti: baris terakhir stderr ada di pesan galat', async () => {
    const { child, err } = fakeChild();
    const p = ensureDisplay({}, false, {
      platform: 'linux',
      xauth: () => {},
      spawn: () => {
        setTimeout(() => {
          err.write('_XSERVTransMakeAllCOTSServerListeners: server already running\n');
          err.write(
            "(EE)\nFatal server error:\n(EE) Cannot establish any listening sockets - Make sure an X server isn't already running(EE)\n",
          );
          child.emit('exit', 1);
        }, 5);
        return child as unknown as ChildProcess;
      },
    });
    await expect(p).rejects.toThrow(/Xvfb berhenti \(1\): \(EE\) Cannot establish any listening sockets/);
    expect(barisTerakhir('a\n\n  b  \n')).toBe('b');
    expect(barisTerakhir('')).toBe('');
  });

  it('Xvfb gagal/berhenti/terlambat: galat dan proses dibunuh', async () => {
    for (const ulah of ['exit', 'error', 'diam'] as const) {
      const { child } = fakeChild();
      const p = ensureDisplay({}, false, {
        platform: 'linux',
        xauth: () => {},
        timeoutMs: 30,
        spawn: () => {
          setTimeout(() => {
            if (ulah === 'exit') child.emit('exit', 1);
            if (ulah === 'error') child.emit('error', new Error('ENOENT'));
          }, 5);
          return child as unknown as ChildProcess;
        },
      });
      await expect(p).rejects.toThrow();
      expect(child.killed).toEqual(['SIGKILL']);
    }
  });
});
