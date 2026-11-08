import { describe, expect, it } from 'vitest';
import {
  authorize,
  completePairing,
  getPaired,
  PAIR_TTL_MS,
  randomNonce,
  startPairing,
  unpair,
  type KV,
} from './pairing';
import { parseWebMessage } from './protocol';

function memoryKV(): KV {
  const data = new Map<string, unknown>();
  return {
    get: async <T>(k: string) => data.get(k) as T | undefined,
    set: async (k, v) => void data.set(k, v),
    remove: async (k) => void data.delete(k),
  };
}

const APP = 'http://localhost:3000';
const ALLOWED = [APP];

describe('pairing', () => {
  it('nonce acak 64 hex', () => {
    expect(randomNonce()).toMatch(/^[0-9a-f]{64}$/);
    expect(randomNonce()).not.toBe(randomNonce());
  });

  it('alur normal: start -> pair -> ping terotorisasi', async () => {
    const kv = memoryKV();
    const nonce = await startPairing(kv, 1000);
    expect(await completePairing(kv, APP, ALLOWED, nonce, 2000)).toEqual({ ok: true, origin: APP });
    expect(await authorize(kv, APP, nonce)).toMatchObject({ ok: true });
    expect((await getPaired(kv))?.origin).toBe(APP);
  });

  it('nonce sekali pakai: pair kedua dengan nonce sama gagal', async () => {
    const kv = memoryKV();
    const nonce = await startPairing(kv, 0);
    await completePairing(kv, APP, ALLOWED, nonce, 1);
    expect(await completePairing(kv, APP, ALLOWED, nonce, 2)).toMatchObject({
      ok: false,
      code: 'PAIR_NOT_STARTED',
    });
  });

  it('nonce salah menghanguskan pairing yang sedang berjalan', async () => {
    const kv = memoryKV();
    const nonce = await startPairing(kv, 0);
    expect(await completePairing(kv, APP, ALLOWED, 'salah', 1)).toMatchObject({ code: 'NONCE_MISMATCH' });
    expect(await completePairing(kv, APP, ALLOWED, nonce, 2)).toMatchObject({ code: 'PAIR_NOT_STARTED' });
  });

  it('kedaluwarsa', async () => {
    const kv = memoryKV();
    const nonce = await startPairing(kv, 0);
    expect(await completePairing(kv, APP, ALLOWED, nonce, PAIR_TTL_MS + 1)).toMatchObject({
      code: 'PAIR_EXPIRED',
    });
  });

  it('origin pengirim di luar daftar atau kosong ditolak, nonce tidak terpakai', async () => {
    const kv = memoryKV();
    const nonce = await startPairing(kv, 0);
    expect(await completePairing(kv, 'https://evil.example', ALLOWED, nonce, 1)).toMatchObject({
      code: 'ORIGIN_NOT_ALLOWED',
    });
    expect(await completePairing(kv, undefined, ALLOWED, nonce, 1)).toMatchObject({
      code: 'ORIGIN_NOT_ALLOWED',
    });
    expect(await completePairing(kv, APP, ALLOWED, nonce, 1)).toMatchObject({ ok: true });
  });

  it('tanpa pairing dimulai dari popup', async () => {
    expect(await completePairing(memoryKV(), APP, ALLOWED, 'x', 0)).toMatchObject({
      code: 'PAIR_NOT_STARTED',
    });
  });

  it('authorize: belum pairing, origin lain, nonce salah', async () => {
    const kv = memoryKV();
    expect(await authorize(kv, APP, 'x')).toMatchObject({ code: 'NOT_PAIRED' });
    const nonce = await startPairing(kv, 0);
    await completePairing(kv, APP, ALLOWED, nonce, 1);
    expect(await authorize(kv, 'https://evil.example', nonce)).toMatchObject({ code: 'ORIGIN_NOT_PAIRED' });
    expect(await authorize(kv, undefined, nonce)).toMatchObject({ code: 'ORIGIN_NOT_PAIRED' });
    expect(await authorize(kv, APP, 'salah')).toMatchObject({ code: 'NONCE_MISMATCH' });
  });

  it('unpair menghapus pairing', async () => {
    const kv = memoryKV();
    const nonce = await startPairing(kv, 0);
    await completePairing(kv, APP, ALLOWED, nonce, 1);
    await unpair(kv);
    expect(await authorize(kv, APP, nonce)).toMatchObject({ code: 'NOT_PAIRED' });
  });
});

describe('parseWebMessage', () => {
  it('menerima bentuk valid dan menolak sisanya', () => {
    expect(parseWebMessage({ type: 'ping', nonce: 'n' })).toEqual({ type: 'ping', nonce: 'n' });
    expect(
      parseWebMessage({ type: 'execute', nonce: 'n', request: { executionId: 'e', origin: 'o', steps: [] } }),
    ).toMatchObject({
      type: 'execute',
    });
    for (const bad of [
      null,
      'x',
      {},
      { type: 'ping' },
      { type: 'zzz', nonce: 'n' },
      { type: 'execute', nonce: 'n', request: {} },
    ]) {
      expect(parseWebMessage(bad)).toBeNull();
    }
  });
});
