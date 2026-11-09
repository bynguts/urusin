import http from 'node:http';
import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import {
  createDaftarSesi,
  createEdgeBalik,
  createEdgeKontrol,
  createEdgeProxy,
  jalurDiizinkan,
  loadEdgeConfig,
  pilihAntarmuka,
} from './edge.js';
import { headerTanda } from './tanda.js';

const TOKEN = 'e'.repeat(40);
const HOST = 'telunjuksakti.wonogirikab.go.id';
const SANDI = 'a1'.repeat(24);
const cfg = loadEdgeConfig({ PENDAMPING_EDGE_TOKEN: TOKEN });

const servers: { close(): void }[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

async function dengar(s: http.Server): Promise<number> {
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  return (s.address() as net.AddressInfo).port;
}

/** Kirim CONNECT mentah dan kembalikan baris status + header jawaban. */
function connect(port: number, target: string, auth?: string): Promise<string> {
  return new Promise((ok, gagal) => {
    const s = net.connect(port, '127.0.0.1', () => {
      s.write(
        `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${auth ? `Proxy-Authorization: Basic ${Buffer.from(auth).toString('base64')}\r\n` : ''}\r\n`,
      );
    });
    let buf = '';
    s.on('data', (d) => {
      buf += d.toString('latin1');
      if (buf.includes('\r\n\r\n')) {
        s.destroy();
        ok(buf);
      }
    });
    s.on('error', gagal);
  });
}

describe('konfigurasi edge', () => {
  it('token wajib; fixture hanya https:443 dan ikut union; debug hanya bila token debug sah', () => {
    expect(() => loadEdgeConfig({})).toThrow(/EDGE_TOKEN/);
    expect(() => loadEdgeConfig({ PENDAMPING_EDGE_TOKEN: TOKEN, EDGE_PENDAMPING_URL: 'http://p' })).toThrow(
      /EDGE_PENDAMPING_URL/,
    );
    for (const o of ['http://fixtures.urusin.test', 'https://fixtures.urusin.test:8443', 'https://127.0.0.1'])
      expect(() => loadEdgeConfig({ PENDAMPING_EDGE_TOKEN: TOKEN, PENDAMPING_FIXTURE_ORIGINS: o })).toThrow(
        /fixture/,
      );
    const c = loadEdgeConfig({
      PENDAMPING_EDGE_TOKEN: TOKEN,
      PENDAMPING_FIXTURE_ORIGINS: 'https://fixtures.urusin.test',
      PENDAMPING_DEBUG_TOKEN: 'd'.repeat(32),
    });
    expect(c.union.has('fixtures.urusin.test')).toBe(true);
    expect(c.union.has(HOST)).toBe(true);
    expect(c.debug).toBe(true);
    expect(cfg.debug).toBe(false);
    expect(cfg.hulu.href).toBe('http://pendamping:4330/');
    expect(() =>
      loadEdgeConfig({ PENDAMPING_EDGE_TOKEN: TOKEN, PENDAMPING_UPSTREAM_PROXY: 'socks5://x:1' }),
    ).toThrow(/UPSTREAM/);
  });

  it('antarmuka: internal = subnet yang memuat pendamping, publik = sisanya; ambigu ditolak', () => {
    const iface = (address: string, cidr: string) => ({
      address,
      cidr,
      family: 'IPv4' as const,
      internal: false,
      netmask: '',
      mac: '',
    });
    const lo = { ...iface('127.0.0.1', '127.0.0.1/8'), internal: true };
    expect(
      pilihAntarmuka('172.30.1.3', {
        lo: [lo],
        eth0: [iface('172.30.1.2', '172.30.1.0/24')],
        eth1: [iface('172.31.0.5', '172.31.0.0/16')],
      }),
    ).toEqual({ internal: '172.30.1.2', publik: '172.31.0.5' });
    expect(() => pilihAntarmuka('172.30.1.3', { eth0: [iface('172.30.1.2', '172.30.1.0/24')] })).toThrow(
      /publik 0/,
    );
  });
});

describe('daftar kredensial per sesi', () => {
  it('Basic sah -> host sesi (dipotong ke union); salah/kedaluwarsa/penuh ditolak', () => {
    let t = 1000;
    const d = createDaftarSesi(2, () => t);
    expect(
      d.pasang('u'.repeat(16), SANDI, [HOST, 'evil.example', 'CHALLENGES.cloudflare.com'], 60_000, cfg.union),
    ).toBe(true);
    const ok = d.periksa(`Basic ${Buffer.from(`${'u'.repeat(16)}:${SANDI}`).toString('base64')}`);
    expect([...(ok ?? [])].sort()).toEqual(['challenges.cloudflare.com', HOST]);
    expect(d.periksa(`Basic ${Buffer.from(`${'u'.repeat(16)}:salah`).toString('base64')}`)).toBeUndefined();
    expect(d.periksa('Bearer x')).toBeUndefined();
    expect(d.periksa(undefined)).toBeUndefined();
    expect(d.pasang('v'.repeat(16), SANDI, [], 60_000, cfg.union)).toBe(true);
    expect(d.pasang('w'.repeat(16), SANDI, [], 60_000, cfg.union)).toBe(false);
    t += 60_001;
    expect(
      d.periksa(`Basic ${Buffer.from(`${'u'.repeat(16)}:${SANDI}`).toString('base64')}`),
    ).toBeUndefined();
    expect(d.ukuran).toBe(0);
  });
});

describe('proxy CONNECT edge', () => {
  const sesi = new Set([HOST]);

  it('DNS host terizin ke loopback/RFC1918/CGNAT/link-local/bridge/::ffff:/::127.0.0.1 -> ditolak', async () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '100.64.0.1',
      '100.101.1.2',
      '169.254.169.254',
      '172.17.0.1',
      '172.30.1.1',
      '192.168.1.1',
      '::1',
      '::ffff:127.0.0.1',
      '::127.0.0.1',
      'fd00::1',
    ]) {
      const p = createEdgeProxy(cfg, createDaftarSesi(4), async () => [ip]);
      expect(await p.decide(sesi, HOST, 443), ip).toMatchObject({ ok: false });
    }
    // Satu alamat terlarang di antara alamat publik = tolak seluruh host (anti rebinding round-robin).
    const campur = createEdgeProxy(cfg, createDaftarSesi(4), async () => ['93.184.216.34', '10.0.0.1']);
    expect(await campur.decide(sesi, HOST, 443)).toMatchObject({ ok: false });
    const publik = createEdgeProxy(cfg, createDaftarSesi(4), async () => ['93.184.216.34']);
    expect(await publik.decide(sesi, HOST, 443)).toEqual({ ok: true, address: '93.184.216.34' });
  });

  it('port selain 443 (20128, 2019), IP literal, host di luar sesi/union: ditolak TANPA kueri DNS', async () => {
    const dns: string[] = [];
    const p = createEdgeProxy(cfg, createDaftarSesi(4), async (h) => {
      dns.push(h);
      return ['93.184.216.34'];
    });
    for (const [h, port] of [
      [HOST, 20128],
      [HOST, 2019],
      [HOST, 80],
      ['127.0.0.1', 443],
      ['93.184.216.34', 443],
      ['oss.go.id', 443],
      ['evil.example', 443],
    ] as const)
      expect(await p.decide(sesi, h, port), `${h}:${port}`).toMatchObject({ ok: false });
    expect(dns).toEqual([]);
    // Host di sesi tetapi di luar union global (sesi disusupi): tetap ditolak.
    expect(await p.decide(new Set(['evil.example']), 'evil.example', 443)).toMatchObject({ ok: false });
  });

  it('server: tanpa kredensial 407, kredensial sah + tujuan terlarang 403, HTTP biasa 403', async () => {
    const d = createDaftarSesi(4);
    d.pasang('u'.repeat(16), SANDI, [HOST], 60_000, cfg.union);
    const p = createEdgeProxy(cfg, d, async () => ['127.0.0.1']);
    const port = await dengar(p.server);
    const tanpa = await connect(port, `${HOST}:443`);
    expect(tanpa).toMatch(/^HTTP\/1\.1 407/);
    expect(tanpa).toMatch(/Proxy-Authenticate: Basic/);
    expect(await connect(port, `${HOST}:443`, `${'u'.repeat(16)}:salah`)).toMatch(/^HTTP\/1\.1 407/);
    expect(await connect(port, `${HOST}:443`, `${'u'.repeat(16)}:${SANDI}`)).toMatch(/^HTTP\/1\.1 403/);
    expect(await connect(port, `127.0.0.1:20128`, `${'u'.repeat(16)}:${SANDI}`)).toMatch(/^HTTP\/1\.1 403/);
    expect(await connect(port, `rusak`, `${'u'.repeat(16)}:${SANDI}`)).toMatch(/^HTTP\/1\.1 403/);
    const biasa = await fetch(`http://127.0.0.1:${port}/`);
    expect(biasa.status).toBe(403);
    p.tutup();
  });
});

describe('kanal kontrol edge', () => {
  it('PUT/DELETE bertanda HMAC; tanpa tanda/putar ulang 401; isi rusak 422; jalur lain 404', async () => {
    const d = createDaftarSesi(4);
    const port = await dengar(createEdgeKontrol(cfg, d));
    const base = `http://127.0.0.1:${port}`;
    const user = 'a'.repeat(24);
    const path = `/sesi/${user}`;
    const isi = JSON.stringify({ sandi: SANDI, hosts: [HOST], ttlMs: 60_000 });
    expect((await fetch(`${base}/health`)).status).toBe(200);
    expect((await fetch(`${base}${path}`, { method: 'PUT', body: isi })).status).toBe(401);
    const h = headerTanda(TOKEN, 'PUT', path, isi);
    expect((await fetch(`${base}${path}`, { method: 'PUT', headers: h, body: isi })).status).toBe(201);
    expect((await fetch(`${base}${path}`, { method: 'PUT', headers: h, body: isi })).status).toBe(401);
    expect(d.periksa(`Basic ${Buffer.from(`${user}:${SANDI}`).toString('base64')}`)?.has(HOST)).toBe(true);
    // Tanda dengan rahasia lain ditolak.
    const lain = headerTanda('x'.repeat(40), 'PUT', path, isi);
    expect((await fetch(`${base}${path}`, { method: 'PUT', headers: lain, body: isi })).status).toBe(401);
    for (const rusak of ['{', JSON.stringify({ sandi: 'pendek', hosts: [], ttlMs: 1 })]) {
      const hr = headerTanda(TOKEN, 'PUT', path, rusak);
      expect((await fetch(`${base}${path}`, { method: 'PUT', headers: hr, body: rusak })).status).toBe(422);
    }
    // Isi beda dari hash yang ditandatangani -> 401; panjang bertanda > 16 KB -> 413 sebelum isi dibaca.
    const beda = headerTanda(TOKEN, 'PUT', path, isi.replace('60000', '60001'));
    expect((await fetch(`${base}${path}`, { method: 'PUT', headers: beda, body: isi })).status).toBe(401);
    const besar = 'x'.repeat(17 * 1024);
    const hb = headerTanda(TOKEN, 'PUT', path, besar);
    expect((await fetch(`${base}${path}`, { method: 'PUT', headers: hb, body: besar })).status).toBe(413);
    expect((await fetch(`${base}/sesi/BAD`, { method: 'PUT', body: isi })).status).toBe(404);
    expect((await fetch(`${base}/lain`)).status).toBe(404);
    const hd = headerTanda(TOKEN, 'DELETE', path);
    expect((await fetch(`${base}${path}`, { method: 'DELETE', headers: hd })).status).toBe(200);
    expect(d.periksa(`Basic ${Buffer.from(`${user}:${SANDI}`).toString('base64')}`)).toBeUndefined();
  });
});

describe('proxy balik edge', () => {
  const SESI = '0b6f3c2e-1d2a-4c3b-8e9f-0a1b2c3d4e5f';

  async function hulu() {
    const seen: { path: string; host?: string; origin?: string }[] = [];
    const s = http.createServer((req, res) => {
      seen.push({ path: req.url ?? '', host: req.headers.host, origin: req.headers.origin });
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ path: req.url }));
    });
    const wss = new WebSocketServer({ noServer: true });
    s.on('upgrade', (req, socket, head) =>
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.send(JSON.stringify({ origin: req.headers.origin, cookie: req.headers.cookie, url: req.url }));
        ws.on('message', (m) => ws.send(m.toString()));
      }),
    );
    const port = await dengar(s);
    servers.push({ close: () => wss.close() });
    return { port, seen };
  }

  it('hanya /health, /internal/*, /ws/<uuid> (dan /debug bila aktif); Host/Origin/Cookie utuh', async () => {
    expect(jalurDiizinkan('/health', false)).toBe(true);
    expect(jalurDiizinkan('/internal/sesi', false)).toBe(true);
    expect(jalurDiizinkan('/debug', false)).toBe(false);
    expect(jalurDiizinkan('/debug/sesi', true)).toBe(true);
    expect(jalurDiizinkan('/dev', true)).toBe(false);

    const h = await hulu();
    const port = await dengar(createEdgeBalik({ hulu: new URL(`http://127.0.0.1:${h.port}`), debug: false }));
    const base = `http://127.0.0.1:${port}`;
    expect((await fetch(`${base}/health`)).status).toBe(200);
    const r = await fetch(`${base}/internal/sesi`, {
      method: 'POST',
      headers: { origin: 'https://urusin.test' },
      body: '{}',
    });
    expect(r.status).toBe(200);
    expect(h.seen.at(-1)).toEqual({
      path: '/internal/sesi',
      host: `127.0.0.1:${port}`,
      origin: 'https://urusin.test',
    });
    for (const p of ['/debug', '/debug/sesi', '/dev', '/', '/healthz', '/ws/x'])
      expect((await fetch(`${base}${p}`)).status, p).toBe(404);
    expect(h.seen.map((s) => s.path)).toEqual(['/health', '/internal/sesi']);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/${SESI}`, {
      origin: 'https://urusin.test',
      headers: { cookie: 'urusin_sid=abc' },
    });
    const pesan: string[] = [];
    ws.on('message', (m) => pesan.push(m.toString()));
    await new Promise((ok) => ws.on('open', ok));
    ws.send('halo');
    await new Promise((ok) => setTimeout(ok, 50));
    expect(JSON.parse(pesan[0]!)).toEqual({
      origin: 'https://urusin.test',
      cookie: 'urusin_sid=abc',
      url: `/ws/${SESI}`,
    });
    expect(pesan[1]).toBe('halo');
    ws.close();

    for (const p of ['/ws/bukan-uuid', `/ws/${SESI}?x=1`, '/internal/sesi']) {
      const tolak = new WebSocket(`ws://127.0.0.1:${port}${p}`);
      expect(await new Promise((ok) => tolak.on('error', () => ok('galat')))).toBe('galat');
    }

    const dbg = await dengar(createEdgeBalik({ hulu: new URL(`http://127.0.0.1:${h.port}`), debug: true }));
    expect((await fetch(`http://127.0.0.1:${dbg}/debug`)).status).toBe(200);
  });

  it('pendamping mati -> 502 jujur', async () => {
    const port = await dengar(createEdgeBalik({ hulu: new URL('http://127.0.0.1:9'), debug: false }));
    const r = await fetch(`http://127.0.0.1:${port}/health`);
    expect(r.status).toBe(502);
    expect(((await r.json()) as { kode: string }).kode).toBe('LAYANAN_TIDAK_TERSEDIA');
  });
});
