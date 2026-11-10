import { DemoProvider } from '@urusin/harness';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handle } from '../../hooks.server';
import { POST as buatUrusan } from '../../routes/api/urusan/+server';
import { POST as kirimTurn } from '../../routes/api/urusan/[id]/turn/+server';
import { RateLimiter } from './limiter';
import { createRuntime, setRuntimeForTests, type Runtime } from './runtime';
import { MIGRASI_SID_SAMPAI, migrasiSid, SID_COOKIE } from './sesi';

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
  const SEGAR = '__Host-urusin_sid_segar';
  const jalankan = async (cookie: string | null, lain: Record<string, string> = {}) => {
    const set: { name: string; value: string; opts: Record<string, unknown> }[] = [];
    const hapus: string[] = [];
    const toples: Record<string, string | undefined> = { [SID_COOKIE]: cookie ?? undefined, ...lain };
    let sid: string | undefined;
    await handle({
      event: {
        request: new Request(`${ORIGIN}/api/health`),
        url: new URL(`${ORIGIN}/api/health`),
        cookies: {
          get: (n: string) => toples[n],
          set: (name: string, value: string, opts: Record<string, unknown>) => {
            toples[name] = value;
            set.push({ name, value, opts });
          },
          delete: (name: string) => hapus.push(name),
        },
        locals: {
          get sid() {
            return sid;
          },
          set sid(v: string | undefined) {
            sid = v;
          },
        },
      } as never,
      resolve: async () => new Response('ok'),
    });
    return {
      set: set.filter((c) => c.name === SID_COOKIE),
      segar: set.filter((c) => c.name === SEGAR),
      hapus,
      sid,
    };
  };

  it('tanpa cookie: terbit id acak 128-bit, HttpOnly + SameSite=Lax', async () => {
    const r = await jalankan(null);
    expect(r.set).toHaveLength(1);
    expect(r.set[0]!.value).toMatch(/^[0-9a-f]{32}$/);
    expect(r.set[0]!.opts).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' });
    expect(r.sid).toBe(r.set[0]!.value);
  });

  it('cookie sid tamu diperpanjang ke umur penuh bila penanda harian sudah habis (>1 hari), bukan tiap permintaan', async () => {
    const sah = 'a'.repeat(32);
    const lama = await jalankan(sah);
    expect(lama.set).toEqual([
      { name: SID_COOKIE, value: sah, opts: expect.objectContaining({ maxAge: 30 * 24 * 3600 }) },
    ]);
    expect(lama.segar).toEqual([
      { name: SEGAR, value: '1', opts: expect.objectContaining({ maxAge: 24 * 3600, httpOnly: true }) },
    ]);
    expect(lama.sid).toBe(sah);
    expect(await jalankan(sah, { [SEGAR]: '1' })).toMatchObject({ set: [], segar: [], sid: sah });
  });

  it('cookie akun kedaluwarsa: dihapus dan urusin_sid diputar (pemakai berikutnya tidak mengadopsi urusan tamu)', async () => {
    const sah = 'b'.repeat(32);
    const r = await jalankan(sah, { [SEGAR]: '1', '__Host-urusin_akun': 'f'.repeat(43) });
    expect(r.hapus).toEqual(expect.arrayContaining(['__Host-urusin_akun', 'urusin_terakhir']));
    expect(r.set).toHaveLength(1);
    expect(r.set[0]!.value).toMatch(/^[0-9a-f]{32}$/);
    expect(r.set[0]!.value).not.toBe(sah);
    expect(r.sid).toBe(r.set[0]!.value);
  });

  it('PoC: nama cookie __Host-urusin_sid (Secure, Path=/), migrasi sekali dari urusin_sid lama', async () => {
    expect(SID_COOKIE).toBe('__Host-urusin_sid');
    const r = await jalankan(null);
    expect(r.set[0]!.opts).toMatchObject({ secure: true, path: '/' });
    expect(r.set[0]!.opts).not.toHaveProperty('domain');
    const lama = 'c'.repeat(32);
    const set: { name: string; value: string }[] = [];
    const hapus: string[] = [];
    const toples = new Map([['urusin_sid', lama]]);
    const cookies = {
      get: (n: string) => toples.get(n),
      set: (name: string, value: string) => {
        toples.set(name, value);
        set.push({ name, value });
      },
      delete: (name: string) => {
        toples.delete(name);
        hapus.push(name);
      },
    };
    migrasiSid(cookies as never);
    expect([set, hapus]).toEqual([[{ name: SID_COOKIE, value: lama }], ['urusin_sid']]);
    migrasiSid(cookies as never); // sekali saja
    expect(set).toHaveLength(1);
  });

  it('PoC (review delta 53fff2d b): adopsi urusin_sid lama hanya 30 hari; sesudahnya cookie lama dihapus saja', () => {
    expect(MIGRASI_SID_SAMPAI - Date.parse('2026-11-10T00:00:00Z')).toBe(30 * 24 * 3600 * 1000);
    const uji = (now: number) => {
      const toples = new Map([['urusin_sid', 'd'.repeat(32)]]);
      migrasiSid(
        {
          get: (n: string) => toples.get(n),
          set: (n: string, v: string) => toples.set(n, v),
          delete: (n: string) => toples.delete(n),
        } as never,
        now,
      );
      return Object.fromEntries(toples);
    };
    expect(uji(MIGRASI_SID_SAMPAI - 1)).toEqual({ [SID_COOKIE]: 'd'.repeat(32) });
    expect(uji(MIGRASI_SID_SAMPAI)).toEqual({});
  });

  it('cookie sah dipakai ulang; cookie rusak diganti', async () => {
    const sah = 'a'.repeat(32);
    expect(await jalankan(sah, { [SEGAR]: '1' })).toMatchObject({ set: [], sid: sah });
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

  it('PoC: IPv6 dibatasi per /64 (berganti alamat di /64 yang sama tidak mereset kuota)', async () => {
    setup({ buatPerJamIp: 2, buatPerJamSesi: 100 });
    for (let i = 0; i < 2; i++)
      expect((await buatUrusan(ev(post({}), `2001:db8:a:b::${i + 1}`, `v${i}`))).status).toBe(201);
    expect((await buatUrusan(ev(post({}), '2001:db8:a:b:ffff::7', 'v9'))).status).toBe(429);
    expect((await buatUrusan(ev(post({}), '2001:db8:a:c::1', 'v10'))).status).toBe(201);
  });

  it('urusan baru: sesi yang sama dibatasi walau ganti IP', async () => {
    setup({ buatPerJamIp: 100, buatPerJamSesi: 2 });
    for (let i = 0; i < 2; i++) {
      expect((await buatUrusan(ev(post({}), `10.0.1.${i}`, 'sama'))).status).toBe(201);
    }
    expect((await buatUrusan(ev(post({}), '10.0.1.9', 'sama'))).status).toBe(429);
  });

  // Batas eksplisit: tes paling lambat di berkas ini (~1-2 dtk sendirian dan di turbo paralel penuh).
  it('turn: batas per-menit per IP; permintaan yang ditolak tidak memulai turn', async () => {
    setup({ turnPerMenitIp: 1, turnPerMenitSesi: 100 });
    const u = rt.store.createUrusan();
    rt.akun.catatPemilikUrusan(u.id, { sid: 'sid' });
    const turn = (ip: string) => kirimTurn(ev(post({ teks: 'halo' }), ip, 'sid', { id: u.id }));
    expect((await turn('10.0.2.1')).status).toBe(202);
    for (let i = 0; i < 50 && rt.running.has(u.id); i++) await new Promise((r) => setTimeout(r, 20));
    const ditolak = await turn('10.0.2.1');
    expect(ditolak.status).toBe(429);
    expect(
      (rt.store.db.prepare('SELECT COUNT(*) n FROM turns WHERE urusan_id = ?').get(u.id) as { n: number }).n,
    ).toBe(1);
  }, 20_000);
});
