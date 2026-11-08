import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEgress, egressFetch, sharedEgress, type Resolver } from './egress.js';
import { EgressBlockedError, LLM_PROXY } from './policy.js';

/** Error asli di balik `TypeError: fetch failed` (atau error itu sendiri). */
const rootCause = async (p: Promise<unknown>): Promise<unknown> => {
  try {
    await p;
  } catch (e) {
    let err = e as { cause?: unknown };
    while (err && !(err instanceof EgressBlockedError) && err.cause) err = err.cause as { cause?: unknown };
    return err;
  }
  throw new Error('permintaan seharusnya ditolak');
};

const listen = (handler: Parameters<typeof createServer>[1], port = 0) =>
  new Promise<Server>((ok, fail) => {
    const s = createServer(handler);
    s.once('error', fail);
    s.listen(port, '127.0.0.1', () => ok(s));
  });
const close = (s: Server | undefined) => new Promise<void>((ok) => (s ? s.close(() => ok()) : ok()));

// "Canary" pada port loopback acak: egress tidak boleh pernah menyentuhnya.
let canary: Server;
let canaryPort: number;
let canaryHits = 0;
// Server di 127.0.0.1:20128 meniru proxy LLM. Bila port sudah dipakai (mis. proxy asli di mesin ini),
// tes jalur yang diizinkan hanya memastikan egress tidak memblokir.
let proxy: Server | undefined;
const PROXY = `http://${LLM_PROXY.host}:${LLM_PROXY.port}`;

beforeAll(async () => {
  canary = await listen((_req, res) => {
    canaryHits++;
    res.end('canary');
  });
  canaryPort = (canary.address() as AddressInfo).port;
  proxy = await listen((req, res) => {
    if (req.url === '/ke-canary') {
      res.writeHead(302, { location: `http://127.0.0.1:${canaryPort}/load` });
      return res.end();
    }
    if (req.url === '/ke-metadata') {
      res.writeHead(307, { location: 'http://169.254.169.254/latest/meta-data/' });
      return res.end();
    }
    if (req.url === '/lompat') {
      res.writeHead(302, { location: '/v1/models' });
      return res.end();
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ path: req.url, method: req.method }));
  }, LLM_PROXY.port).catch(() => undefined);
});

afterAll(async () => {
  await close(canary);
  await close(proxy);
  await sharedEgress().agent.close();
});

describe('egress: tujuan lokal/privat tidak terjangkau', () => {
  const egress = createEgress({ env: {} });
  afterAll(() => egress.agent.close());

  it.each([
    'http://127.0.0.1:2019/load', // admin API Caddy
    'http://127.0.0.1:4320/', // fixtures
    'http://127.0.0.1:22/', // ssh
    'http://127.0.0.1:4310/api/health', // web sendiri
    'http://169.254.169.254/latest/meta-data/', // metadata cloud
    'http://10.0.0.1/',
    'http://100.100.100.100/', // CGNAT / tailscale
    'http://[::1]:20128/',
  ])('fetch %s ditolak', async (url) => {
    expect(await rootCause(egress.fetch(url))).toBeInstanceOf(EgressBlockedError);
  });

  it('dispatcher sendiri menolak di tingkat koneksi (tanpa pemeriksaan URL fetch)', async () => {
    for (const origin of [
      'http://127.0.0.1:2019',
      'http://127.0.0.1:4320',
      'http://127.0.0.1:22',
      `http://127.0.0.1:${canaryPort}`,
      'http://169.254.169.254',
      'http://10.1.2.3',
    ])
      await expect(egress.agent.request({ origin, path: '/', method: 'GET' })).rejects.toBeInstanceOf(
        EgressBlockedError,
      );
    expect(canaryHits).toBe(0);
  });

  it('nama DNS yang resolve ke 127.0.0.1 ditolak saat tersambung', async () => {
    const resolve: Resolver = async () => [{ address: '127.0.0.1', family: 4 }];
    const e = createEgress({ env: {}, resolve });
    const i = createEgress({ profile: 'ingest', env: {}, resolve });
    expect(await rootCause(i.fetch('https://jebakan.go.id/'))).toMatchObject({
      message: expect.stringMatching(/resolve ke alamat lokal\/privat 127\.0\.0\.1/),
    });
    expect(await rootCause(e.fetch('https://api.jina.ai/v1/rerank'))).toMatchObject({
      message: expect.stringMatching(/127\.0\.0\.1/),
    });
    await Promise.all([e.agent.close(), i.agent.close()]);
  });

  it('host dengan campuran alamat publik + privat ditolak seluruhnya', async () => {
    const resolve: Resolver = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '::1', family: 6 },
    ];
    const e = createEgress({ env: {}, resolve });
    await expect(
      e.agent.request({ origin: 'https://api.jina.ai', path: '/', method: 'GET' }),
    ).rejects.toBeInstanceOf(EgressBlockedError);
    await e.agent.close();
  });

  it('DNS kosong atau gagal tidak tersambung', async () => {
    const kosong = createEgress({ env: {}, resolve: async () => [] });
    expect(await rootCause(kosong.fetch('https://api.jina.ai/'))).toBeInstanceOf(EgressBlockedError);
    const gagal = createEgress({ env: {}, resolve: async () => Promise.reject(new Error('ENOTFOUND')) });
    await expect(
      gagal.agent.request({ origin: 'https://api.jina.ai', path: '/', method: 'GET' }),
    ).rejects.toThrow('ENOTFOUND');
    await Promise.all([kosong.agent.close(), gagal.agent.close()]);
  });

  it('objek Request ditolak (URL harus eksplisit)', async () => {
    await expect(egress.fetch(new Request('https://api.jina.ai/'))).rejects.toBeInstanceOf(
      EgressBlockedError,
    );
  });
});

describe('egress: proxy LLM 127.0.0.1:20128 diizinkan bila LLM_BASE_URL menunjuknya', () => {
  const egress = createEgress({ env: { LLM_BASE_URL: `${PROXY}/v1` } });
  const tanpaProxy = createEgress({ env: { LLM_BASE_URL: 'https://llm.contoh.dev/v1' } });
  afterAll(() => tanpaProxy.agent.close());

  it('LLM_BASE_URL lain: 127.0.0.1:20128 diblokir di fetch dan di koneksi (M1)', async () => {
    expect(await rootCause(tanpaProxy.fetch(`${PROXY}/api/keys`))).toBeInstanceOf(EgressBlockedError);
    await expect(
      tanpaProxy.agent.request({ origin: PROXY, path: '/api/keys', method: 'GET' }),
    ).rejects.toBeInstanceOf(EgressBlockedError);
  });
  afterAll(() => egress.agent.close());

  it('GET ke proxy LLM tidak diblokir', async () => {
    const p = egress.fetch(`${PROXY}/v1/models`);
    if (proxy) {
      const res = await p;
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ path: '/v1/models', method: 'GET' });
    } else {
      const err = await p.then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(err).not.toBeInstanceOf(EgressBlockedError);
    }
  });

  it('redirect ke port loopback lain atau metadata ditolak per hop; canary tidak tersentuh', async () => {
    if (!proxy) return;
    expect(await rootCause(egress.fetch(`${PROXY}/ke-canary`))).toBeInstanceOf(EgressBlockedError);
    expect(await rootCause(egress.fetch(`${PROXY}/ke-metadata`))).toBeInstanceOf(EgressBlockedError);
    expect(canaryHits).toBe(0);
  });

  it('redirect same-origin diikuti; mode manual mengembalikan 3xx apa adanya', async () => {
    if (!proxy) return;
    expect(await (await egress.fetch(`${PROXY}/lompat`)).json()).toEqual({
      path: '/v1/models',
      method: 'GET',
    });
    const manual = await egress.fetch(`${PROXY}/lompat`, { redirect: 'manual' });
    expect(manual.status).toBe(302);
  });

  it('egressFetch bersama memakai env proses dan tetap memblokir loopback', async () => {
    expect(await rootCause(egressFetch('http://127.0.0.1:2019/load'))).toBeInstanceOf(EgressBlockedError);
  });
});

describe('egress: logika redirect', () => {
  type Call = { url: string; method: string; body: unknown; headers: Headers };
  const scripted = (responses: Response[]) => {
    const calls: Call[] = [];
    const e = createEgress({
      env: { LLM_BASE_URL: 'http://127.0.0.1:20128/v1' },
      transport: async (url, init) => {
        calls.push({
          url: url.href,
          method: String(init.method),
          body: init.body,
          headers: new Headers(init.headers),
        });
        expect(init.redirect).toBe('manual');
        return responses.shift() ?? new Response('akhir');
      },
    });
    return { e, calls };
  };
  const redirect = (status: number, location: string) =>
    new Response(null, { status, headers: { location } });

  it('303 dan 302-POST menjadi GET tanpa body; 307 mempertahankan metode dan body', async () => {
    const { e, calls } = scripted([
      redirect(303, 'https://api.jina.ai/a'),
      redirect(307, 'https://api.jina.ai/b'),
      redirect(302, 'https://api.jina.ai/c'),
    ]);
    await e.fetch('https://api.jina.ai/', {
      method: 'POST',
      body: 'x',
      headers: { 'content-type': 'text/plain' },
    });
    expect(calls.map((c) => [c.method, c.body])).toEqual([
      ['POST', 'x'],
      ['GET', null],
      ['GET', null],
      ['GET', null],
    ]);
    expect(calls[1]!.headers.has('content-type')).toBe(false);

    const kedua = scripted([redirect(307, '/lagi')]);
    await kedua.e.fetch('https://api.jina.ai/', { method: 'PUT', body: 'y' });
    expect(kedua.calls.map((c) => [c.url, c.method, c.body])).toEqual([
      ['https://api.jina.ai/', 'PUT', 'y'],
      ['https://api.jina.ai/lagi', 'PUT', 'y'],
    ]);
  });

  it('kredensial dibuang saat redirect lintas origin, dipertahankan bila same-origin', async () => {
    const { e, calls } = scripted([redirect(302, '/sama'), redirect(302, 'https://r.jina.ai/lain')]);
    await e.fetch('https://api.jina.ai/', { headers: { authorization: 'Bearer k', cookie: 'a=b' } });
    expect(calls[1]!.headers.get('authorization')).toBe('Bearer k');
    expect(calls[2]!.headers.has('authorization')).toBe(false);
    expect(calls[2]!.headers.has('cookie')).toBe(false);
  });

  it('redirect dari host lain ke proxy LLM lokal ditolak; dari proxy ke proxy diikuti (M1)', async () => {
    const { e, calls } = scripted([redirect(302, 'http://127.0.0.1:20128/api/keys')]);
    await expect(e.fetch('https://api.jina.ai/v1/rerank')).rejects.toThrow(/proxy LLM lokal/);
    expect(calls).toHaveLength(1);
    const sama = scripted([redirect(302, '/v1/models')]);
    expect(await (await sama.e.fetch('http://127.0.0.1:20128/v1/x')).text()).toBe('akhir');
    expect(sama.calls.map((c) => c.url)).toEqual([
      'http://127.0.0.1:20128/v1/x',
      'http://127.0.0.1:20128/v1/models',
    ]);
  });

  it('redirect ke host di luar allowlist ditolak sebelum hop berikutnya dikirim', async () => {
    const { e, calls } = scripted([redirect(301, 'http://127.0.0.1:2019/load')]);
    await expect(e.fetch('https://api.jina.ai/')).rejects.toBeInstanceOf(EgressBlockedError);
    expect(calls).toHaveLength(1);
  });

  it('batas jumlah redirect, mode error, body stream, dan 3xx tanpa Location', async () => {
    const loop = scripted(Array.from({ length: 10 }, () => redirect(302, '/x')));
    await expect(loop.e.fetch('https://api.jina.ai/')).rejects.toThrow(/lebih dari 5 redirect/);

    const err = scripted([redirect(302, '/x')]);
    await expect(err.e.fetch('https://api.jina.ai/', { redirect: 'error' })).rejects.toThrow(TypeError);

    const stream = scripted([redirect(307, '/x')]);
    const body = new ReadableStream({ start: (c) => c.close() });
    await expect(
      stream.e.fetch('https://api.jina.ai/', { method: 'POST', body, duplex: 'half' } as RequestInit),
    ).rejects.toThrow(/body stream/);

    const tanpaLokasi = scripted([new Response(null, { status: 302 })]);
    expect((await tanpaLokasi.e.fetch('https://api.jina.ai/')).status).toBe(302);
  });
});
