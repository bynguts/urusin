import type net from 'node:net';
import type { MulaiSesiInternal, PendampingServerMessage } from '@urusin/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { loadConfig, type Config } from './config.js';
import { createServer } from './server.js';
import { SessionManager, sidHashOf, type ActiveRun, type RunInit } from './sessions.js';

const SID = sidHashOf('a'.repeat(32));
const OTHER = sidHashOf('b'.repeat(32));

function input(urusanId: string, extra: Partial<MulaiSesiInternal> = {}): MulaiSesiInternal {
  return {
    urusanId,
    sidHash: SID,
    executionId: `x_${urusanId}`,
    adapterId: 'telunjuk-sakti-wonogiri',
    flowId: 'ajukan',
    origin: 'https://telunjuksakti.wonogirikab.go.id',
    params: { layanan_id: 1 },
    ...extra,
  };
}

type FakeRun = ActiveRun & { init: RunInit; calls: string[] };

function harness(over: Partial<Config> = {}) {
  let t = 1_000_000;
  const runs: FakeRun[] = [];
  const config = { ...loadConfig({}), ...over };
  const factory = async (init: RunInit): Promise<FakeRun> => {
    const calls: string[] = [];
    const run: FakeRun = {
      init,
      calls,
      mulaiAi: async () => void calls.push('mulaiAi'),
      input: async (m) => void calls.push(`input:${m.type}`),
      ambilAlih: () => void calls.push('ambilAlih'),
      kembalikan: () => void calls.push('kembalikan'),
      setViewer: async (s) => void calls.push(s ? 'viewer' : 'noviewer'),
      pageText: async () => 'teks halaman',
      destroy: async () => void calls.push('destroy'),
    };
    runs.push(run);
    return run;
  };
  const manager = new SessionManager(config, factory, () => t);
  const viewer = () => {
    const sent: PendampingServerMessage[] = [];
    const closed: number[] = [];
    return {
      sent,
      closed,
      send: (m: PendampingServerMessage) => sent.push(m),
      close: (c: number) => closed.push(c),
    };
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { manager, runs, viewer, flush, advance: (ms: number) => (t += ms), config };
}

const owner = (urusanId: string, sidHash = SID) => ({ urusanId, sidHash });

describe('SessionManager', () => {
  it('antrean FIFO dengan maks sesi aktif; posisi dilaporkan; sesi berikutnya naik saat satu berakhir', async () => {
    const h = harness({ maxSessions: 2, maxQueue: 1 });
    await h.manager.create(input('u1'));
    await h.manager.create(input('u2'));
    const s3 = await h.manager.create(input('u3'));
    await h.flush();
    expect(s3).toMatchObject({ status: 'antre', antrean: { posisi: 1, panjang: 1 } });
    expect(h.manager.antrean()).toEqual({ aktif: 2, maks: 2, menunggu: 1 });
    await expect(h.manager.create(input('u4'))).rejects.toMatchObject({ kode: 'ANTREAN_PENUH', status: 503 });
    await h.manager.akhiri(owner('u1'));
    await h.flush();
    expect(h.manager.status(owner('u3')).status).toBe('menunggu_data');
    expect(h.runs.map((r) => r.init.program.origin)).toHaveLength(3);
    // Nisan: status akhir tetap terbaca oleh pemiliknya, tanpa sesi hidup.
    expect(h.manager.status(owner('u1'))).toMatchObject({
      status: 'dibatalkan',
      hasil: 'dibatalkan',
      mode: 'done',
    });
    expect(h.runs[0]!.calls).toContain('destroy');
  });

  it('kepemilikan: sid lain ditolak; executionId sama idempoten; berbeda = SESI_SUDAH_ADA', async () => {
    const h = harness();
    const a = await h.manager.create(input('u1'));
    expect((await h.manager.create(input('u1'))).sesiId).toBe(a.sesiId);
    await expect(h.manager.create(input('u1', { executionId: 'lain' }))).rejects.toMatchObject({
      kode: 'SESI_SUDAH_ADA',
    });
    await expect(h.manager.create(input('u1', { sidHash: OTHER }))).rejects.toMatchObject({
      kode: 'SESI_BUKAN_MILIK',
    });
    expect(() => h.manager.status(owner('u1', OTHER))).toThrow(/perangkat lain/);
    expect(() => h.manager.mintTicket(owner('u1', OTHER))).toThrow();
    expect(() => h.manager.status(owner('tidak-ada'))).toThrow(/tidak ada/);
  });

  it('adapter tak dikenal / origin registry tak cocok ditolak', async () => {
    const h = harness();
    await expect(h.manager.create(input('u1', { adapterId: 'x' }))).rejects.toMatchObject({
      kode: 'ADAPTER_TIDAK_ADA',
    });
    await expect(h.manager.create(input('u2', { origin: 'https://oss.go.id' }))).rejects.toMatchObject({
      kode: 'ADAPTER_TIDAK_ADA',
    });
  });

  it('override origin fixture diterapkan ke program', async () => {
    const h = harness({
      originOverrides: new Map([['https://telunjuksakti.wonogirikab.go.id', 'http://127.0.0.1:4320']]),
    });
    await h.manager.create(input('u1'));
    await h.flush();
    expect(h.runs[0]!.init.program.origin).toBe('http://127.0.0.1:4320');
  });

  it('tiket sekali pakai, terikat sesi, kedaluwarsa', async () => {
    const h = harness();
    const s = await h.manager.create(input('u1'));
    const t = h.manager.mintTicket(owner('u1'));
    expect(h.manager.consumeTicket(t.tiket, 'sesi-lain')).toBe(false);
    const t2 = h.manager.mintTicket(owner('u1'));
    expect(h.manager.consumeTicket(t2.tiket, s.sesiId)).toBe(true);
    expect(h.manager.consumeTicket(t2.tiket, s.sesiId)).toBe(false);
    const t3 = h.manager.mintTicket(owner('u1'));
    h.advance(31_000);
    expect(h.manager.consumeTicket(t3.tiket, s.sesiId)).toBe(false);
  });

  it('data vault/berkas: AI mulai hanya setelah lengkap; input ditolak di mode AI; kendali warga', async () => {
    const h = harness();
    const s = await h.manager.create(input('u1', { params: { layanan_id: 1, berkas: 'ktp' } }));
    await h.flush();
    const v = h.viewer();
    await h.manager.attach(s.sesiId, v);
    expect(v.sent.find((m) => m.type === 'butuh_data')).toEqual({
      type: 'butuh_data',
      placeholder: ['{{PEMOHON.HP}}'],
      berkas: ['ktp'],
    });
    await h.manager.handleClient(s.sesiId, {
      type: 'vault',
      isian: { '{{PEMOHON.HP}}': '08000000001', '{{X.Y}}': 'abaikan' },
    });
    const run = h.runs[0]!;
    expect(run.calls).not.toContain('mulaiAi');
    await h.manager.handleClient(s.sesiId, {
      type: 'berkas',
      nama: 'tidak_diminta',
      namaBerkas: 'a.png',
      mime: 'image/png',
      dataBase64: 'AAAA',
    });
    await h.manager.handleClient(s.sesiId, {
      type: 'berkas',
      nama: 'ktp',
      namaBerkas: 'besar.png',
      mime: 'image/png',
      dataBase64: 'A'.repeat(13_000_000),
    });
    expect(v.sent.some((m) => m.type === 'galat' && m.kode === 'BERKAS_TERLALU_BESAR')).toBe(true);
    await h.manager.handleClient(s.sesiId, {
      type: 'berkas',
      nama: 'ktp',
      namaBerkas: 'ktp.png',
      mime: 'image/png',
      dataBase64: 'AAAA',
    });
    expect(run.calls).toContain('mulaiAi');
    expect(run.init.data.value('{{PEMOHON.HP}}')).toBe('08000000001');
    expect(run.init.data.value('{{X.Y}}')).toBeUndefined();
    expect(run.init.data.file('ktp')).toEqual({ name: 'ktp.png', mime: 'image/png', base64: 'AAAA' });
    expect(h.manager.status(owner('u1'))).toMatchObject({ status: 'berjalan', mode: 'ai' });

    await h.manager.handleClient(s.sesiId, { type: 'text', teks: 'x' });
    await h.manager.handleClient(s.sesiId, { type: 'text', teks: 'y' });
    expect(run.calls.filter((c) => c.startsWith('input'))).toHaveLength(0);
    expect(v.sent.filter((m) => m.type === 'galat' && m.kode === 'INPUT_DITOLAK_MODE_AI')).toHaveLength(1);

    await h.manager.handleClient(s.sesiId, { type: 'ambil_alih' });
    expect(h.manager.status(owner('u1')).mode).toBe('takeover');
    await h.manager.handleClient(s.sesiId, {
      type: 'pointer',
      aksi: 'down',
      x: 1,
      y: 1,
      jenis: 'touch',
      tombol: 'left',
    });
    expect(run.calls).toContain('input:pointer');
    await h.manager.handleClient(s.sesiId, { type: 'kembalikan' });
    expect(run.calls).toContain('kembalikan');
    run.init.hooks.mode('ai', 'AI melanjutkan');
    run.init.hooks.event({ jenis: 'langkah', indeks: 1, total: 5, label: 'x' });
    run.init.hooks.activity();
    expect(h.manager.status(owner('u1')).mode).toBe('ai');
    expect(await h.manager.pageText(owner('u1'))).toBe('teks halaman');
    await h.manager.handleClient(s.sesiId, { type: 'ping', t: 5 });
    expect(v.sent.at(-1)).toEqual({ type: 'pong', t: 5 });

    // Selesai dari sisi peramban: data warga dihapus, viewer ditutup 4000, peramban dihancurkan.
    run.init.hooks.ended('selesai', 'berhasil', 'Terkirim');
    await h.flush();
    expect(run.init.data.value('{{PEMOHON.HP}}')).toBeUndefined();
    expect(run.init.data.file('ktp')).toBeUndefined();
    expect(v.closed).toEqual([4000]);
    expect(run.calls).toContain('destroy');
    expect(h.manager.status(owner('u1'))).toMatchObject({ status: 'selesai', hasil: 'berhasil' });
    await h.manager.handleClient(s.sesiId, { type: 'akhiri' }); // sudah berakhir: diabaikan
  });

  it('viewer baru menggantikan yang lama (4409); detach melepas screencast', async () => {
    const h = harness();
    const s = await h.manager.create(input('u1'));
    await h.flush();
    const a = h.viewer();
    const b = h.viewer();
    await h.manager.attach(s.sesiId, a);
    await h.manager.attach(s.sesiId, b);
    expect(a.closed).toEqual([4409]);
    await h.manager.detach(s.sesiId, a); // bukan viewer aktif: abaikan
    await h.manager.detach(s.sesiId, b);
    expect(h.runs[0]!.calls.filter((c) => c === 'noviewer')).toHaveLength(1);
    const c = h.viewer();
    await h.manager.attach('tidak-ada', c);
    expect(c.closed).toEqual([4404]);
  });

  it('TTL keras dan idle menghancurkan sesi (kedaluwarsa)', async () => {
    const h = harness({ idleMs: 1000, ttlMs: 10_000 });
    await h.manager.create(input('u1'));
    await h.manager.create(input('u2'));
    await h.flush();
    h.advance(1500);
    await h.manager.sweep();
    expect(h.manager.status(owner('u1')).status).toBe('kedaluwarsa');
    const h2 = harness({ idleMs: 60_000, ttlMs: 2000 });
    await h2.manager.create(input('u1'));
    h2.advance(2500);
    await h2.manager.sweep();
    expect(h2.manager.status(owner('u1')).status).toBe('kedaluwarsa');
    h2.advance(11 * 60_000);
    await h2.manager.sweep();
    expect(() => h2.manager.status(owner('u1'))).toThrow();
  });

  it('serahkan (tool handoff) memindahkan ke takeover; factory gagal = gagal; shutdown membersihkan', async () => {
    const h = harness();
    await h.manager.create(input('u1'));
    await h.flush();
    expect(h.manager.serahkan(owner('u1')).mode).toBe('takeover');
    expect(h.runs[0]!.calls).toContain('ambilAlih');
    await h.manager.shutdown();
    expect(h.runs[0]!.calls).toContain('destroy');

    const broken = new SessionManager(loadConfig({}), async () => {
      throw new Error('chromium tidak ada');
    });
    await broken.create(input('u9'));
    await new Promise((r) => setTimeout(r, 0));
    expect(broken.status(owner('u9'))).toMatchObject({ status: 'gagal', hasil: 'gagal' });
  });
});

describe('server HTTP + WebSocket', () => {
  let server: ReturnType<typeof createServer> | undefined;
  afterEach(() => server?.close());

  async function start() {
    const h = harness({ allowedOrigins: ['http://app.test'], internalToken: 't'.repeat(40), devPage: true });
    server = createServer(h.config, h.manager);
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    const port = (server!.address() as net.AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;
    const call = (path: string, body?: unknown, token = 't'.repeat(40)) =>
      fetch(`${base}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
      });
    return { h, port, base, call };
  }

  it('API internal: token wajib, validasi body, alur buat-status-tiket-serahkan-teks-akhiri', async () => {
    const { call, base } = await start();
    expect((await fetch(`${base}/health`)).status).toBe(200);
    expect((await call('/internal/antrean', undefined, 'salah')).status).toBe(401);
    expect((await call('/internal/sesi', { urusanId: 'u1' })).status).toBe(422);
    expect((await call('/internal/sesi', '{bukan json')).status).toBe(422);
    expect((await call('/internal/sesi', 'x'.repeat(70_000))).status).toBe(422);
    const created = await call('/internal/sesi', input('u1'));
    expect(created.status).toBe(201);
    expect((await call('/internal/sesi/status', owner('u1'))).status).toBe(200);
    expect((await call('/internal/sesi/status', owner('u1', OTHER))).status).toBe(403);
    const tiket = (await (await call('/internal/sesi/tiket', owner('u1'))).json()) as {
      wsUrl: string;
      tiket: string;
    };
    expect(tiket.wsUrl).toMatch(/\/ws\/[0-9a-f-]{36}$/);
    expect((await call('/internal/sesi/serahkan', owner('u1'))).status).toBe(200);
    expect(await (await call('/internal/sesi/teks', owner('u1'))).json()).toEqual({ teks: 'teks halaman' });
    expect((await call('/internal/sesi/lain', owner('u1'))).status).toBe(404);
    expect((await call('/internal/antrean')).status).toBe(200);
    expect((await call('/internal/sesi/akhiri', owner('u1'))).status).toBe(200);
    expect((await fetch(`${base}/tidak-ada`)).status).toBe(404);
    expect(
      (
        await fetch(`${base}/internal/sesi`, {
          method: 'PUT',
          headers: { authorization: `Bearer ${'t'.repeat(40)}` },
        })
      ).status,
    ).toBe(405);
    expect((await fetch(`${base}/dev`)).status).toBe(200);
  });

  it('WebSocket: Origin asing ditolak; pesan pertama wajib halo bertiket; tiket sekali pakai', async () => {
    const { call, port } = await start();
    await call('/internal/sesi', input('u1'));
    const t = (await (await call('/internal/sesi/tiket', owner('u1'))).json()) as {
      wsUrl: string;
      tiket: string;
    };
    const path = new URL(t.wsUrl).pathname;
    const url = `ws://127.0.0.1:${port}${path}`;

    const foreign = new WebSocket(url, { origin: 'http://evil.test' });
    await new Promise((r) => foreign.on('error', r));

    const noHalo = new WebSocket(url, { origin: 'http://app.test' });
    await new Promise((r) => noHalo.on('open', r));
    noHalo.send(JSON.stringify({ type: 'akhiri' }));
    expect(await new Promise((r) => noHalo.on('close', (c) => r(c)))).toBe(4401);

    const ok = new WebSocket(url, { origin: 'http://app.test' });
    const msgs: PendampingServerMessage[] = [];
    ok.on('message', (d) => msgs.push(JSON.parse(d.toString()) as PendampingServerMessage));
    await new Promise((r) => ok.on('open', r));
    ok.send(JSON.stringify({ type: 'halo', tiket: t.tiket }));
    await new Promise((r) => setTimeout(r, 50));
    expect(msgs[0]).toMatchObject({ type: 'status', sesi: { urusanId: 'u1' } });
    ok.send('bukan json');
    ok.send(JSON.stringify({ type: 'ping', t: 1 }));
    await new Promise((r) => setTimeout(r, 50));
    expect(msgs.some((m) => m.type === 'galat' && m.kode === 'PESAN_TIDAK_SAH')).toBe(true);
    expect(msgs.some((m) => m.type === 'pong')).toBe(true);

    const reuse = new WebSocket(url, { origin: 'http://app.test' });
    await new Promise((r) => reuse.on('open', r));
    reuse.send(JSON.stringify({ type: 'halo', tiket: t.tiket }));
    expect(await new Promise((r) => reuse.on('close', (c) => r(c)))).toBe(4401);
    ok.close();

    const badPath = new WebSocket(`ws://127.0.0.1:${port}/ws/xyz`, { origin: 'http://app.test' });
    await new Promise((r) => badPath.on('error', r));
  });
});
