import type net from 'node:net';
import type { MulaiSesiInternal, PendampingServerMessage } from '@urusin/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { loadConfig, type Config } from './config.js';
import { createServer } from './server.js';
import { SessionManager, sidHashOf, type ActiveRun, type RunInit } from './sessions.js';

const SID = sidHashOf('a'.repeat(32));
const COOKIE = `urusin_sid=${'a'.repeat(32)}`;
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

type FakeRun = ActiveRun & {
  init: RunInit;
  calls: string[];
  frameSink?: Parameters<ActiveRun['setViewer']>[0];
};

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
      gantiProgram: async (_p, id) => void calls.push(`ganti:${id}`),
      setViewer: async (s) => {
        calls.push(s ? 'viewer' : 'noviewer');
        run.frameSink = s;
      },
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
      frames: [] as unknown[],
      acks: [] as number[],
      send: (m: PendampingServerMessage) => sent.push(m),
      frame(f: unknown) {
        this.frames.push(f);
      },
      ack(seq: number) {
        this.acks.push(seq);
      },
      close: (c: number) => closed.push(c),
    };
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { manager, runs, viewer, flush, advance: (ms: number) => (t += ms), config };
}

const owner = (urusanId: string, sidHash = SID) => ({ urusanId, sidHash });

describe('SessionManager', () => {
  it('frame layar ke penampil aktif; ack diteruskan tanpa menunda idle; fokus dikirim tanpa nilai', async () => {
    const h = harness();
    const s = await h.manager.create(input('u-frame'));
    await h.flush();
    const v = h.viewer();
    await h.manager.attach(s.sesiId, v);
    const run = h.runs[0]!;
    const f = {
      meta: { lebar: 1, tinggi: 1, skala: 1, offsetAtas: 0, scrollX: 0, scrollY: 0 },
      jpeg: new Uint8Array(1),
    };
    run.frameSink?.(f as never);
    expect(v.frames).toEqual([f]);
    const sebelum = h.manager.status(owner('u-frame'));
    h.advance(170_000);
    await h.manager.handleClient(s.sesiId, { type: 'ack', seq: 4 });
    expect(v.acks).toEqual([4]);
    h.advance(20_000);
    await h.manager.sweep(); // ack bukan aktivitas: idle 3 menit tetap berlaku
    expect(h.manager.status(owner('u-frame')).status).toBe('kedaluwarsa');
    expect(sebelum.status).not.toBe('kedaluwarsa');
    const s2 = await h.manager.create(input('u-fokus'));
    await h.flush();
    const v2 = h.viewer();
    await h.manager.attach(s2.sesiId, v2);
    h.runs.at(-1)!.init.hooks.fokus('sandi');
    expect(v2.sent.at(-1)).toEqual({ type: 'fokus', jenis: 'sandi' });
  });

  it('headless (CI) hanya untuk origin fixture: situs nyata ditolak sebelum Chromium dibuat', async () => {
    const fx = 'http://127.0.0.1:4320';
    const h = harness({ headless: true, fixtureOrigins: [fx] });
    await expect(h.manager.create(input('u-real'))).rejects.toMatchObject({ kode: 'LAYANAN_TIDAK_TERSEDIA' });
    const h2 = harness({
      headless: true,
      fixtureOrigins: [fx],
      originOverrides: new Map([['https://telunjuksakti.wonogirikab.go.id', fx]]),
    });
    expect((await h2.manager.create(input('u-fx'))).status).not.toBe('gagal');
    expect(h.runs).toHaveLength(0);
  });

  it('antrean FIFO dengan maks sesi aktif; posisi dilaporkan; sesi berikutnya naik saat satu berakhir', async () => {
    const h = harness({ maxSessions: 2, maxQueue: 1 });
    await h.manager.create(input('u1'));
    await h.manager.create(input('u2'));
    const s3 = await h.manager.create(input('u3'));
    await h.flush();
    expect(s3).toMatchObject({ status: 'antre', antrean: { posisi: 1, panjang: 1 } });
    expect(h.manager.antrean()).toEqual({ aktif: 2, maks: 2, menunggu: 1 });
    await expect(h.manager.create(input('u4'))).rejects.toMatchObject({ kode: 'ANTREAN_PENUH', status: 429 });
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

  it('override berawalan jalur: nav dan halaman login probe diberi awalan fixture', async () => {
    const h = harness({
      originOverrides: new Map([['https://telunjuksakti.wonogirikab.go.id', 'http://127.0.0.1:4320/ts']]),
    });
    await h.manager.create(input('u1', { flowId: 'cek_status', params: {} }));
    await h.flush();
    const p = h.runs[0]!.init.program;
    expect(p.origin).toBe('http://127.0.0.1:4320');
    expect(p.steps[0]).toMatchObject({ op: 'nav', path: '/ts/telunjuksakti/index.php/welcome/permohonan' });
    expect(p.masuk?.halaman).toBe('/ts/telunjuksakti/index.php/users/login');
    expect(p.bacaSaja).toBe(true);
  });

  it('siaga: execution selesai -> peramban tetap hidup; execution berikutnya memakai peramban yang sama', async () => {
    const h = harness();
    const s = await h.manager.create(input('u1', { flowId: 'cek_status', params: {} }));
    await h.flush();
    const run = h.runs[0]!;
    const v = h.viewer();
    await h.manager.attach(s.sesiId, v);
    run.init.hooks.langkahSelesai('Hasil ada di layar.', { nomor: 'FX-REG-0001', status: 'Diproses' });
    expect(h.manager.status(owner('u1'))).toMatchObject({
      status: 'siaga',
      hasil: 'berhasil',
      mode: 'takeover',
      bukti: { nomor: 'FX-REG-0001', status: 'Diproses' },
    });
    expect(v.sent).toContainEqual({
      type: 'event',
      event: {
        jenis: 'selesai',
        hasil: 'berhasil',
        pesan: 'Hasil ada di layar.',
        bukti: { nomor: 'FX-REG-0001', status: 'Diproses' },
      },
    });
    expect(v.closed).toEqual([]);
    // Warga tetap bisa menggulir/membaca hasil; "kembalikan" tidak menghidupkan AI di siaga.
    await h.manager.handleClient(s.sesiId, { type: 'wheel', x: 1, y: 1, dx: 0, dy: 50 });
    expect(run.calls).toContain('input:wheel');
    await h.manager.handleClient(s.sesiId, { type: 'kembalikan' });
    expect(run.calls).not.toContain('kembalikan');

    // Execution baru di situs yang sama: sesi, peramban, dan login dipakai lagi.
    const lagi = await h.manager.create(
      input('u1', { executionId: 'x_2', flowId: 'cek_status', params: {} }),
    );
    await h.flush();
    expect(lagi.sesiId).toBe(s.sesiId);
    expect(h.runs).toHaveLength(1);
    expect(run.calls).toContain('ganti:x_2');
    expect(h.manager.status(owner('u1'))).toMatchObject({
      executionId: 'x_2',
      status: 'berjalan',
      mode: 'ai',
    });
    expect(h.manager.status(owner('u1')).bukti).toBeUndefined();

    // Siaga lagi lalu diakhiri warga: execution terakhir tetap berhasil, peramban dihancurkan.
    run.init.hooks.langkahSelesai('Hasil ada di layar.');
    await h.manager.handleClient(s.sesiId, { type: 'akhiri' });
    expect(h.manager.status(owner('u1'))).toMatchObject({
      status: 'selesai',
      hasil: 'berhasil',
      executionId: 'x_2',
    });
    expect(run.calls).toContain('destroy');
  });

  it('siaga di situs lain: sesi lama ditutup berhasil, sesi baru dibuat; bukan siaga = SESI_SUDAH_ADA', async () => {
    const h = harness();
    await h.manager.create(input('u1', { flowId: 'cek_status', params: {} }));
    await h.flush();
    h.runs[0]!.init.hooks.langkahSelesai('Selesai.');
    const baru = await h.manager.create(
      input('u1', {
        executionId: 'x_oss',
        adapterId: 'oss-nib',
        flowId: 'cari_nib',
        origin: 'https://oss.go.id',
        params: {},
      }),
    );
    await h.flush();
    expect(h.runs).toHaveLength(2);
    expect(h.runs[0]!.calls).toContain('destroy');
    expect(baru.executionId).toBe('x_oss');
    await expect(h.manager.create(input('u1', { executionId: 'x_3' }))).rejects.toMatchObject({
      kode: 'SESI_SUDAH_ADA',
    });
  });

  it('tiket sekali pakai, terikat sesi + hash cookie pemilik, kedaluwarsa', async () => {
    const h = harness();
    const s = await h.manager.create(input('u1'));
    const t = h.manager.mintTicket(owner('u1'));
    expect(h.manager.consumeTicket(t.tiket, 'sesi-lain', SID)).toBe(false);
    const t2 = h.manager.mintTicket(owner('u1'));
    expect(h.manager.consumeTicket(t2.tiket, s.sesiId, SID)).toBe(true);
    expect(h.manager.consumeTicket(t2.tiket, s.sesiId, SID)).toBe(false);
    const t3 = h.manager.mintTicket(owner('u1'));
    h.advance(31_000);
    expect(h.manager.consumeTicket(t3.tiket, s.sesiId, SID)).toBe(false);
    // Tiket sah tetapi cookie perangkat lain: ditolak (dan tiket hangus).
    const t4 = h.manager.mintTicket(owner('u1'));
    expect(h.manager.consumeTicket(t4.tiket, s.sesiId, OTHER)).toBe(false);
    expect(h.manager.consumeTicket(t4.tiket, s.sesiId, SID)).toBe(false);
  });

  it('sesi debug: hanya URL allowlist, langsung manual, kendali tidak bisa dikembalikan ke AI', async () => {
    const h = harness();
    await expect(
      h.manager.createManual({ url: 'https://evil.example/', sidHash: SID }),
    ).rejects.toMatchObject({ kode: 'ADAPTER_TIDAK_ADA' });
    const s = await h.manager.createManual({ url: 'https://oss.go.id/informasi', sidHash: SID });
    await h.flush();
    expect(s.urusanId).toMatch(/^debug-/);
    expect(h.runs[0]!.init.manualUrl).toBe('https://oss.go.id/informasi');
    expect(h.runs[0]!.calls).toContain('mulaiAi');
    expect(h.manager.debugOwner(s.sesiId)).toEqual({ urusanId: s.urusanId, sidHash: SID });
    await h.manager.handleClient(s.sesiId, { type: 'kembalikan' });
    expect(h.runs[0]!.calls).not.toContain('kembalikan');
    const biasa = await h.manager.create(input('u-biasa'));
    expect(h.manager.debugOwner(biasa.sesiId)).toBeUndefined();
  });

  it('sesi debug alur adapter: program adapter (AI mengisi), pemilik debug, adapter tak dikenal ditolak', async () => {
    const h = harness();
    await expect(
      h.manager.createDebugAlur({ adapterId: 'x', flowId: 'y', params: {}, sidHash: SID }),
    ).rejects.toMatchObject({ kode: 'ADAPTER_TIDAK_ADA' });
    await expect(
      h.manager.createDebugAlur({ adapterId: '__proto__', flowId: 'y', params: {}, sidHash: SID }),
    ).rejects.toMatchObject({ kode: 'ADAPTER_TIDAK_ADA' });
    const s = await h.manager.createDebugAlur({
      adapterId: 'samsat-dki',
      flowId: 'cek_pkb',
      params: {},
      sidHash: SID,
    });
    await h.flush();
    expect(h.runs[0]!.init.program.origin).toBe('https://samsat-pkb2.jakarta.go.id');
    expect(h.runs[0]!.init.manualUrl).toBeUndefined();
    expect(h.manager.debugOwner(s.sesiId)).toEqual({ urusanId: s.urusanId, sidHash: SID });
    expect(h.manager.status({ urusanId: s.urusanId, sidHash: SID }).status).toBe('menunggu_data');
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

  it('API internal: token wajib, validasi body, alur buat-status-tiket-serahkan-akhiri; tidak ada jalur teks halaman', async () => {
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
    // Temuan arsitek B-e: teks halaman bebas tidak pernah keluar dari pendamping.
    expect((await call('/internal/sesi/teks', owner('u1'))).status).toBe(404);
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

    const noHalo = new WebSocket(url, { origin: 'http://app.test', headers: { cookie: COOKIE } });
    await new Promise((r) => noHalo.on('open', r));
    noHalo.send(JSON.stringify({ type: 'akhiri' }));
    expect(await new Promise((r) => noHalo.on('close', (c) => r(c)))).toBe(4401);

    const ok = new WebSocket(url, { origin: 'http://app.test', headers: { cookie: COOKIE } });
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

    const reuse = new WebSocket(url, { origin: 'http://app.test', headers: { cookie: COOKIE } });
    await new Promise((r) => reuse.on('open', r));
    reuse.send(JSON.stringify({ type: 'halo', tiket: t.tiket }));
    expect(await new Promise((r) => reuse.on('close', (c) => r(c)))).toBe(4401);
    ok.close();

    const badPath = new WebSocket(`ws://127.0.0.1:${port}/ws/xyz`, {
      origin: 'http://app.test',
      headers: { cookie: COOKIE },
    });
    await new Promise((r) => badPath.on('error', r));

    // Tanpa cookie urusin_sid (atau cookie rusak): upgrade ditolak sebelum tiket dipakai.
    for (const headers of [{}, { cookie: 'urusin_sid=ZZ' }]) {
      const tanpa = new WebSocket(url, { origin: 'http://app.test', headers });
      await new Promise((r) => tanpa.on('error', r));
    }
    // Cookie perangkat lain + tiket sah: ditutup 4401.
    const t2 = (await (await call('/internal/sesi/tiket', owner('u1'))).json()) as { tiket: string };
    const lain = new WebSocket(url, {
      origin: 'http://app.test',
      headers: { cookie: `urusin_sid=${'b'.repeat(32)}` },
    });
    await new Promise((r) => lain.on('open', r));
    lain.send(JSON.stringify({ type: 'halo', tiket: t2.tiket }));
    expect(await new Promise((r) => lain.on('close', (c) => r(c)))).toBe(4401);
  });

  it('halaman /debug: mati tanpa token; dengan token: sesi manual, cookie sendiri, tiket, WS dari origin sendiri', async () => {
    const tanpa = await start();
    expect((await fetch(`${tanpa.base}/debug`)).status).toBe(404);
    server?.close();

    const h = harness({ allowedOrigins: ['http://app.test'], debugToken: 'd'.repeat(32) });
    server = createServer(h.config, h.manager);
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    const port = (server!.address() as net.AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;
    const page = await fetch(`${base}/debug`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('DEBUG');
    expect(html).toContain('<option value="samsat-dki/cek_pkb">');
    const post = (path: string, body: unknown, token = 'd'.repeat(32)) =>
      fetch(`${base}${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect((await post('/debug/sesi', { url: 'https://oss.go.id/' }, 'salah'.repeat(8))).status).toBe(401);
    expect((await post('/debug/sesi', { url: 'bukan url' })).status).toBe(422);
    expect((await post('/debug/sesi', { url: 'https://evil.example/' })).status).toBe(422);
    expect((await post('/debug/sesi', { adapterId: 'x', flowId: 'y' })).status).toBe(422);
    const alur = await post('/debug/sesi', { adapterId: 'oss-nib', flowId: 'cari_nib' });
    expect(alur.status).toBe(201);
    expect(((await alur.json()) as { urusanId: string }).urusanId).toMatch(/^debug-/);
    const res = await post('/debug/sesi', { url: 'https://oss.go.id/' });
    expect(res.status).toBe(201);
    const cookie = res.headers.get('set-cookie')!.split(';')[0]!;
    expect(cookie).toMatch(/^urusin_sid=[0-9a-f]{32}$/);
    const sesi = (await res.json()) as { sesiId: string };
    expect((await post('/debug/tiket', { sesiId: '00000000-0000-4000-8000-000000000000' })).status).toBe(404);
    const t = (await (await post('/debug/tiket', { sesiId: sesi.sesiId })).json()) as { tiket: string };
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/${sesi.sesiId}`, {
      origin: base,
      headers: { cookie },
    });
    const msgs: PendampingServerMessage[] = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d.toString()) as PendampingServerMessage));
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ type: 'halo', tiket: t.tiket }));
    await new Promise((r) => setTimeout(r, 50));
    expect(msgs[0]).toMatchObject({ type: 'status' });
    ws.close();
    expect(
      (
        await fetch(`${base}/debug/lain`, {
          method: 'POST',
          headers: { authorization: `Bearer ${'d'.repeat(32)}` },
        })
      ).status,
    ).toBe(404);
  });
});
