import { describe, expect, it } from 'vitest';
import {
  getExtensionRuntime,
  pairAndPing,
  parseNonceFromHash,
  type ExtensionRuntime,
} from './extension-bridge';

const NONCE = 'a'.repeat(64);

describe('parseNonceFromHash', () => {
  it('membaca nonce 64 hex dari fragment', () => {
    expect(parseNonceFromHash(`#nonce=${NONCE}`)).toBe(NONCE);
  });
  it.each(['', '#', '#nonce=', '#nonce=xyz', `#nonce=${'A'.repeat(64)}`, `#x=${NONCE}`, `#nonce=${NONCE}0`])(
    'menolak %j',
    (hash) => {
      expect(parseNonceFromHash(hash)).toBeNull();
    },
  );
});

describe('getExtensionRuntime', () => {
  it('null bila tidak ada chrome.runtime.sendMessage', () => {
    expect(getExtensionRuntime({})).toBeNull();
    expect(getExtensionRuntime({ chrome: {} })).toBeNull();
    expect(
      getExtensionRuntime({ chrome: { runtime: { sendMessage: () => Promise.resolve() } } }),
    ).not.toBeNull();
  });
});

describe('pairAndPing', () => {
  const fake = (replies: Record<string, unknown>): ExtensionRuntime & { sent: unknown[] } => {
    const sent: unknown[] = [];
    return {
      sent,
      async sendMessage(_id, msg) {
        sent.push(msg);
        return replies[(msg as { type: string }).type];
      },
    };
  };

  it('pair lalu ping; mengembalikan origin dari pong', async () => {
    const rt = fake({
      pair: { ok: true, origin: 'x' },
      ping: { ok: true, type: 'pong', origin: 'http://localhost:3000' },
    });
    expect(await pairAndPing(rt, 'ext', NONCE)).toEqual({ ok: true, origin: 'http://localhost:3000' });
    expect(rt.sent).toEqual([
      { type: 'pair', nonce: NONCE },
      { type: 'ping', nonce: NONCE },
    ]);
  });

  it('ekstensi tidak ada, pair ditolak, ping gagal, sendMessage melempar', async () => {
    expect(await pairAndPing(null, 'ext', NONCE)).toEqual({ ok: false, code: 'EXTENSION_NOT_FOUND' });
    expect(await pairAndPing(fake({ pair: { ok: false, code: 'NONCE_MISMATCH' } }), 'ext', NONCE)).toEqual({
      ok: false,
      code: 'NONCE_MISMATCH',
    });
    expect(
      await pairAndPing(fake({ pair: { ok: true }, ping: { ok: false, code: 'NOT_PAIRED' } }), 'ext', NONCE),
    ).toEqual({
      ok: false,
      code: 'NOT_PAIRED',
    });
    const throwing: ExtensionRuntime = {
      sendMessage: () => Promise.reject(new Error('Could not establish connection')),
    };
    expect(await pairAndPing(throwing, 'ext', NONCE)).toEqual({ ok: false, code: 'EXTENSION_UNREACHABLE' });
  });
});
