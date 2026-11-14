/* eslint-disable @typescript-eslint/no-explicit-any -- tes membaca JSON respons tanpa tipe */
import { GalatApiSchema, UrusinEventSchema, SKEMA_FIXTURE } from '@urusin/contracts';
import { DemoProvider } from '@urusin/harness';
import { FakeProvider, type ChatParams } from '@urusin/llm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as wilayah } from '../../routes/api/wilayah/+server';
import { GET as pengetahuan } from '../../routes/api/pengetahuan/+server';
import { GET as peristiwa } from '../../routes/api/peristiwa/[slug]/+server';
import { GET as transparansi } from '../../routes/api/transparansi/+server';
import { GET as daftarUrusan, POST as buatUrusan } from '../../routes/api/urusan/+server';
import { GET as jejak } from '../../routes/api/urusan/[id]/jejak/+server';
import { POST as konfirmasi } from '../../routes/api/urusan/[id]/konfirmasi/+server';
import { POST as setujuiRencana } from '../../routes/api/urusan/[id]/rencana/setujui/+server';
import { GET as statusUrusan } from '../../routes/api/urusan/[id]/+server';
import { GET as stream } from '../../routes/api/urusan/[id]/stream/+server';
import { POST as kirimTurn } from '../../routes/api/urusan/[id]/turn/+server';
import { POST as tetapkanWilayah } from '../../routes/api/urusan/[id]/wilayah/+server';
import { GET as devSse } from '../../routes/dev/fixtures/sse/+server';
import { catatHasilEksekusi } from './eksekusi';
import {
  agentConfigFromEnv,
  createRuntime,
  llmAktif,
  piiKeyFromEnv,
  quotaFromEnv,
  setRuntimeForTests,
  visionModelDari,
  type Runtime,
} from './runtime';

describe('visionModelDari', () => {
  it('LLM_VISION_MODEL bila ada, model agen bila tidak; tidak ada bila kapabilitas vision mati', () => {
    expect(visionModelDari({ agent: 'agen', vision: 'visi' }, { vision: true })).toBe('visi');
    expect(visionModelDari({ agent: 'agen' }, { vision: true })).toBe('agen');
    expect(visionModelDari({ agent: 'agen', vision: 'visi' }, { vision: false })).toBeUndefined();
  });
});

const ORIGIN = 'http://localhost:3000';
// NIK sintetis, dirakit agar pemindai PII repo tidak menandai berkas ini
const NIK = ['3271', '0101', '0190', '0001'].join('');

let rt: Runtime;
function setup(provider = new DemoProvider(), config: Partial<Runtime['config']> = {}) {
  rt = createRuntime({
    provider,
    config: { dbPath: ':memory:', heartbeatMs: 15_000, disconnectGraceMs: 0, ...config },
  });
  setRuntimeForTests(rt);
}
beforeEach(() => setup());
afterEach(() => {
  setRuntimeForTests(undefined);
  vi.unstubAllEnvs();
});

const post = (body: unknown) =>
  new Request('http://localhost:3000/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify(body),
  });
const get = (path = '/x', headers: Record<string, string> = {}) =>
  new Request(`http://localhost:3000${path}`, { headers });
const ev = (request: Request, params: Record<string, string> = {}) =>
  ({
    request,
    params,
    url: new URL(request.url),
    locals: { sid: 'sid-uji' },
    getClientAddress: () => '127.0.0.1',
  }) as never;

class Slow extends FakeProvider {
  override async create(params: ChatParams, opts: { signal?: AbortSignal } = {}) {
    this.calls.push({ kind: 'create', params });
    return new Promise<never>((_, rej) =>
      opts.signal?.addEventListener('abort', () => rej(new Error('x')), { once: true }),
    );
  }
}

/** Baca frame SSE sampai predikat terpenuhi (atau habis). */
async function readFrames(res: Response, until: (frames: string[]) => boolean, maxMs = 5000) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const frames: string[] = [];
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const { value } = await Promise.race([
      reader.read(),
      new Promise<{ value: undefined; done: true }>((r) =>
        setTimeout(() => r({ value: undefined, done: true }), 200),
      ),
    ]);
    if (value) buf += dec.decode(value);
    for (let i = buf.indexOf('\n\n'); i !== -1; i = buf.indexOf('\n\n')) {
      frames.push(buf.slice(0, i));
      buf = buf.slice(i + 2);
    }
    if (until(frames)) break;
  }
  await reader.cancel();
  return frames;
}
const hasDone = (f: string[]) => f.some((x) => x.includes('event: done'));
const jumlahEvent = (f: string[]) => f.filter((x) => x.includes('event:')).length;

const parse = (frame: string) => {
  const lines = frame.split('\n');
  const get = (k: string) => lines.find((l) => l.startsWith(`${k}: `))?.slice(k.length + 2);
  return {
    id: get('id'),
    event: get('event'),
    data: get('data') ? (JSON.parse(get('data')!) as Record<string, any>) : undefined,
  };
};

async function mulai(pesan: string) {
  const res = await buatUrusan(ev(post({ pesan, kodeKabKota: '3312' })));
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; turnId: string; state: string; chainHead: string };
}
async function selesaikan(id: string) {
  await readFrames(await stream(ev(get('/s'), { id })), hasDone);
}
async function kosong() {
  const r = await buatUrusan(ev(post({})));
  return ((await r.json()) as { id: string }).id;
}

describe('POST /api/urusan dan /turn', () => {
  // Batas eksplisit: tes paling lambat di berkas ini (~1-2 dtk sendirian dan di turbo paralel penuh).
  it('membuat urusan, turn berjalan di latar belakang, event datar lolos skema kontrak', async () => {
    // Wilayah dulu: warga menyebut kab/kota KTP-nya, jadi agen langsung menetapkannya lalu menjawab bersumber.
    const u = await mulai('Apa syarat akta kelahiran anak saya? KTP saya Kabupaten Wonogiri.');
    expect(u.id).toMatch(/^u_[0-9a-f]{32}$/);
    const res = await stream(ev(get('/s'), { id: u.id }));
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const frames = await readFrames(res, hasDone);
    const events = frames.map(parse).filter((f) => f.event);
    const types = events.map((e) => e.event);
    expect(types).toEqual(
      expect.arrayContaining(['wilayah', 'state', 'progress', 'grounded_answer', 'done']),
    );
    expect(events.filter((e) => e.event === 'wilayah').map((e) => e.data!.status)).toEqual([
      'usulan',
      'ditetapkan',
    ]);
    // Jawaban bersumber tidak mengakhiri giliran: balasan model (bila ada) baru tampil sesudahnya.
    if (types.includes('assistant_text'))
      expect(types.lastIndexOf('assistant_text')).toBeGreaterThan(types.indexOf('grounded_answer'));
    expect(types.at(-1)).toBe('done');
    expect(events.map((e) => Number(e.id))).toEqual(events.map((_, i) => i + 1));
    for (const e of events)
      expect(UrusinEventSchema.safeParse(e.data).success, JSON.stringify(e.data)).toBe(true);
    const answer = events.find((e) => e.event === 'grounded_answer')!.data!;
    expect(answer.klaim[0].kutipan[0].textFragmentUrl).toContain('#:~:text=');
  }, 20_000);

  it('turn kedua: 202; turn yang masih berjalan → 409 tanpa event ganda', async () => {
    setup(new Slow() as never);
    const id = await kosong();
    const a = await kirimTurn(ev(post({ teks: 'halo' }), { id }));
    expect(a.status).toBe(202);
    const b = await kirimTurn(ev(post({ teks: 'halo lagi' }), { id }));
    expect(b.status).toBe(409);
    const j = await b.json();
    expect(j.kode).toBe('TURN_IN_PROGRESS');
    expect(GalatApiSchema.safeParse(j).success).toBe(true);
    expect(rt.store.getUrusanOrThrow(id).turnCount).toBe(1);
    rt.running.get(id)?.abort();
  });

  it('turn bergambar: data URL gambar valid → 202; bukan data URL gambar → 422', async () => {
    const id = await kosong();
    const salah = await kirimTurn(
      ev(post({ teks: 'ini apa?', gambar: ['https://contoh.invalid/a.jpg'] }), { id }),
    );
    expect(salah.status).toBe(422);
    const terlalu = await kirimTurn(
      ev(post({ teks: 'ini apa?', gambar: Array(4).fill('data:image/jpeg;base64,AAAA') }), { id }),
    );
    expect(terlalu.status).toBe(422);
    const ok = await kirimTurn(
      ev(post({ teks: 'ini apa?', gambar: ['data:image/jpeg;base64,AAAA'] }), { id }),
    );
    expect(ok.status).toBe(202);
    for (let i = 0; i < 200 && rt.running.has(id); i++) await new Promise((r) => setTimeout(r, 10));
    // Mode demo tanpa model vision: progress baca gambar tidak muncul, agen diminta berterus terang.
    const progress = rt.store
      .eventsAfter(id, 0)
      .filter((e) => e.type === 'progress')
      .map((e) => (e.payload as { label?: string }).label);
    expect(progress).not.toContain('Membaca gambar lampiran…');
  });

  it('pesan lanjutan dengan versi dari done diterima (tanpa 409); status menyebut berjalan atau tidak', async () => {
    const id = await kosong();
    let version = rt.store.getUrusanOrThrow(id).version;
    for (const teks of ['halo', 'Apa syarat akta kelahiran anak saya?', 'terima kasih']) {
      const res = await kirimTurn(ev(post({ teks, expectedVersion: version }), { id }));
      expect(res.status).toBe(202);
      for (let i = 0; i < 200 && rt.running.has(id); i++) await new Promise((r) => setTimeout(r, 10));
      const st = await (await statusUrusan(ev(get(), { id }))).json();
      expect(st).toMatchObject({ id, berjalan: false });
      const events = rt.store.eventsAfter(id, 0);
      const done = events.filter((e) => e.type === 'done').at(-1)?.payload as
        { version?: number } | undefined;
      expect(done?.version).toBe(st.version);
      version = done!.version!;
    }
  }, 20_000);

  it('status urusan: berjalan saat turn hidup; 404 untuk id tak dikenal', async () => {
    setup(new Slow() as never);
    const id = await kosong();
    await kirimTurn(ev(post({ teks: 'halo' }), { id }));
    expect((await (await statusUrusan(ev(get(), { id }))).json()).berjalan).toBe(true);
    expect((await statusUrusan(ev(get(), { id: 'u_tidak_ada' }))).status).toBe(404);
    rt.running.get(id)?.abort();
  });

  it('expectedVersion basi → 409; urusan tak dikenal → 404', async () => {
    const id = await kosong();
    const stale = await kirimTurn(ev(post({ teks: 'halo', expectedVersion: 7 }), { id }));
    expect(stale.status).toBe(409);
    expect((await stale.json()).kode).toBe('CONFLICT');
    expect((await kirimTurn(ev(post({ teks: 'halo' }), { id: 'u_tidak_ada' }))).status).toBe(404);
  });

  it('body berpola NIK ditolak 422 tanpa menggemakan isi, dan tidak ada urusan tersimpan', async () => {
    const res = await buatUrusan(ev(post({ pesan: `NIK saya ${NIK}` })));
    expect(res.status).toBe(422);
    const text = await res.text();
    expect(text).toContain('PII_IN_PAYLOAD');
    expect(text).not.toContain(NIK);
    expect(rt.store.db.prepare('SELECT COUNT(*) n FROM urusan').get()).toEqual({ n: 0 });
  });

  it('body tidak valid → 400/422 dengan bentuk galat seragam', async () => {
    const bad = await buatUrusan(
      ev(
        new Request('http://localhost:3000/x', {
          method: 'POST',
          headers: { origin: ORIGIN },
          body: 'bukan json',
        }),
      ),
    );
    expect(bad.status).toBe(400);
    expect(GalatApiSchema.safeParse(await bad.json()).success).toBe(true);
    expect((await buatUrusan(ev(post({ kodeKabKota: 'abc' })))).status).toBe(422);
  });
});

describe('GET /api/urusan (daftar untuk /lacak)', () => {
  it('mengembalikan hanya id yang diminta dan dikenal, dengan menunggu siapa', async () => {
    const a = await kosong();
    const b = await kosong();
    const res = await daftarUrusan(ev(get(`/api/urusan?ids=${a},u_${'f'.repeat(32)},ngawur`)));
    const j = await res.json();
    expect(j.urusan.map((x: any) => x.id)).toEqual([a]);
    expect(SKEMA_FIXTURE.daftar_urusan.safeParse(j).success).toBe(true);
    expect(j.urusan[0].menunggu).toBe('sistem');
    expect(b).not.toBe(a);
  });
  it('tanpa ids → kosong; lebih dari 50 → 422', async () => {
    expect(await (await daftarUrusan(ev(get('/api/urusan')))).json()).toEqual({ urusan: [] });
    const many = Array.from({ length: 51 }, (_, i) => `u_${i.toString(16).padStart(32, 'a')}`).join(',');
    expect((await daftarUrusan(ev(get(`/api/urusan?ids=${many}`)))).status).toBe(422);
  });
});

describe('pemilik urusan: id saja tidak cukup', () => {
  /** Peminta lain: cookie sesi lain, atau akun yang masuk tetapi bukan pemiliknya. */
  const evSebagai = (locals: App.Locals, request: Request, params: Record<string, string> = {}) =>
    ({
      request,
      params,
      url: new URL(request.url),
      locals,
      getClientAddress: () => '127.0.0.1',
    }) as never;
  const GATE = { type: 'gate', jenis: 'konfirmasi', pesan: 'Setujui?', tool: 't', paramsHash: 'h' } as const;

  async function semuaRute(id: string, locals: App.Locals) {
    const p = { id };
    const r = {
      status: await statusUrusan(evSebagai(locals, get('/s'), p)),
      turn: await kirimTurn(evSebagai(locals, post({ teks: 'halo' }), p)),
      stream: await stream(evSebagai(locals, get('/s'), p)),
      jejak: await jejak(evSebagai(locals, get('/j'), p)),
      konfirmasi: await konfirmasi(evSebagai(locals, post({ tool: 't', paramsHash: 'h' }), p)),
      setujui: await setujuiRencana(evSebagai(locals, post({}), p)),
      wilayah: await tetapkanWilayah(evSebagai(locals, post({ kodeKabKota: '3312' }), p)),
    };
    return r;
  }

  it('cookie sesi lain → 404 yang sama dengan urusan tak dikenal di SEMUA rute urusan; daftar kosong', async () => {
    const id = await kosong(); // pemilik: sid-uji
    rt.publish(id, GATE);
    const asing = await semuaRute(id, { sid: 'sid-lain' });
    const takAda = await semuaRute(`u_${'f'.repeat(32)}`, { sid: 'sid-uji' });
    for (const [rute, res] of Object.entries(asing)) {
      expect(res.status, rute).toBe(404);
      expect(await res.json(), rute).toEqual(await takAda[rute as keyof typeof takAda].json());
    }
    // Tidak ada efek samping: tidak ada turn, tidak ada persetujuan, state tidak bergerak.
    expect(rt.store.db.prepare('SELECT COUNT(*) n FROM turns').get()).toEqual({ n: 0 });
    expect(rt.store.activeConfirmations(id)).toEqual([]);
    expect(rt.store.eventsOfType(id, 'wilayah', 20)).toEqual([]);
    expect(rt.store.getUrusanOrThrow(id).kodeKabKota).toBeNull();
    const daftar = await daftarUrusan(evSebagai({ sid: 'sid-lain' }, get(`/api/urusan?ids=${id}`)));
    expect(await daftar.json()).toEqual({ urusan: [] });
    // Pemilik tetap bisa.
    expect((await statusUrusan(ev(get('/s'), { id }))).status).toBe(200);
    expect((await konfirmasi(ev(post({ tool: 't', paramsHash: 'h' }), { id }))).status).toBe(201);
  });

  it('urusan akun (juri): akun lain dan cookie sesi saja → 404; akun pemilik dari perangkat lain → 200', async () => {
    const juri = rt.akun.buatDemo({ ip: '10.0.0.1' }).akun;
    const lain = rt.akun.buatDemo({ ip: '10.0.0.2' }).akun;
    const res = await buatUrusan(evSebagai({ sid: 'sid-uji', akun: juri }, post({ kodeKabKota: '3312' })));
    const { id } = (await res.json()) as { id: string };
    for (const locals of [{ sid: 'sid-uji', akun: lain }, { sid: 'sid-uji' }])
      for (const [rute, r] of Object.entries(await semuaRute(id, locals))) expect(r.status, rute).toBe(404);
    expect((await statusUrusan(evSebagai({ sid: 'sid-hp', akun: juri }, get('/s'), { id }))).status).toBe(
      200,
    );
  });

  it('urusan lama tanpa catatan pemilik: ditolak (gagal tertutup)', async () => {
    const u = rt.store.createUrusan({ kodeKabKota: '3312' });
    expect((await statusUrusan(ev(get('/s'), { id: u.id }))).status).toBe(404);
  });
});

describe('POST /konfirmasi dan hasil eksekusi', () => {
  const GATE = {
    type: 'gate',
    jenis: 'konfirmasi',
    pesan: 'Setujui?',
    tool: 'dukcapil__ajukan_layanan',
    paramsHash: 'h1',
  } as const;

  it('konfirmasi hanya untuk tool+hash yang pernah ditawarkan lewat event gate', async () => {
    const id = await kosong();
    const tanpa = await konfirmasi(ev(post({ tool: GATE.tool, paramsHash: 'h1' }), { id }));
    expect(tanpa.status).toBe(404);
    expect((await tanpa.json()).kode).toBe('KONFIRMASI_TIDAK_DITAWARKAN');

    rt.publish(id, GATE);
    const salah = await konfirmasi(ev(post({ tool: GATE.tool, paramsHash: 'lain' }), { id }));
    expect(salah.status).toBe(404);
    const ok = await konfirmasi(ev(post({ tool: GATE.tool, paramsHash: 'h1' }), { id }));
    expect(ok.status).toBe(201);
    const j = await ok.json();
    expect(j.confirmationId).toMatch(/^c_/);
    expect(rt.store.activeConfirmations(id).map((c) => c.id)).toEqual([j.confirmationId]);
  });

  it('endpoint execution-result (sisa ekstensi) sudah tidak ada: hasil hanya lewat status Browser Pendamping', () => {
    const rute = Object.keys(import.meta.glob('../../routes/api/urusan/**/+server.ts'));
    expect(rute.length).toBeGreaterThan(5);
    expect(rute.filter((r) => r.includes('execution-result'))).toEqual([]);
  });

  it('hasil eksekusi: dicatat sekali, drift → DIPANDU', async () => {
    const id = await kosong();
    const ok = catatHasilEksekusi(rt, rt.store.getUrusanOrThrow(id), 'x_1', 'drift', 'Browser Pendamping');
    expect(ok?.state).toBe('DIPANDU');
    const dup = catatHasilEksekusi(
      rt,
      rt.store.getUrusanOrThrow(id),
      'x_1',
      'berhasil',
      'Browser Pendamping',
    );
    expect(dup).toBeNull();
    const types = rt.store.eventsAfter(id, 0).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['degraded', 'state']));
  });

  it('hasil berhasil dari MENUNGGU_SUBMIT_WARGA → TERKIRIM', async () => {
    const id = await kosong();
    let v = rt.store.getUrusanOrThrow(id).version;
    for (const s of [
      'MEMAHAMI',
      'RENCANA_DIUSULKAN',
      'RENCANA_DISETUJUI',
      'MENYIAPKAN_BERKAS',
      'BERKAS_SIAP',
      'MENGISI',
      'MENUNGGU_KONFIRMASI',
      'MENGUNGGAH',
      'MENUNGGU_SUBMIT_WARGA',
    ] as const)
      v = rt.store.transition(id, v, s).version;
    const u = catatHasilEksekusi(rt, rt.store.getUrusanOrThrow(id), 'x_2', 'berhasil', 'Browser Pendamping');
    expect(u?.state).toBe('TERKIRIM');
  });
});

describe('GET /stream: resume, heartbeat, putus koneksi', () => {
  it('Last-Event-ID memutar ulang hanya event setelah seq itu dari tabel events', async () => {
    const u = await mulai('Apa syarat KK baru?');
    await selesaikan(u.id);
    const all = rt.store.eventsAfter(u.id, 0);
    const resumed = await stream(ev(get('/s', { 'last-event-id': String(all.length - 2) }), { id: u.id }));
    const frames = (await readFrames(resumed, (f) => jumlahEvent(f) >= 2, 1500))
      .map(parse)
      .filter((f) => f.event);
    expect(frames.map((f) => Number(f.id))).toEqual([all.length - 1, all.length]);
    expect(frames.at(-1)!.event).toBe('done');
    const q = await stream(ev(get(`/s?lastEventId=${all.length}`), { id: u.id }));
    expect((await readFrames(q, () => false, 300)).filter((f) => f.includes('event:'))).toEqual([]);
  });

  it('heartbeat berupa event bernama tanpa id (Last-Event-ID tidak bergeser)', async () => {
    setup(new DemoProvider(), { heartbeatMs: 20 });
    const id = await kosong();
    const frames = await readFrames(
      await stream(ev(get('/s'), { id })),
      (f) => f.filter((x) => x.startsWith('event: heartbeat')).length >= 2,
    );
    const hb = frames.filter((x) => x.startsWith('event: heartbeat'));
    expect(hb.length).toBeGreaterThanOrEqual(2);
    for (const h of hb) {
      expect(h).not.toContain('id:');
      expect(UrusinEventSchema.safeParse(parse(h).data).success).toBe(true);
    }
  });

  it('klien putus: loop LLM dibatalkan dan tidak ada panggilan LLM berikutnya', async () => {
    const slow = new Slow();
    setup(slow as never, { disconnectGraceMs: 0 });
    const u = await mulai('halo');
    const ctrl = new AbortController();
    const res = await stream(
      ev(new Request('http://localhost:3000/s', { signal: ctrl.signal }), { id: u.id }),
    );
    const reader = res.body!.getReader();
    await reader.read();
    await new Promise((r) => setTimeout(r, 30));
    expect(rt.running.has(u.id)).toBe(true);
    ctrl.abort();
    await new Promise((r) => setTimeout(r, 80));
    const callsAfter = slow.calls.length;
    await new Promise((r) => setTimeout(r, 80));
    expect(slow.calls.length).toBe(callsAfter);
    expect(rt.store.db.prepare('SELECT status FROM turns WHERE urusan_id = ?').get(u.id)).toEqual({
      status: 'aborted',
    });
    expect(rt.running.has(u.id)).toBe(false);
  });

  it('temuan 9: masa tenggang tidak membatalkan turn yang LEBIH BARU dari yang berjalan saat koneksi putus', async () => {
    const slow = new Slow();
    setup(slow as never, { disconnectGraceMs: 60 });
    const u = await mulai('halo');
    const ctrl = new AbortController();
    const res = await stream(
      ev(new Request('http://localhost:3000/s', { signal: ctrl.signal }), { id: u.id }),
    );
    await res.body!.getReader().read();
    await new Promise((r) => setTimeout(r, 30));
    ctrl.abort();
    const lama = rt.running.get(u.id)!;
    const baru = new AbortController();
    rt.running.set(u.id, baru);
    await new Promise((r) => setTimeout(r, 150));
    expect(baru.signal.aborted).toBe(false);
    expect(lama.signal.aborted).toBe(false);
    lama.abort();
  });

  it('urusan tak dikenal → 404', async () => {
    expect((await stream(ev(get('/s'), { id: 'u_x' }))).status).toBe(404);
  });
});

describe('GET /jejak dan /transparansi', () => {
  it('jejak: timeline event+span, rantai valid; head klien yang basi menandai tidak valid', async () => {
    const u = await mulai('Apa syarat akta kelahiran?');
    await selesaikan(u.id);
    const head = rt.store.chainHead(u.id);
    const ok = await (await jejak(ev(get(`/j?head=${head}`), { id: u.id }))).json();
    expect(SKEMA_FIXTURE.jejak.safeParse(ok).success).toBe(true);
    expect(ok.rantai.valid).toBe(true);
    expect(ok.timeline.some((t: { jenis: string }) => t.jenis === 'span')).toBe(true);
    const bad = await (await jejak(ev(get('/j?head=deadbeef'), { id: u.id }))).json();
    expect(bad.rantai.valid).toBe(false);
  });

  it('transparansi: p50/p95, biaya per hari, porsi degraded', async () => {
    const u = await mulai('Halo');
    await selesaikan(u.id);
    const v = await (await transparansi(ev(get('/t')))).json();
    expect(SKEMA_FIXTURE.transparansi.safeParse(v).success).toBe(true);
    expect(v.latensiMs.sampel).toBeGreaterThan(0);
  });
});

describe('GET referensi: wilayah, peristiwa, pengetahuan', () => {
  it('wilayah memuat kota dengan tier dan validasi', async () => {
    const j = await (await wilayah(ev(get('/w')))).json();
    expect(SKEMA_FIXTURE.wilayah.safeParse(j).success).toBe(true);
    expect(j.kota.find((k: any) => k.kodeKabKota === '3312')).toMatchObject({
      tier: 'semi',
      validasi: 'kirim-asli',
    });
  });

  it('peristiwa: langkah + sumber; kodeKabKota menentukan tier; slug/kode salah ditolak', async () => {
    const res = await peristiwa(ev(get('/p?kodeKabKota=3312'), { slug: 'kelahiran' }));
    const j = await res.json();
    expect(SKEMA_FIXTURE.peristiwa.safeParse(j).success, JSON.stringify(j).slice(0, 300)).toBe(true);
    expect(j.kota.kodeKabKota).toBe('3312');
    expect(j.langkah.length).toBeGreaterThan(0);
    const tanpaKota = await (await peristiwa(ev(get('/p'), { slug: 'kelahiran' }))).json();
    expect(tanpaKota.kota).toBeNull();
    expect((await peristiwa(ev(get('/p'), { slug: 'tidak-ada' }))).status).toBe(404);
    expect((await peristiwa(ev(get('/p?kodeKabKota=12'), { slug: 'kelahiran' }))).status).toBe(422);
  });

  it('pengetahuan: hasil bersumber atau abstain; PII dan kueri kosong ditolak', async () => {
    const ok = await (await pengetahuan(ev(get('/k?q=syarat+akta+kelahiran&kodeKabKota=3312')))).json();
    expect(SKEMA_FIXTURE.pengetahuan.safeParse(ok).success).toBe(true);
    expect(ok.hasil.length).toBeGreaterThan(0);
    expect(ok.hasil[0].url).toMatch(/^https:/);
    const none = await (await pengetahuan(ev(get('/k?q=zzzzqqqq')))).json();
    expect(none.hasil).toEqual([]);
    expect(none.abstain).not.toBeNull();
    expect((await pengetahuan(ev(get(`/k?q=${NIK}`)))).status).toBe(422);
    expect((await pengetahuan(ev(get('/k?q=a')))).status).toBe(422);
  });
});

describe('GET /dev/fixtures/sse: hanya mode dev', () => {
  it('produksi (DEV=false) → 404 untuk daftar maupun pemutaran', async () => {
    vi.stubEnv('DEV', false);
    for (const q of ['', '?skenario=urusan/jawaban-bersumber']) {
      const res = await devSse(ev(get(`/dev/fixtures/sse${q}`)));
      expect(res.status, q).toBe(404);
      expect(GalatApiSchema.safeParse(await res.json()).success).toBe(true);
    }
  });

  it('dev: daftar skenario, lalu memutar event fixture berurutan lewat SSE', async () => {
    vi.stubEnv('DEV', true);
    const list = await (await devSse(ev(get('/dev/fixtures/sse')))).json();
    expect(list.skenario).toContain('urusan/jawaban-bersumber');
    const res = await devSse(ev(get('/dev/fixtures/sse?skenario=urusan/jawaban-bersumber&jeda=0')));
    const frames = await readFrames(res, hasDone, 2000);
    const events = frames.map(parse).filter((f) => f.event);
    expect(events.map((e) => e.event)).toContain('grounded_answer');
    expect(events.at(-1)!.event).toBe('done');
    for (const e of events) expect(UrusinEventSchema.safeParse(e.data).success).toBe(true);
  });

  it('dev: Last-Event-ID melanjutkan dari seq berikutnya; nama tak dikenal/berbahaya → 404', async () => {
    vi.stubEnv('DEV', true);
    const res = await devSse(
      ev(get('/dev/fixtures/sse?skenario=urusan/jawaban-bersumber&jeda=0', { 'last-event-id': '3' })),
    );
    const frames = (await readFrames(res, hasDone, 2000)).map(parse).filter((f) => f.event);
    expect(Number(frames[0]!.id)).toBe(4);
    for (const bad of ['urusan/tidak-ada', '../x', 'urusan/../../etc']) {
      expect(
        (await devSse(ev(get(`/dev/fixtures/sse?skenario=${encodeURIComponent(bad)}`)))).status,
        bad,
      ).toBe(404);
    }
  });
});

describe('temuan 2: PII di balik escape JSON dan pemecahan bidang ditolak 422', () => {
  const HP = ['0812', '3456', '7890'].join('');
  const duaBelas = NIK.slice(4);
  const kasus: [string, unknown][] = [
    ['baris baru (escape \n) sebelum HP', { pesan: `hp saya:\n${HP}` }],
    ['tab dan petik di sekitar NIK', { pesan: `"nik"\t${NIK}` }],
    ['NIK bersepasi', { pesan: [0, 4, 8, 12].map((i) => NIK.slice(i, i + 4)).join('  ') }],
    ['NIK terpecah: kodeKabKota + pesan', { kodeKabKota: NIK.slice(0, 4), pesan: duaBelas }],
    ['bersarang dalam objek/array', { pesan: 'halo', lain: { a: [`kontak ${HP}`] } }],
  ];

  it.each(kasus)('buat urusan: %s', async (_n, body) => {
    const res = await buatUrusan(ev(post(body as never)));
    expect(res.status).toBe(422);
    const teks = await res.text();
    expect(teks).not.toContain(HP);
    expect(teks).not.toContain(duaBelas);
  });

  it('turn: NIK terpecah memakai kodeKabKota urusan yang tersimpan', async () => {
    const r = await buatUrusan(ev(post({ kodeKabKota: NIK.slice(0, 4) })));
    const { id } = (await r.json()) as { id: string };
    const res = await kirimTurn(ev(post({ teks: `nomornya ${duaBelas}` }), { id }));
    expect(res.status).toBe(422);
    expect(rt.store.getUrusanOrThrow(id).turnCount).toBe(0);
  });
});

describe('temuan 5: kuota harian wajib di mode LLM', () => {
  it.each([
    ['tanpa URUSIN_DAILY_IDR_CAP', {}],
    ['0 (tanpa batas)', { URUSIN_DAILY_IDR_CAP: '0' }],
    ['NaN', { URUSIN_DAILY_IDR_CAP: 'abc' }],
    ['Infinity', { URUSIN_DAILY_IDR_CAP: 'Infinity' }],
    ['negatif', { URUSIN_DAILY_IDR_CAP: '-5' }],
    ['kuota sesi NaN', { URUSIN_DAILY_IDR_CAP: '50000', URUSIN_SESSION_TURN_CAP: 'x' }],
  ])('menolak boot: %s', (_n, env) => {
    expect(() => quotaFromEnv(env)).toThrow();
  });

  it('menerima batas harian berhingga > 0', () => {
    expect(quotaFromEnv({ URUSIN_DAILY_IDR_CAP: '50000' }).dailyIdrCap).toBe(50000);
  });

  it('batas token jawaban dari env; bawaan lega untuk model bernalar', () => {
    expect(quotaFromEnv({ URUSIN_DAILY_IDR_CAP: '50000' })).toMatchObject({
      maxTokens: 16_000,
      maxTokensHemat: 8_000,
    });
    expect(
      quotaFromEnv({
        URUSIN_DAILY_IDR_CAP: '50000',
        URUSIN_LLM_MAX_TOKENS: '32000',
        URUSIN_LLM_MAX_TOKENS_HEMAT: '4000',
      }),
    ).toMatchObject({ maxTokens: 32_000, maxTokensHemat: 4_000 });
    expect(() => quotaFromEnv({ URUSIN_DAILY_IDR_CAP: '50000', URUSIN_LLM_MAX_TOKENS: 'x' })).toThrow();
  });
});

describe('agentConfigFromEnv', () => {
  it('bawaan: giliran 300 dtk, panggilan LLM 180 dtk, 12 langkah', () => {
    expect(agentConfigFromEnv({})).toEqual({ turnTimeoutMs: 300_000, llmTimeoutMs: 180_000, maxSteps: 12 });
  });
  it('dibaca dari env; nilai tidak valid menolak boot', () => {
    expect(
      agentConfigFromEnv({
        URUSIN_TURN_TIMEOUT_MS: '600000',
        URUSIN_LLM_CALL_TIMEOUT_MS: '240000',
        URUSIN_AGENT_MAX_STEPS: '16',
      }),
    ).toEqual({ turnTimeoutMs: 600_000, llmTimeoutMs: 240_000, maxSteps: 16 });
    expect(() => agentConfigFromEnv({ URUSIN_AGENT_MAX_STEPS: '0' })).toThrow();
    expect(() => agentConfigFromEnv({ URUSIN_TURN_TIMEOUT_MS: 'abc' })).toThrow();
  });
});

describe('URUSIN_LLM_DISABLED', () => {
  const llm = { LLM_BASE_URL: 'http://127.0.0.1:9/v1', LLM_API_KEY: 'k', LLM_AGENT_MODEL: 'm' };
  it('1 memaksa mode demo walau LLM_* lengkap; nilai lain tidak', () => {
    expect(llmAktif(llm)).toBe(true);
    expect(llmAktif({ ...llm, URUSIN_LLM_DISABLED: '1' })).toBe(false);
    expect(llmAktif({ ...llm, URUSIN_LLM_DISABLED: '0' })).toBe(true);
    expect(llmAktif({ ...llm, LLM_API_KEY: '' })).toBe(false);
  });
});

describe('URUSIN_PII_KEY', () => {
  const kunci = Buffer.alloc(32, 7).toString('base64');
  it('mode LLM wajib dan minimal 32 byte; dev boleh kosong', () => {
    expect(() => piiKeyFromEnv({}, true)).toThrow();
    expect(() => piiKeyFromEnv({ URUSIN_PII_KEY: Buffer.alloc(16, 1).toString('base64') }, true)).toThrow();
    expect(() => piiKeyFromEnv({ URUSIN_PII_KEY: 'bukan-base64-pendek' }, false)).toThrow();
    expect(piiKeyFromEnv({}, false)).toBeUndefined();
    expect(piiKeyFromEnv({ URUSIN_PII_KEY: kunci }, true)).toBe(kunci);
  });
});
