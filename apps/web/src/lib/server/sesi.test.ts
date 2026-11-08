import { DemoProvider } from '@urusin/harness';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handle } from '../../hooks.server';
import { POST as buatUrusan } from '../../routes/api/urusan/+server';
import { POST as kirimTurn } from '../../routes/api/urusan/[id]/turn/+server';
import { RateLimiter } from './limiter';
import { createRuntime, setRuntimeForTests, type Runtime } from './runtime';
import { SID_COOKIE } from './sesi';

const ORIGIN = 'http://localhost:3000';
let rt: Runtime;
const setup = (config: Partial<Runtime['config']> = {}) => {
  rt = createRuntime({
    provider: new DemoProvider(),
    config: { dbPath: ':memory:', disconnectGraceMs: 0, ...config },
  });
  setRuntimeForTests(rt);
};
beforeEach(() => setup());
afterEach(() => setRuntimeForTests(undefined));

const post = (body: unknown) =>
  new Request(`${ORIGIN}/x`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify(body),
  });
const ev = (request: Request, ip: string, sid: string, params: Record<string, string> = {}) =>
  ({
    request,
    params,
    url: new URL(request.url),
    locals: { sid },
    getClientAddress: () => ip,
  }) as never;

describe('RateLimiter', () => {
  it('menolak setelah batas, jendela baru membuka lagi, dan jumlah kunci dibatasi', () => {
    let t = 0;
    const l = new RateLimiter(2, 1000, 2, () => t);
    expect(l.consume('a').ok).toBe(true);
    expect(l.consume('a').ok).toBe(true);
    const ditolak = l.consume('a');
    expect(ditolak.ok).toBe(false);
    expect(ditolak.retryAfterSec).toBeGreaterThanOrEqual(1);
    expect(l.consume('b').ok).toBe(true);
    expect(l.consume('c').ok).toBe(false); // penuh: gagal-tertutup
    t = 1500;
    expect(l.consume('a').ok).toBe(true);
    expect(l.consume('c').ok).toBe(true); // jendela lama disapu
  });
});

describe('cookie sesi', () => {
  const jalankan = async (cookie: string | null) => {
    const set: { name: string; value: string; opts: Record<string, unknown> }[] = [];
    let sid: string | undefined;
    await handle({
      event: {
        request: new Request(`${ORIGIN}/api/health`),
        url: new URL(`${ORIGIN}/api/health`),
        cookies: {
          get: (n: string) => (n === SID_COOKIE ? (cookie ?? undefined) : undefined),
          set: (name: string, value: string, opts: Record<string, unknown>) =>
            set.push({ name, value, opts }),
        },
        locals: {
          set sid(v: string | undefined) {
            sid = v;
          },
        },
      } as never,
      resolve: async () => new Response('ok'),
    });
    return { set, sid };
  };

  it('tanpa cookie: terbit id acak 128-bit, HttpOnly + SameSite=Lax', async () => {
    const r = await jalankan(null);
    expect(r.set).toHaveLength(1);
    expect(r.set[0]!.value).toMatch(/^[0-9a-f]{32}$/);
    expect(r.set[0]!.opts).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' });
    expect(r.sid).toBe(r.set[0]!.value);
  });

  it('cookie sah dipakai ulang; cookie rusak diganti', async () => {
    const sah = 'a'.repeat(32);
    expect(await jalankan(sah)).toMatchObject({ set: [], sid: sah });
    const r = await jalankan('bukan-id; drop');
    expect(r.set).toHaveLength(1);
    expect(r.sid).not.toBe('bukan-id; drop');
  });
});

describe('kuota per-IP dan per-sesi', () => {
  it('urusan baru: IP yang sama dibatasi walau ganti sesi; 429 membawa Retry-After dan galat seragam', async () => {
    setup({ buatPerJamIp: 3, buatPerJamSesi: 100 });
    for (let i = 0; i < 3; i++) {
      expect((await buatUrusan(ev(post({}), '10.0.0.1', `s${i}`))).status).toBe(201);
    }
    const res = await buatUrusan(ev(post({}), '10.0.0.1', 's9'));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(await res.json()).toEqual({ kode: 'RATE_LIMITED', pesanWarga: expect.any(String) });
    expect((await buatUrusan(ev(post({}), '10.0.0.2', 's10'))).status).toBe(201);
  });

  it('urusan baru: sesi yang sama dibatasi walau ganti IP', async () => {
    setup({ buatPerJamIp: 100, buatPerJamSesi: 2 });
    for (let i = 0; i < 2; i++) {
      expect((await buatUrusan(ev(post({}), `10.0.1.${i}`, 'sama'))).status).toBe(201);
    }
    expect((await buatUrusan(ev(post({}), '10.0.1.9', 'sama'))).status).toBe(429);
  });

  it('turn: batas per-menit per IP; permintaan yang ditolak tidak memulai turn', async () => {
    setup({ turnPerMenitIp: 1, turnPerMenitSesi: 100 });
    const u = rt.store.createUrusan();
    const turn = (ip: string) => kirimTurn(ev(post({ teks: 'halo' }), ip, 'sid', { id: u.id }));
    expect((await turn('10.0.2.1')).status).toBe(202);
    for (let i = 0; i < 50 && rt.running.has(u.id); i++) await new Promise((r) => setTimeout(r, 20));
    const ditolak = await turn('10.0.2.1');
    expect(ditolak.status).toBe(429);
    expect(
      (rt.store.db.prepare('SELECT COUNT(*) n FROM turns WHERE urusan_id = ?').get(u.id) as { n: number }).n,
    ).toBe(1);
  });
});
