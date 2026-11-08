import { afterEach, describe, expect, it } from 'vitest';
import { handle } from '../../hooks.server';
import { POST as cspReport } from '../../routes/api/csp-report/+server';
import { ORIGIN_EXCEPTIONS, checkOrigin } from './origin';

const ORIGIN = 'http://localhost:3000';

const req = (path: string, origin: string | null, method = 'POST') =>
  new Request(`${ORIGIN}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
    body: method === 'GET' ? null : '{}',
  });

async function run(request: Request) {
  let reached = false;
  const res = await handle({
    event: { request, url: new URL(request.url) } as never,
    resolve: async () => {
      reached = true;
      return new Response('ok');
    },
  });
  return { status: res.status, reached, body: res.status === 403 ? await res.json() : null };
}

afterEach(() => {
  delete process.env.URUSIN_PUBLIC_ORIGIN;
});

describe('anti-CSRF: Origin persis di request pengubah state', () => {
  it('Origin sama persis lolos', async () => {
    expect(await run(req('/api/urusan', ORIGIN))).toMatchObject({ status: 200, reached: true });
  });

  it.each([
    ['POST biasa tanpa Origin', null],
    ['origin lain', 'https://jahat.example'],
    ['port beda', 'http://localhost:5173'],
    ['slash akhir', 'http://localhost:3000/'],
    ['sufiks jebakan', 'http://localhost:3000.jahat.example'],
    ['origin ekstensi', 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'],
    ['null', 'null'],
  ])('%s → 403 dan tidak sampai ke handler', async (_n, origin) => {
    const r = await run(req('/api/urusan', origin));
    expect(r).toMatchObject({ status: 403, reached: false });
    expect(r.body).toEqual({ kode: 'CSRF', pesanWarga: expect.any(String) });
  });

  it('GET tidak diperiksa; PUT/PATCH/DELETE diperiksa', async () => {
    expect((await run(req('/api/urusan', null, 'GET'))).status).toBe(200);
    for (const method of ['PUT', 'PATCH', 'DELETE'])
      expect((await run(req('/api/data', 'https://x.example', method))).status, method).toBe(403);
  });

  it('origin publik dikonfigurasi lewat URUSIN_PUBLIC_ORIGIN', async () => {
    process.env.URUSIN_PUBLIC_ORIGIN = 'https://urusin.example';
    expect((await run(req('/api/urusan', 'https://urusin.example'))).status).toBe(200);
    expect((await run(req('/api/urusan', ORIGIN))).status).toBe(403);
  });
});

describe('pengecualian Origin terdaftar (satu tempat: lib/server/origin.ts)', () => {
  it('daftar pengecualian persis tiga entri', () => {
    expect(ORIGIN_EXCEPTIONS.map((e) => `${e.path}:${e.kebijakan}`)).toEqual([
      '/api/mcp:jika-ada',
      '/api/csp-report:bebas',
      '/api/sync/status:bebas',
    ]);
  });

  describe('/api/mcp/*: tanpa Origin boleh, Origin asing ditolak', () => {
    it('tanpa Origin lolos (klien MCP bukan browser)', async () => {
      expect(await run(req('/api/mcp/rpc', null))).toMatchObject({ status: 200, reached: true });
      expect(await run(req('/api/mcp', null))).toMatchObject({ status: 200, reached: true });
    });
    it('Origin sama dengan origin publik lolos', async () => {
      expect((await run(req('/api/mcp/rpc', ORIGIN))).status).toBe(200);
    });
    it('Origin asing ditolak 403', async () => {
      expect(await run(req('/api/mcp/rpc', 'https://jahat.example'))).toMatchObject({
        status: 403,
        reached: false,
      });
      expect((await run(req('/api/mcp/rpc', 'null'))).status).toBe(403);
    });
    it('awalan tidak bocor ke path mirip (/api/mcpx tetap kena aturan umum)', async () => {
      expect((await run(req('/api/mcpx/rpc', null))).status).toBe(403);
    });
  });

  describe('/api/csp-report: dilewatkan dan rutenya tetap berfungsi', () => {
    it('tanpa Origin lolos lewat hooks dan diterima handler aslinya', async () => {
      const body = JSON.stringify({ 'csp-report': { 'violated-directive': 'script-src' } });
      const request = new Request(`${ORIGIN}/api/csp-report`, {
        method: 'POST',
        headers: { 'content-type': 'application/csp-report' },
        body,
      });
      const res = await handle({
        event: { request, url: new URL(request.url) } as never,
        resolve: async () => cspReport({ request, getClientAddress: () => '127.0.0.1' } as never),
      });

      expect(res.status).toBeLessThan(300);
    });
    it('Origin apa pun dilewatkan', async () => {
      expect((await run(req('/api/csp-report', 'https://apa-saja.example'))).status).toBe(200);
    });
  });

  describe('/api/sync/status: dilewatkan (dipanggil ekstensi)', () => {
    it('tanpa Origin dan dengan origin ekstensi lolos', async () => {
      expect((await run(req('/api/sync/status', null))).status).toBe(200);
      expect(
        (await run(req('/api/sync/status', 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'))).status,
      ).toBe(200);
    });
    it('hanya path persis: /api/sync/lain tetap 403', async () => {
      expect((await run(req('/api/sync/lain', null))).status).toBe(403);
    });
  });

  it('checkOrigin murni: metode aman selalu lolos', () => {
    expect(checkOrigin('GET', '/api/urusan', null, ORIGIN)).toEqual({ allowed: true });
    expect(checkOrigin('HEAD', '/api/urusan', 'https://x', ORIGIN)).toEqual({ allowed: true });
    expect(checkOrigin('POST', '/api/urusan', null, ORIGIN)).toMatchObject({ allowed: false });
  });
});
