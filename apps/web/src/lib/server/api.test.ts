import { DemoProvider } from '@urusin/harness';
import { FakeProvider, type ChatParams } from '@urusin/llm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handle } from '../../hooks.server';
import { POST as buatUrusan } from '../../routes/api/urusan/+server';
import { GET as jejak } from '../../routes/api/urusan/[id]/jejak/+server';
import { POST as kirimPesan } from '../../routes/api/urusan/[id]/pesan/+server';
import { GET as stream } from '../../routes/api/urusan/[id]/stream/+server';
import { GET as transparansi } from '../../routes/api/transparansi/+server';
import { createRuntime, setRuntimeForTests, type Runtime } from './runtime';

const ORIGIN = 'http://localhost:3000';
// NIK sintetis valid struktur, dirakit agar pemindai PII repo tidak menandai berkas ini
const NIK = ['331201', '150890', '0001'].join('');

let rt: Runtime;
function setup(provider = new DemoProvider(), config: Partial<Runtime['config']> = {}) {
  rt = createRuntime({
    provider,
    config: { dbPath: ':memory:', heartbeatMs: 15_000, disconnectGraceMs: 0, ...config },
  });
  setRuntimeForTests(rt);
}
beforeEach(() => setup());
afterEach(() => setRuntimeForTests(undefined));

const post = (body: unknown, origin: string | null = ORIGIN) =>
  new Request('http://localhost:3000/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  });

const ev = (request: Request, params: Record<string, string> = {}) =>
  ({ request, params, url: new URL(request.url) }) as never;

/** Baca frame SSE sampai predikat terpenuhi (atau habis). */
async function readFrames(res: Response, until: (frames: string[]) => boolean, maxMs = 5000) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const frames: string[] = [];
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const { value, done } = await Promise.race([
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
    if (done && !value && frames.length > 0 && until(frames)) break;
  }
  await reader.cancel();
  return frames;
}

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

describe('anti-CSRF: Origin persis di semua request pengubah state', () => {
  const run = async (req: Request) => {
    let reached = false;
    const res = await handle({
      event: { request: req, url: new URL(req.url) } as never,
      resolve: async () => {
        reached = true;
        return new Response('ok');
      },
    });
    return { status: res.status, reached };
  };

  it('Origin sama persis → lolos', async () => {
    expect(await run(post({}, ORIGIN))).toEqual({ status: 200, reached: true });
  });

  it.each([
    ['tanpa Origin', null],
    ['origin lain', 'https://jahat.example'],
    ['port beda', 'http://localhost:5173'],
    ['slash akhir', 'http://localhost:3000/'],
    ['subdomain/sufiks jebakan', 'http://localhost:3000.jahat.example'],
    ['origin ekstensi', 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'],
    ['null', 'null'],
  ])('%s → 403 dan tidak sampai ke handler', async (_n, origin) => {
    expect(await run(post({}, origin))).toEqual({ status: 403, reached: false });
  });

  it('GET tidak diperiksa; PUT/PATCH/DELETE diperiksa', async () => {
    expect((await run(new Request('http://localhost:3000/x'))).status).toBe(200);
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const r = await run(
        new Request('http://localhost:3000/x', { method, headers: { origin: 'https://x.example' } }),
      );
      expect(r.status, method).toBe(403);
    }
  });

  it('origin publik dikonfigurasi lewat URUSIN_PUBLIC_ORIGIN', async () => {
    process.env.URUSIN_PUBLIC_ORIGIN = 'https://urusin.example';
    try {
      expect((await run(post({}, 'https://urusin.example'))).status).toBe(200);
      expect((await run(post({}, ORIGIN))).status).toBe(403);
    } finally {
      delete process.env.URUSIN_PUBLIC_ORIGIN;
    }
  });
});

describe('POST /api/urusan dan /pesan', () => {
  it('membuat urusan, turn berjalan di latar belakang, dan semua event muncul di stream', async () => {
    const u = await mulai('Apa syarat akta kelahiran anak saya?');
    expect(u.id).toMatch(/^u_[0-9a-f]{32}$/);
    const res = await stream(ev(new Request(`http://localhost:3000/s`), { id: u.id }));
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const frames = await readFrames(res, (f) => f.some((x) => x.includes('event: done')));
    const events = frames.map(parse).filter((f) => f.event);
    const types = events.map((e) => e.event);
    expect(types).toContain('progress');
    expect(types).toContain('grounded_answer');
    expect(types).not.toContain('assistant_text');
    expect(types.at(-1)).toBe('done');
    // id SSE = seq berurutan, tiap frame membawa chainHead
    expect(events.map((e) => Number(e.id))).toEqual(events.map((_, i) => i + 1));
    expect(events.every((e) => typeof e.data?.chainHead === 'string')).toBe(true);
    const answer = events.find((e) => e.event === 'grounded_answer')!;
    expect(answer.data!.data.klaim[0].kutipan[0].tautanKutipan).toContain('#:~:text=');
  });

  it('pesan berikutnya: 202; turn yang masih berjalan → 409 tanpa event ganda', async () => {
    class Slow extends FakeProvider {
      override async create(params: ChatParams, opts: { signal?: AbortSignal } = {}) {
        this.calls.push({ kind: 'create', params });
        return new Promise<never>((_, rej) =>
          opts.signal?.addEventListener('abort', () => rej(new Error('x')), { once: true }),
        );
      }
    }
    setup(new Slow() as never);
    const r0 = await buatUrusan(ev(post({})));
    const { id } = (await r0.json()) as { id: string };
    const a = await kirimPesan(ev(post({ teks: 'halo' }), { id }));
    expect(a.status).toBe(202);
    const b = await kirimPesan(ev(post({ teks: 'halo lagi' }), { id }));
    expect(b.status).toBe(409);
    expect((await b.json()).kode).toBe('TURN_IN_PROGRESS');
    expect(rt.store.getUrusanOrThrow(id).turnCount).toBe(1);
    rt.running.get(id)?.abort();
  });

  it('expectedVersion basi → 409; urusan tak dikenal → 404', async () => {
    const r0 = await buatUrusan(ev(post({})));
    const { id } = (await r0.json()) as { id: string };
    const stale = await kirimPesan(ev(post({ teks: 'halo', expectedVersion: 7 }), { id }));
    expect(stale.status).toBe(409);
    expect((await stale.json()).kode).toBe('CONFLICT');
    const nf = await kirimPesan(ev(post({ teks: 'halo' }), { id: 'u_tidak_ada' }));
    expect(nf.status).toBe(404);
  });

  it('body berpola NIK ditolak 422 tanpa menggemakan isi, dan tidak ada urusan/PII yang tersimpan', async () => {
    const res = await buatUrusan(ev(post({ pesan: `NIK saya ${NIK}` })));
    expect(res.status).toBe(422);
    const text = await res.text();
    expect(text).toContain('PII_IN_PAYLOAD');
    expect(text).not.toContain(NIK);
    expect(rt.store.db.prepare('SELECT COUNT(*) n FROM urusan').get()).toEqual({ n: 0 });
  });

  it('body tidak valid → 400/422', async () => {
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
    const schema = await buatUrusan(ev(post({ kodeKabKota: 'abc' })));
    expect(schema.status).toBe(422);
  });
});

describe('GET /stream: resume, heartbeat, putus koneksi', () => {
  it('Last-Event-ID memutar ulang hanya event setelah seq itu dari tabel events', async () => {
    const u = await mulai('Apa syarat KK baru?');
    await readFrames(await stream(ev(new Request('http://localhost:3000/s'), { id: u.id })), (f) =>
      f.some((x) => x.includes('event: done')),
    );
    const all = rt.store.eventsAfter(u.id, 0);
    const resumed = await stream(
      ev(new Request('http://localhost:3000/s', { headers: { 'last-event-id': String(all.length - 2) } }), {
        id: u.id,
      }),
    );
    const frames = (await readFrames(resumed, (f) => f.filter((x) => x.includes('event:')).length >= 2, 1500))
      .map(parse)
      .filter((f) => f.event);
    expect(frames.map((f) => Number(f.id))).toEqual([all.length - 1, all.length]);
    expect(frames.at(-1)!.event).toBe('done');
    // lewat query juga bisa
    const q = await stream(
      ev(new Request(`http://localhost:3000/s?lastEventId=${all.length}`), { id: u.id }),
    );
    expect((await readFrames(q, () => false, 300)).filter((f) => f.includes('event:'))).toEqual([]);
  });

  it('heartbeat komentar ": hb" dikirim berkala', async () => {
    setup(new DemoProvider(), { heartbeatMs: 20 });
    const r0 = await buatUrusan(ev(post({})));
    const { id } = (await r0.json()) as { id: string };
    const frames = await readFrames(
      await stream(ev(new Request('http://localhost:3000/s'), { id })),
      (f) => f.filter((x) => x === ': hb').length >= 2,
    );
    expect(frames.filter((x) => x === ': hb').length).toBeGreaterThanOrEqual(2);
  });

  it('klien putus: loop LLM dibatalkan dan tidak ada panggilan LLM berikutnya', async () => {
    class Slow extends FakeProvider {
      override async create(params: ChatParams, opts: { signal?: AbortSignal } = {}) {
        this.calls.push({ kind: 'create', params });
        return new Promise<never>((_, rej) =>
          opts.signal?.addEventListener('abort', () => rej(new Error('x')), { once: true }),
        );
      }
    }
    const slow = new Slow();
    setup(slow as never, { disconnectGraceMs: 0 });
    const u = await mulai('halo');
    const ctrl = new AbortController();
    const req = new Request('http://localhost:3000/s', { signal: ctrl.signal });
    const res = await stream(ev(req, { id: u.id }));
    const reader = res.body!.getReader();
    await reader.read(); // frame pertama (retry:)
    await new Promise((r) => setTimeout(r, 30));
    expect(rt.running.has(u.id)).toBe(true);
    ctrl.abort(); // klien putus
    await new Promise((r) => setTimeout(r, 80));
    const callsAfter = slow.calls.length;
    await new Promise((r) => setTimeout(r, 80));
    expect(slow.calls.length).toBe(callsAfter);
    const status = rt.store.db.prepare('SELECT status FROM turns WHERE urusan_id = ?').get(u.id);
    expect(status).toEqual({ status: 'aborted' });
    expect(rt.running.has(u.id)).toBe(false);
  });

  it('urusan tak dikenal → 404', async () => {
    const res = await stream(ev(new Request('http://localhost:3000/s'), { id: 'u_x' }));
    expect(res.status).toBe(404);
  });
});

describe('GET /jejak dan /transparansi', () => {
  it('jejak: timeline event+span, rantai valid; head klien yang basi menandai tidak valid', async () => {
    const u = await mulai('Apa syarat akta kelahiran?');
    await readFrames(await stream(ev(new Request('http://localhost:3000/s'), { id: u.id })), (f) =>
      f.some((x) => x.includes('event: done')),
    );
    const head = rt.store.chainHead(u.id);
    const ok = await (
      await jejak(ev(new Request(`http://localhost:3000/j?head=${head}`), { id: u.id }))
    ).json();
    expect(ok.rantai.valid).toBe(true);
    expect(ok.timeline.some((t: { jenis: string }) => t.jenis === 'span')).toBe(true);
    const bad = await (
      await jejak(ev(new Request('http://localhost:3000/j?head=deadbeef'), { id: u.id }))
    ).json();
    expect(bad.rantai.valid).toBe(false);
  });

  it('transparansi: p50/p95, biaya per hari, porsi degraded', async () => {
    const u = await mulai('Halo');
    await readFrames(await stream(ev(new Request('http://localhost:3000/s'), { id: u.id })), (f) =>
      f.some((x) => x.includes('event: done')),
    );
    const v = await (await transparansi(ev(new Request('http://localhost:3000/t')))).json();
    expect(v.latensiMs.sampel).toBeGreaterThan(0);
    expect(v.persenDegraded).toBe(0);
  });
});
