import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import { chooseEncoding, compressible, createProxy, MIN_LENGTH } from '../lhci-serve.mjs';

describe('chooseEncoding (urutan Caddyfile: zstd, gzip)', () => {
  it('Chrome (gzip, deflate, br, zstd) -> zstd', () => {
    assert.equal(chooseEncoding('gzip, deflate, br, zstd'), 'zstd');
  });
  it('hanya gzip -> gzip; q lebih tinggi menang; q=0 ditolak', () => {
    assert.equal(chooseEncoding('gzip, br'), 'gzip');
    assert.equal(chooseEncoding('zstd;q=0.5, gzip'), 'gzip');
    assert.equal(chooseEncoding('zstd;q=0, gzip;q=0'), null);
  });
  it('tanpa header atau hanya br -> tanpa kompresi; * mencakup keduanya', () => {
    assert.equal(chooseEncoding(undefined), null);
    assert.equal(chooseEncoding('br'), null);
    assert.equal(chooseEncoding('*'), 'zstd');
  });
});

describe('compressible (daftar match Caddyfile)', () => {
  it('HTML, CSS, JSON, SVG, font ya; SSE, webp, avif tidak', () => {
    for (const t of [
      'text/html; charset=utf-8',
      'text/css',
      'application/json',
      'image/svg+xml',
      'font/woff2',
    ]) {
      assert.equal(compressible(t), true, t);
    }
    for (const t of ['text/event-stream', 'image/webp', 'image/avif', undefined]) {
      assert.equal(compressible(t), false, String(t));
    }
  });
});

describe('createProxy', () => {
  const big = '<p>urusin</p>'.repeat(200);
  /** @type {http.Server} */ let upstream;
  /** @type {http.Server} */ let proxy;
  let port = 0;

  before(async () => {
    upstream = http.createServer((req, res) => {
      const routes = {
        '/besar': ['text/html; charset=utf-8', big, {}],
        '/kecil': ['text/html', '<p>kecil</p>', {}],
        '/sse': ['text/event-stream', 'data: x\n\n'.repeat(100), {}],
        '/gambar': ['image/webp', 'x'.repeat(2000), {}],
        '/prakompres': ['text/css', 'sudah', { 'content-encoding': 'br' }],
      };
      const [type, body, extra] = routes[req.url ?? ''] ?? ['text/plain', 'tidak ada', {}];
      res.writeHead(200, { 'content-type': type, ...extra });
      res.end(body);
    });
    await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
    proxy = createProxy(/** @type {import('node:net').AddressInfo} */ (upstream.address()).port);
    await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
    port = /** @type {import('node:net').AddressInfo} */ (proxy.address()).port;
  });
  after(() => {
    proxy.close();
    upstream.close();
  });

  /** @param {string} path @param {string} [ae] */
  const get = (path, ae) =>
    new Promise((resolve, reject) => {
      http
        .get({ port, path, headers: ae ? { 'accept-encoding': ae } : {} }, (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }));
        })
        .on('error', reject);
    });

  it('HTML >= 512 byte dikompres zstd untuk Chrome, isi utuh, Vary diset, tanpa Content-Length', async () => {
    const r = await get('/besar', 'gzip, deflate, br, zstd');
    assert.equal(r.headers['content-encoding'], 'zstd');
    assert.equal(r.headers['vary'], 'Accept-Encoding');
    assert.equal(r.headers['content-length'], undefined);
    assert.equal(zlib.zstdDecompressSync(r.body).toString(), big);
    assert.ok(r.body.length < big.length / 4);
  });
  it('gzip bila klien hanya menerima gzip', async () => {
    const r = await get('/besar', 'gzip');
    assert.equal(r.headers['content-encoding'], 'gzip');
    assert.equal(zlib.gunzipSync(r.body).toString(), big);
  });
  it(`di bawah ${MIN_LENGTH} byte, SSE, gambar, dan yang sudah terkompres diteruskan apa adanya`, async () => {
    for (const path of ['/kecil', '/sse', '/gambar']) {
      const r = await get(path, 'gzip, zstd');
      assert.equal(r.headers['content-encoding'], undefined, path);
    }
    const pre = await get('/prakompres', 'gzip, zstd');
    assert.equal(pre.headers['content-encoding'], 'br');
    assert.equal(pre.body.toString(), 'sudah');
  });
  it('tanpa Accept-Encoding: tanpa kompresi', async () => {
    const r = await get('/besar');
    assert.equal(r.headers['content-encoding'], undefined);
    assert.equal(r.body.toString(), big);
  });
});
