import http from 'node:http';
import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createEgressPolicy,
  egressRules,
  isBlockedAddress,
  startEgressProxy,
  type EgressProxy,
} from './egress.js';

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1',
    '127.9.9.9',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fe80::1',
    'fd00::1',
    '::ffff:127.0.0.1',
    '::ffff:169.254.169.254',
    '64:ff9b::a9fe:a9fe',
    'bukan-ip',
  ])('memblokir %s', (a) => expect(isBlockedAddress(a)).toBe(true));
  it.each(['103.10.20.30', '8.8.8.8', '2606:4700::1111', '::ffff:8.8.8.8'])('mengizinkan %s', (a) =>
    expect(isBlockedAddress(a)).toBe(false),
  );
});

describe('kebijakan egress', () => {
  const resolver = async (host: string) =>
    ({
      'resmi.go.id': ['103.10.20.30'],
      'rebind.go.id': ['103.10.20.30', '127.0.0.1'],
      'meta.go.id': ['169.254.169.254'],
      'kosong.go.id': [],
    })[host] ?? Promise.reject(new Error('NXDOMAIN'));
  const decide = createEgressPolicy(
    egressRules(
      ['resmi.go.id', 'rebind.go.id', 'meta.go.id', 'kosong.go.id', 'hilang.go.id'],
      ['http://127.0.0.1:4320'],
    ),
    resolver,
  );

  it('host:port persis; selain :443 ditolak', async () => {
    expect(await decide('RESMI.go.id.', 443)).toEqual({ ok: true, address: '103.10.20.30', local: false });
    expect(await decide('resmi.go.id', 80)).toMatchObject({ ok: false, reason: 'host_tidak_diizinkan' });
    expect(await decide('sub.resmi.go.id', 443)).toMatchObject({ ok: false });
  });

  it('DNS rebinding / metadata / DNS gagal ditolak setelah resolusi', async () => {
    expect(await decide('rebind.go.id', 443)).toMatchObject({ ok: false, reason: 'alamat_privat' });
    expect(await decide('meta.go.id', 443)).toMatchObject({ ok: false, reason: 'alamat_privat' });
    expect(await decide('kosong.go.id', 443)).toMatchObject({ ok: false, reason: 'dns_kosong' });
    expect(await decide('hilang.go.id', 443)).toMatchObject({ ok: false, reason: 'dns_gagal' });
  });

  it('fixture lokal hanya pada port persisnya; IP literal lain ditolak', async () => {
    expect(await decide('127.0.0.1', 4320)).toEqual({ ok: true, address: '127.0.0.1', local: true });
    expect(await decide('127.0.0.1', 2019)).toMatchObject({ ok: false });
    expect(await decide('169.254.169.254', 80)).toMatchObject({ ok: false });
    expect(await decide('[::1]', 4320)).toMatchObject({ ok: false });
  });

  it('origin fixture publik https tidak boleh ke alamat privat', () => {
    expect(egressRules([], ['https://fixtures.contoh.id', 'http://localhost:4320'])).toEqual([
      { host: 'fixtures.contoh.id', port: 443, allowPrivate: false },
      { host: 'localhost', port: 4320, allowPrivate: true },
    ]);
  });
});

describe('proxy egress (soket nyata)', () => {
  let upstream: http.Server;
  let canary: http.Server;
  let upPort = 0;
  let canaryPort = 0;
  let canaryHits = 0;
  let proxy: EgressProxy;
  const blocked: string[] = [];

  beforeAll(async () => {
    upstream = http.createServer((req, res) => res.end(`ok ${req.headers.host} ${req.url}`));
    canary = http.createServer((_req, res) => {
      canaryHits++;
      res.end('bocor');
    });
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
    await new Promise<void>((r) => canary.listen(0, '127.0.0.1', r));
    upPort = (upstream.address() as net.AddressInfo).port;
    canaryPort = (canary.address() as net.AddressInfo).port;
    proxy = await startEgressProxy(egressRules([], [`http://127.0.0.1:${upPort}`]));
    proxy.onBlocked((h) => blocked.push(h));
  });
  afterAll(async () => {
    await proxy.close();
    upstream.close();
    canary.close();
  });

  const viaProxy = (target: string) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: proxy.port,
          method: 'GET',
          path: target,
          headers: { 'proxy-connection': 'x' },
        },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        },
      );
      req.on('error', reject);
      req.end();
    });

  const connect = (authority: string) =>
    new Promise<string>((resolve, reject) => {
      const s = net.connect(proxy.port, '127.0.0.1', () =>
        s.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`),
      );
      s.once('data', (d) => {
        resolve(d.toString().split('\r\n')[0] ?? '');
        s.destroy();
      });
      s.on('error', reject);
    });

  it('HTTP absolute-form ke fixture diteruskan dengan Host asli', async () => {
    const r = await viaProxy(`http://127.0.0.1:${upPort}/a?b=1`);
    expect(r).toEqual({ status: 200, body: `ok 127.0.0.1:${upPort} /a?b=1` });
  });

  it('SSRF: loopback lain, metadata, dan port Caddy admin ditolak; canary tidak pernah tersentuh', async () => {
    for (const t of [
      `http://127.0.0.1:${canaryPort}/`,
      'http://127.0.0.1:2019/config/',
      'http://169.254.169.254/latest/meta-data/',
      `http://localhost:${canaryPort}/`,
    ]) {
      expect((await viaProxy(t)).status, t).toBe(403);
    }
    expect(await connect(`127.0.0.1:${canaryPort}`)).toContain('403');
    expect(await connect('169.254.169.254:443')).toContain('403');
    expect(await connect('rusak')).toContain('403');
    expect(canaryHits).toBe(0);
    expect(blocked).toContain('169.254.169.254');
    expect(blocked.join(' ')).not.toContain('meta-data');
  });

  it('CONNECT ke tujuan yang diizinkan membuka terowongan', async () => {
    expect(await connect(`127.0.0.1:${upPort}`)).toContain('200');
  });

  it('permintaan non-absolute / skema lain ditolak 400', async () => {
    expect((await viaProxy('/relatif')).status).toBe(400);
    expect((await viaProxy('ftp://127.0.0.1/x')).status).toBe(400);
  });
});

describe('proxy hulu operator (PENDAMPING_UPSTREAM_PROXY)', () => {
  const seen: { connect: string[]; http: string[]; auth: (string | undefined)[] } = {
    connect: [],
    http: [],
    auth: [],
  };
  let hulu: http.Server;
  let lokal: http.Server;
  let proxy: EgressProxy;
  let tolak = false;
  const resolve = async (h: string) => (h === 'resmi.go.id' ? ['103.10.20.30'] : ['10.0.0.9']);

  beforeAll(async () => {
    hulu = http.createServer((req, res) => {
      seen.http.push(req.url ?? '');
      seen.auth.push(req.headers['proxy-authorization']);
      res.end('dari hulu');
    });
    hulu.on('connect', (req, sock: net.Socket) => {
      seen.connect.push(req.url ?? '');
      seen.auth.push(req.headers['proxy-authorization']);
      if (tolak) return sock.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');
      sock.write('HTTP/1.1 200 OK\r\n\r\n');
      sock.on('data', (d) => sock.write(`gema:${d.toString()}`));
    });
    lokal = http.createServer((_req, res) => res.end('lokal'));
    await new Promise<void>((r) => hulu.listen(0, '127.0.0.1', r));
    await new Promise<void>((r) => lokal.listen(0, '127.0.0.1', r));
    const huluPort = (hulu.address() as net.AddressInfo).port;
    const lokalPort = (lokal.address() as net.AddressInfo).port;
    proxy = await startEgressProxy(
      [
        { host: 'resmi.go.id', port: 443 },
        { host: 'resmi.go.id', port: 80 },
        { host: 'privat.go.id', port: 443 },
        { host: '127.0.0.1', port: lokalPort, allowPrivate: true },
      ],
      { resolve, upstream: new URL(`http://op%40x:rah%3Asia@127.0.0.1:${huluPort}`) },
    );
  });
  afterAll(async () => {
    await proxy.close();
    hulu.close();
    lokal.close();
  });

  const tunnel = (authority: string, kirim?: string) =>
    new Promise<string>((resolve, reject) => {
      const s = net.connect(proxy.port, '127.0.0.1', () =>
        s.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`),
      );
      let out = '';
      s.on('data', (d) => {
        out += d.toString();
        if (out.includes('\r\n\r\n') && kirim && !out.includes('gema:')) s.write(kirim);
        if (!kirim || out.includes('gema:')) {
          resolve(out);
          s.destroy();
        }
      });
      s.on('error', reject);
    });

  const get = (target: string) =>
    new Promise<string>((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port: proxy.port, path: target }, (res) => {
          let b = '';
          res.on('data', (c) => (b += c));
          res.on('end', () => resolve(`${res.statusCode} ${b}`));
        })
        .on('error', reject);
    });

  it('CONNECT yang lolos kebijakan diteruskan ke hulu dengan nama host + Proxy-Authorization', async () => {
    const out = await tunnel('resmi.go.id:443', 'halo');
    expect(out).toContain('200 Connection Established');
    expect(out).toContain('gema:halo');
    expect(seen.connect).toEqual(['resmi.go.id:443']);
    expect(seen.auth[0]).toBe(`Basic ${Buffer.from('op@x:rah:sia').toString('base64')}`);
  });

  it('HTTP absolute-form lewat hulu; fixture lokal tetap langsung (tidak lewat hulu)', async () => {
    expect(await get('http://resmi.go.id/x?y=1')).toBe('200 dari hulu');
    expect(seen.http).toEqual(['http://resmi.go.id/x?y=1']);
    const lokalPort = (lokal.address() as net.AddressInfo).port;
    expect(await get(`http://127.0.0.1:${lokalPort}/`)).toBe('200 lokal');
    expect(seen.http).toHaveLength(1);
  });

  it('kebijakan tetap sebelum hulu: privat/asing tidak pernah sampai ke hulu; hulu menolak -> 502', async () => {
    const sebelum = seen.connect.length;
    expect(await tunnel('privat.go.id:443')).toContain('403');
    expect(await tunnel('evil.example:443')).toContain('403');
    expect(seen.connect).toHaveLength(sebelum);
    tolak = true;
    expect(await tunnel('resmi.go.id:443')).toContain('502');
    tolak = false;
  });
});
