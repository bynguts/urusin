#!/usr/bin/env node
/**
 * Server Lighthouse CI = topologi produksi: `node apps/web/build` di belakang proxy balik yang meniru
 * PERSIS `encode zstd gzip { match { ... } }` di deploy/Caddyfile.urusin.{primary,fallback}. Tanpa ini
 * Lighthouse mengukur HTML SSR tanpa kompresi, padahal warga selalu menerimanya terkompres lewat Caddy.
 *
 * Yang ditiru (hanya kompresi; tanpa cache, tanpa header lain):
 * - pengkode zstd lalu gzip, dipilih dari Accept-Encoding (q tertinggi; seri -> urutan Caddyfile);
 * - hanya Content-Type pada daftar `match` Caddyfile (bukan `text/*`, jadi SSE tidak dikompres);
 * - respons yang sudah ber-Content-Encoding (aset pra-kompres sirv) diteruskan apa adanya;
 * - minimum_length bawaan Caddy 512 byte: respons lebih pendek dikirim tanpa kompresi;
 * - level bawaan Caddy: zstd 3, gzip 5. Respons terkompres: Vary: Accept-Encoding, tanpa Content-Length.
 *
 * Pemakaian (lighthouserc.cjs): PORT, HOST, ORIGIN seperti `node apps/web/build`.
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

/** Daftar `match { header Content-Type ... }` di Caddyfile.urusin (awalan; `*` Caddy = awalan). */
export const COMPRESSIBLE = [
  'text/html',
  'text/css',
  'text/plain',
  'text/javascript',
  'text/xml',
  'text/csv',
  'application/atom+xml',
  'application/font',
  'application/geo+json',
  'application/graphql+json',
  'application/javascript',
  'application/json',
  'application/ld+json',
  'application/manifest+json',
  'application/rss+xml',
  'application/vnd.api+json',
  'application/wasm',
  'application/x-javascript',
  'application/xhtml+xml',
  'application/xml',
  'font/',
  'image/svg+xml',
  'image/x-icon',
];
const ENCODERS = ['zstd', 'gzip']; // urutan di Caddyfile = preferensi saat q seri
export const MIN_LENGTH = 512;
/** Header hop-by-hop tidak diteruskan (seperti reverse_proxy Caddy); Node mengatur framing sendiri. */
const HOP_BY_HOP = [
  'connection',
  'keep-alive',
  'transfer-encoding',
  'proxy-connection',
  'upgrade',
  'te',
  'trailer',
];

/** @param {string | undefined} contentType */
export function compressible(contentType) {
  const ct = (contentType ?? '').toLowerCase();
  return ct !== '' && COMPRESSIBLE.some((p) => ct.startsWith(p));
}

/**
 * Pengkode dari Accept-Encoding: q tertinggi di antara zstd/gzip (`*` mencakup keduanya), seri ->
 * urutan Caddyfile. null bila tidak ada yang diterima.
 * @param {string | undefined} header
 */
export function chooseEncoding(header) {
  const q = new Map();
  for (const part of (header ?? '').split(',')) {
    const [name = '', ...params] = part.trim().toLowerCase().split(';');
    if (!name) continue;
    const qp = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    const value = qp ? Number(qp.slice(2)) : 1;
    q.set(name, Number.isFinite(value) ? value : 0);
  }
  let best = null;
  let bestQ = 0;
  for (const enc of ENCODERS) {
    const v = q.has(enc) ? q.get(enc) : (q.get('*') ?? 0);
    if (v > bestQ) [best, bestQ] = [enc, v];
  }
  return best;
}

/** @param {'zstd' | 'gzip'} enc */
function encoder(enc) {
  return enc === 'zstd'
    ? zlib.createZstdCompress({ params: { [zlib.constants.ZSTD_c_compressionLevel]: 3 } })
    : zlib.createGzip({ level: 5 });
}

/**
 * @param {http.IncomingMessage} up respons upstream
 * @param {http.ServerResponse} res
 * @param {string | null} enc
 * @param {string} method
 */
function relay(up, res, enc, method) {
  const headers = { ...up.headers };
  for (const h of HOP_BY_HOP) delete headers[h];
  const status = up.statusCode ?? 502;
  const bodyless = method === 'HEAD' || status === 204 || status === 304 || (status >= 100 && status < 200);
  const declared = headers['content-length'] === undefined ? NaN : Number(headers['content-length']);
  const eligible =
    enc !== null &&
    !bodyless &&
    headers['content-encoding'] === undefined &&
    compressible(headers['content-type']) &&
    !(declared < MIN_LENGTH);
  if (!eligible) {
    res.writeHead(status, headers);
    up.pipe(res);
    return;
  }
  // Seperti Caddy: tahan sampai MIN_LENGTH byte; bila respons selesai lebih pendek, kirim apa adanya.
  const held = [];
  let size = 0;
  let started = false;
  const start = () => {
    started = true;
    delete headers['content-length'];
    headers['content-encoding'] = enc;
    const vary = headers['vary'];
    headers['vary'] = vary ? `${vary}, Accept-Encoding` : 'Accept-Encoding';
    res.writeHead(status, headers);
    const z = encoder(/** @type {'zstd' | 'gzip'} */ (enc));
    z.pipe(res);
    for (const c of held) z.write(c);
    up.on('data', (c) => z.write(c));
    up.on('end', () => z.end());
  };
  const onData = (c) => {
    held.push(c);
    size += c.length;
    if (size >= MIN_LENGTH) {
      up.off('data', onData);
      up.off('end', onEnd);
      start();
    }
  };
  const onEnd = () => {
    if (started) return;
    res.writeHead(status, headers);
    res.end(Buffer.concat(held));
  };
  up.on('data', onData);
  up.on('end', onEnd);
}

/** Proxy balik ke 127.0.0.1:upstreamPort dengan kompresi gaya Caddy. @param {number} upstreamPort */
export function createProxy(upstreamPort) {
  return http.createServer((req, res) => {
    const enc = chooseEncoding(req.headers['accept-encoding']);
    const upReq = http.request(
      { host: '127.0.0.1', port: upstreamPort, method: req.method, path: req.url, headers: req.headers },
      (up) => relay(up, res, enc, req.method ?? 'GET'),
    );
    upReq.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(upReq);
  });
}

function main() {
  const port = Number(process.env.PORT ?? 4173);
  const host = process.env.HOST ?? '127.0.0.1';
  const upstreamPort = port + 1000;
  const child = spawn(process.execPath, ['apps/web/build'], {
    env: { ...process.env, PORT: String(upstreamPort), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const stop = () => child.kill('SIGTERM');
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  child.on('exit', (code) => process.exit(code ?? 1));

  const proxy = createProxy(upstreamPort);

  // Baris "Listening on" dicetak hanya setelah upstream DAN proxy siap (pola siap lhci).
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d.toString();
    process.stderr.write(`upstream: ${d}`);
    if (buf.includes('Listening on') && !proxy.listening) {
      proxy.listen(port, host, () =>
        console.log(`Listening on http://${host}:${port} (encode zstd gzip, seperti Caddy)`),
      );
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
