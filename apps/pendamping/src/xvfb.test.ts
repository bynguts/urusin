import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { ensureDisplay } from './xvfb.js';

function fakeChild() {
  const fd3 = new PassThrough();
  const child = Object.assign(new EventEmitter(), {
    stdio: [null, null, null, fd3],
    killed: [] as string[],
    kill(sig: string) {
      child.killed.push(sig);
      return true;
    },
  });
  return { child, fd3 };
}

describe('ensureDisplay (Xvfb)', () => {
  it('tidak melakukan apa-apa: headless, bukan Linux, atau DISPLAY sudah ada', async () => {
    expect(await ensureDisplay({}, true, { platform: 'linux' })).toBeUndefined();
    expect(await ensureDisplay({}, false, { platform: 'win32' })).toBeUndefined();
    expect(await ensureDisplay({ DISPLAY: ':0' }, false, { platform: 'linux' })).toBeUndefined();
  });

  it('Linux headed: display bebas, cookie X acak, tanpa TCP; DISPLAY/XAUTHORITY diset; stop membersihkan', async () => {
    const { child, fd3 } = fakeChild();
    const calls: { xauth?: string[]; xvfb?: string[] } = {};
    const env: Record<string, string | undefined> = {};
    const p = ensureDisplay(env, false, {
      platform: 'linux',
      exists: (f) => f === '/tmp/.X99-lock',
      xauth: (a) => void (calls.xauth = a),
      spawn: (_cmd, args) => {
        calls.xvfb = args;
        setTimeout(() => fd3.write('100\n'), 5);
        return child as unknown as ChildProcess;
      },
    });
    const x = await p;
    expect(x?.display).toBe(':100');
    expect(env).toMatchObject({ DISPLAY: ':100', XAUTHORITY: x?.xauthority });
    expect(calls.xauth?.slice(3, 5)).toEqual(['add', ':100']);
    expect(calls.xauth?.[6]).toMatch(/^[0-9a-f]{32}$/);
    expect(calls.xvfb).toEqual(
      expect.arrayContaining([':100', '-auth', '-nolisten', 'tcp', '-displayfd', '3']),
    );
    x?.stop();
    expect(child.killed).toEqual(['SIGTERM']);
    expect(existsSync(x!.xauthority)).toBe(false);
  });

  it('Xvfb gagal/berhenti/terlambat: galat dan proses dibunuh', async () => {
    for (const ulah of ['exit', 'error', 'diam'] as const) {
      const { child } = fakeChild();
      const p = ensureDisplay({}, false, {
        platform: 'linux',
        exists: () => false,
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
