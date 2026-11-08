import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getGlobalDispatcher } from 'undici';
import { installEgressBackstop, sharedEgress, sharedIngestEgress } from './egress.js';
import { EgressBlockedError } from './policy.js';

let canary: Server;
let port = 0;
let hits = 0;

beforeAll(async () => {
  canary = createServer((_req, res) => {
    hits++;
    res.end('canary');
  });
  await new Promise<void>((ok) => canary.listen(0, '127.0.0.1', ok));
  port = (canary.address() as AddressInfo).port;
});
afterAll(async () => {
  await new Promise<void>((ok) => canary.close(() => ok()));
  await Promise.all([sharedEgress().agent.close(), sharedIngestEgress().agent.close()]);
});

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

describe('backstop: dispatcher global undici = Agent egress (M2)', () => {
  it('sebelum boot, fetch global biasa menjangkau loopback (inilah yang ditutup backstop)', async () => {
    expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toBe('canary');
    hits = 0;
  });

  it('setelah installEgressBackstop, fetch global ke 127.0.0.1:2019 dan port loopback lain diblokir', async () => {
    const e = installEgressBackstop();
    expect(getGlobalDispatcher()).toBe(e.agent);
    expect(await causeOf(fetch('http://127.0.0.1:2019/load', { method: 'POST', body: '{}' }))).toBeInstanceOf(
      EgressBlockedError,
    );
    expect(await causeOf(fetch(`http://127.0.0.1:${port}/`))).toBeInstanceOf(EgressBlockedError);
    expect(await causeOf(fetch('http://169.254.169.254/latest/meta-data/'))).toBeInstanceOf(
      EgressBlockedError,
    );
    expect(hits).toBe(0);
  });

  it('profil ingest dapat dipasang sebagai backstop CLI', () => {
    expect(installEgressBackstop('ingest')).toBe(sharedIngestEgress());
    expect(getGlobalDispatcher()).toBe(sharedIngestEgress().agent);
  });
});
