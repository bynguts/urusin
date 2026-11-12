import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { buatPenyemat, konfigEmbeddingDariEnv } from './klien.js';
import { Lru } from './lru.js';

type Handler = (body: { input: string[] }, res: ServerResponse) => void | Promise<void>;

/** Sidecar palsu ala llama-server: vektor deterministik per teks (panjang, kode huruf pertama, 1). */
const vektorPalsu = (t: string) => [t.length, t.charCodeAt(0) || 1, 1];

let server: Server | undefined;
let permintaan: string[][] = [];

async function sidecar(handler?: Handler): Promise<string> {
  permintaan = [];
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => {
      const body = JSON.parse(raw) as { input: string[] };
      permintaan.push(body.input);
      if (handler) return void handler(body, res);
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          data: body.input.map((t, index) => ({ index, embedding: vektorPalsu(t) })).reverse(),
        }),
      );
    });
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = undefined;
});

const json = (res: ServerResponse, body: unknown) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
};

describe('buatPenyemat', () => {
  it('mengembalikan vektor ternormalisasi sesuai urutan input walau balasan tidak berurutan', async () => {
    const p = buatPenyemat({ url: await sidecar(), fetch });
    const v = await p.semat(['ab', 'xyz']);
    expect(v).toHaveLength(2);
    const [a, b] = v!;
    expect(Math.hypot(...a!)).toBeCloseTo(1, 5);
    const n = Math.hypot(...vektorPalsu('xyz'));
    expect([...b!].map((x) => +x.toFixed(4))).toEqual(vektorPalsu('xyz').map((x) => +(x / n).toFixed(4)));
  });

  it('cache LRU: teks yang sama tidak dikirim ulang, duplikat dalam satu panggilan dikirim sekali', async () => {
    const p = buatPenyemat({ url: await sidecar(), fetch });
    await p.semat(['a', 'b', 'a']);
    expect(permintaan).toEqual([['a', 'b']]);
    const v = await p.semat(['b', 'c']);
    expect(permintaan).toEqual([['a', 'b'], ['c']]);
    expect(v).toHaveLength(2);
    await p.semat(['a', 'b', 'c']);
    expect(permintaan).toHaveLength(2);
  });

  it('daftar kosong tidak memanggil sidecar', async () => {
    const p = buatPenyemat({ url: await sidecar(), fetch });
    expect(await p.semat([])).toEqual([]);
    expect(permintaan).toHaveLength(0);
  });

  it('fail-open: sidecar lambat melewati timeout = null dengan cepat, tanpa melempar', async () => {
    const url = await sidecar((b, res) => void setTimeout(() => json(res, { data: [] }), 1_000));
    const p = buatPenyemat({ url, fetch, timeoutMs: 50 });
    const t0 = performance.now();
    expect(await p.semat(['x'])).toBeNull();
    expect(performance.now() - t0).toBeLessThan(500);
  });

  it('fail-open: sidecar mati = null; lalu istirahat tanpa memanggil, dan pulih setelah jeda', async () => {
    let jam = 1_000;
    let panggilan = 0;
    const mati: typeof fetch = () => {
      panggilan++;
      return Promise.reject(new TypeError('fetch failed: ECONNREFUSED'));
    };
    const p = buatPenyemat({ url: 'http://127.0.0.1:1', fetch: mati, jedaGagalMs: 10_000, now: () => jam });
    expect(await p.semat(['x'])).toBeNull();
    expect(await p.semat(['y'])).toBeNull();
    expect(panggilan).toBe(1);
    jam += 10_001;
    expect(await p.semat(['z'])).toBeNull();
    expect(panggilan).toBe(2);
  });

  it('pulih: setelah jeda, sidecar yang hidup lagi dipakai', async () => {
    let jam = 0;
    const url = await sidecar();
    let hidup = false;
    const f: typeof fetch = (i, init) => (hidup ? fetch(i, init) : Promise.reject(new TypeError('mati')));
    const p = buatPenyemat({ url, fetch: f, jedaGagalMs: 5_000, now: () => jam });
    expect(await p.semat(['x'])).toBeNull();
    hidup = true;
    expect(await p.semat(['x'])).toBeNull();
    jam = 5_001;
    expect(await p.semat(['x'])).toHaveLength(1);
  });

  it('pembatalan oleh pemanggil tidak membuat klien beristirahat', async () => {
    const url = await sidecar();
    const p = buatPenyemat({ url, fetch });
    const ac = new AbortController();
    ac.abort();
    expect(await p.semat(['x'], { signal: ac.signal })).toBeNull();
    expect(await p.semat(['x'])).toHaveLength(1);
  });

  it.each<[string, Handler]>([
    ['HTTP 500', (_b, res) => ((res.statusCode = 500), res.end('galat'))],
    ['bukan JSON', (_b, res) => res.end('<html>')],
    ['jumlah data beda', (_b, res) => json(res, { data: [] })],
    ['index ganda', (b, res) => json(res, { data: b.input.map(() => ({ index: 0, embedding: [1, 0] })) })],
    [
      'index di luar rentang',
      (b, res) => json(res, { data: b.input.map((_t, i) => ({ index: i + 5, embedding: [1, 0] })) }),
    ],
    [
      'embedding bukan angka',
      (b, res) => json(res, { data: b.input.map((_t, index) => ({ index, embedding: ['a'] })) }),
    ],
    [
      'vektor nol',
      (b, res) => json(res, { data: b.input.map((_t, index) => ({ index, embedding: [0, 0] })) }),
    ],
    [
      'dimensi tidak seragam',
      (b, res) =>
        json(res, { data: b.input.map((_t, index) => ({ index, embedding: index ? [1, 2, 3] : [1, 2] })) }),
    ],
  ])('balasan rusak (%s) = null', async (_n, handler) => {
    const p = buatPenyemat({ url: await sidecar(handler), fetch });
    expect(await p.semat(['a', 'b'])).toBeNull();
  });

  it('terlalu banyak teks ditolak tanpa memanggil sidecar', async () => {
    const p = buatPenyemat({ url: await sidecar(), fetch });
    expect(await p.semat(Array.from({ length: 257 }, (_x, i) => `t${i}`))).toBeNull();
    expect(permintaan).toHaveLength(0);
  });

  it('cache campur dimensi (model diganti saat proses hidup) = null', async () => {
    let dim = 2;
    const url = await sidecar((b, res) =>
      json(res, { data: b.input.map((_t, index) => ({ index, embedding: Array(dim).fill(1) })) }),
    );
    const p = buatPenyemat({ url, fetch });
    await p.semat(['a']);
    dim = 3;
    expect(await p.semat(['a', 'b'])).toBeNull();
  });

  it('default memakai egress: loopback tanpa URUSIN_EMBED_URL diblokir = null (bukan lempar)', async () => {
    const p = buatPenyemat({ url: await sidecar() });
    expect(await p.semat(['x'])).toBeNull();
    expect(permintaan).toHaveLength(0);
  });
});

describe('konfigEmbeddingDariEnv', () => {
  it('tanpa URUSIN_EMBED_URL = fitur mati', () => {
    expect(konfigEmbeddingDariEnv({})).toBeNull();
    expect(konfigEmbeddingDariEnv({ URUSIN_EMBED_URL: '  ' })).toBeNull();
    expect(konfigEmbeddingDariEnv({ URUSIN_EMBED_URL: 'bukan url' })).toBeNull();
    expect(konfigEmbeddingDariEnv({ URUSIN_EMBED_URL: 'file:///etc/passwd' })).toBeNull();
  });

  it('timeout dibatasi 50..300 ms', () => {
    const u = 'http://127.0.0.1:4340';
    expect(konfigEmbeddingDariEnv({ URUSIN_EMBED_URL: u })).toEqual({ url: u });
    expect(konfigEmbeddingDariEnv({ URUSIN_EMBED_URL: u, URUSIN_EMBED_TIMEOUT_MS: '5000' })?.timeoutMs).toBe(
      300,
    );
    expect(konfigEmbeddingDariEnv({ URUSIN_EMBED_URL: u, URUSIN_EMBED_TIMEOUT_MS: '1' })?.timeoutMs).toBe(50);
    expect(konfigEmbeddingDariEnv({ URUSIN_EMBED_URL: u, URUSIN_EMBED_TIMEOUT_MS: 'x' })).toEqual({ url: u });
  });
});

describe('Lru', () => {
  it('mengusir entri paling lama tidak dipakai', () => {
    const c = new Lru<string, number>(2);
    c.simpan('a', 1);
    c.simpan('b', 2);
    expect(c.ambil('a')).toBe(1);
    c.simpan('c', 3);
    expect(c.ambil('b')).toBeUndefined();
    expect(c.ambil('a')).toBe(1);
    expect(c.ukuran).toBe(2);
    expect(() => new Lru(0)).toThrow(RangeError);
  });
});
