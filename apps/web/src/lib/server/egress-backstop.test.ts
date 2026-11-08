import { afterAll, describe, expect, it } from 'vitest';
import { EgressBlockedError, sharedEgress } from '@urusin/egress';

/** Error asli di balik `TypeError: fetch failed`. */
const causeOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    let c = e as { cause?: unknown };
    while (c && !(c instanceof EgressBlockedError) && c.cause) c = c.cause as { cause?: unknown };
    return c;
  }
  return undefined;
};

describe('backstop egress setelah boot (hooks.server.ts)', () => {
  afterAll(() => sharedEgress().agent.close());

  // Batas eksplisit: tes paling lambat di berkas ini (~1-2 dtk sendirian dan di turbo paralel penuh).
  it('fetch global biasa ke admin Caddy 127.0.0.1:2019 dan metadata cloud diblokir', async () => {
    await import('../../hooks.server');
    expect(await causeOf(fetch('http://127.0.0.1:2019/load', { method: 'POST', body: '{}' }))).toBeInstanceOf(
      EgressBlockedError,
    );
    expect(await causeOf(fetch('http://127.0.0.1:4320/'))).toBeInstanceOf(EgressBlockedError);
    expect(await causeOf(fetch('http://169.254.169.254/latest/meta-data/'))).toBeInstanceOf(
      EgressBlockedError,
    );
  }, 20_000);
});
