import { FakeProvider, fakeCompletion, type ChatParams } from '@urusin/llm';
import { describe, expect, it } from 'vitest';
import { prepareTurn, runTurn } from './agent.js';
import type { UrusinEvent as StreamEnvelope } from '@urusin/contracts';
import { DemoProvider } from './demo.js';
import { ConflictError, TurnInProgressError } from './errors.js';
import { jejakView, transparansiView } from './trace.js';
import { paramsHash } from './store.js';
import { FAKE_HP, FAKE_NIK, SIXTEEN_DIGIT_RUN, dumpDb, makeEnv } from './testing.js';
import type { UrusanState } from '@urusin/contracts';
import { buatUrusanTerwilayah } from './wilayah.js';

const types = (events: readonly StreamEnvelope[]) => events.map((e) => e.type);
const callNames = (p: FakeProvider) =>
  p.calls
    .flatMap((c) => (c.kind === 'create' ? [c.params] : []))
    .map((p) => p.tools?.map((t) => (t.type === 'function' ? t.function.name : '')) ?? []);

function advance(env: ReturnType<typeof makeEnv>, id: string, path: UrusanState[]) {
  let v = env.store.getUrusanOrThrow(id).version;
  for (const s of path) v = env.store.transition(id, v, s).version;
}

describe('alur normal dengan DemoProvider', () => {
  it('pertanyaan persyaratan: progress lalu grounded_answer; TANPA assistant_text mentah', async () => {
    const env = makeEnv({ provider: new DemoProvider() });
    const u = buatUrusanTerwilayah(env.store, { kodeKabKota: '3312' });
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'Apa syarat akta kelahiran anak saya?' });

    expect(out.status).toBe('selesai');
    const t = types(out.events);
    expect(t).toContain('progress');
    expect(t).toContain('grounded_answer');
    expect(t).not.toContain('assistant_text');
    expect(t.at(-1)).toBe('done');
    expect(t.indexOf('progress')).toBeLessThan(t.indexOf('grounded_answer'));

    const answer = out.events.find((e) => e.type === 'grounded_answer')!;
    const data = answer as Extract<typeof answer, { type: 'grounded_answer' }>;
    expect(data.klaim.length).toBeGreaterThan(0);
    expect(data.klaim[0]!.kutipan[0]!.textFragmentUrl).toContain('#:~:text=');
    expect(env.store.getUrusanOrThrow(u.id).jenis).toBe('kelahiran');
    expect(env.store.getUrusanOrThrow(u.id).state).toBe('RENCANA_DIUSULKAN');
    // Alur penuh DemoProvider (~1 detik sendiri); di runner CI paralel bisa melewati 5 detik bawaan.
  }, 20_000);

  it('sapaan: assistant_text biasa (non-persyaratan) tanpa tool', async () => {
    const env = makeEnv({ provider: new DemoProvider() });
    const u = env.store.createUrusan();
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'Halo' });
    expect(types(out.events)).toContain('assistant_text');
    expect(types(out.events)).not.toContain('grounded_answer');
  });

  it('semua event tercatat di rantai audit yang valid dan head cocok dengan event terakhir', async () => {
    const env = makeEnv({ provider: new DemoProvider() });
    const u = env.store.createUrusan();
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'Apa syarat KK baru?' });
    const head = out.events.at(-1)!.chainHead;
    expect(env.store.verifyChain(u.id, head)).toMatchObject({ ok: true, count: out.events.length });
  });

  it('riwayat percakapan tersimpan dan dipakai turn berikutnya', async () => {
    const provider = new DemoProvider();
    const env = makeEnv({ provider });
    const u = env.store.createUrusan();
    await runTurn(env.deps, { urusanId: u.id, userText: 'Halo' });
    await runTurn(env.deps, { urusanId: u.id, userText: 'Terima kasih' });
    const last = provider.calls.at(-1);
    const prompt = last?.kind === 'create' ? JSON.stringify(last.params.messages) : '';
    expect(prompt).toContain('Halo');
    expect(env.store.getUrusanOrThrow(u.id).turnCount).toBe(2);
  });
});

describe('tool per state dan nama bernamespace', () => {
  it('tool tulis tidak ditawarkan di MEMAHAMI tetapi ada di BERKAS_SIAP; urutan deterministik', async () => {
    const provider = new DemoProvider();
    const env = makeEnv({ provider });
    const u = env.store.createUrusan();
    await runTurn(env.deps, { urusanId: u.id, userText: 'Halo' });
    advance(env, u.id, ['RENCANA_DIUSULKAN', 'RENCANA_DISETUJUI', 'MENYIAPKAN_BERKAS', 'BERKAS_SIAP']);
    await runTurn(env.deps, { urusanId: u.id, userText: 'Halo lagi' });
    const names = callNames(provider).filter((n) => n.length > 0);
    expect(names[0]).not.toContain('dukcapil__ajukan_layanan');
    expect(names.at(-1)).toContain('dukcapil__ajukan_layanan');
    for (const list of names) {
      expect(list).toEqual([...list].sort());
      for (const n of list) expect(n).toMatch(/^[a-z0-9]+__[a-z0-9_]+$/);
      expect(list).not.toContain('dukcapil__klik_selesai');
    }
  });
});

describe('hand-off urusan__jawab_persyaratan mengikuti jenis urusan', () => {
  it('SKCK di Kota Depok diarahkan ke Polri/Polres, bukan Disdukcapil Depok', async () => {
    const provider = new FakeProvider({
      replies: [
        fakeCompletion({
          toolCalls: [
            {
              name: 'urusan__jawab_persyaratan',
              arguments: JSON.stringify({ pertanyaan: 'Apa syarat SKCK?' }),
            },
          ],
        }),
        fakeCompletion({ content: 'baik' }),
      ],
    });
    const env = makeEnv({ provider });
    const u = buatUrusanTerwilayah(env.store, { kodeKabKota: '3276', jenis: 'skck' });
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'Apa syarat SKCK?' });
    const h = out.events.find((e) => e.type === 'handoff');
    expect(h).toBeDefined();
    const handoff = h as Extract<typeof h, { type: 'handoff' }>;
    expect(handoff.kanal[0]?.nama).toMatch(/Polri|Kepolisian/);
    expect(handoff.kanal.some((k) => k.nama.includes('Polres') && k.nama.includes('Kota Depok'))).toBe(true);
    expect(handoff.kanal.some((k) => /Kependudukan|Dukcapil/i.test(k.nama))).toBe(false);
    expect(handoff.alasan).not.toMatch(/Kependudukan|silondomaju/);
  });
});

describe('policy gate (tool tulis)', () => {
  const ajukan = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({ kodeKabKota: '3312', layananId: 9, ...extra });

  function setup(replies: ReturnType<typeof fakeCompletion>[], now?: () => Date) {
    const provider = new FakeProvider({ replies });
    const env = makeEnv({ provider, ...(now ? { now } : {}) });
    const u = buatUrusanTerwilayah(env.store, { kodeKabKota: '3312', jenis: 'akta' });
    advance(env, u.id, [
      'MEMAHAMI',
      'RENCANA_DIUSULKAN',
      'RENCANA_DISETUJUI',
      'MENYIAPKAN_BERKAS',
      'BERKAS_SIAP',
    ]);
    return { provider, env, u };
  }

  it('tanpa confirmationId: ditolak (CONFIRMATION_REQUIRED), tidak ada execution_request', async () => {
    const { env, u } = setup([
      fakeCompletion({ toolCalls: [{ name: 'dukcapil__ajukan_layanan', arguments: ajukan() }] }),
      fakeCompletion({ content: 'Maaf, butuh konfirmasi.' }),
    ]);
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'ajukan sekarang' });
    const gate = out.events.find((e) => e.type === 'policy_gate')!;
    expect(gate).toMatchObject({ keputusan: 'deny', aturan: 'CONFIRMATION_REQUIRED' });
    expect(types(out.events)).not.toContain('execution_request');
  });

  it('konfirmasi yang cocok: lolos, menghasilkan execution_request, dan sekali pakai', async () => {
    const args = { kodeKabKota: '3312', layananId: 9 };
    const { env, u, provider } = setup([]);
    const conf = env.store.createConfirmation(u.id, 'dukcapil__ajukan_layanan', args);
    provider.enqueue(
      fakeCompletion({
        toolCalls: [{ name: 'dukcapil__ajukan_layanan', arguments: ajukan({ confirmationId: conf }) }],
      }),
      fakeCompletion({ content: 'Permintaan dikirim.' }),
      fakeCompletion({
        toolCalls: [{ name: 'dukcapil__ajukan_layanan', arguments: ajukan({ confirmationId: conf }) }],
      }),
      fakeCompletion({ content: 'ok' }),
    );
    const first = await runTurn(env.deps, { urusanId: u.id, userText: 'ya, ajukan' });
    const exec = first.events.find((e) => e.type === 'execution_request')!;
    expect(exec).toMatchObject({
      adapterId: 'telunjuk-sakti-wonogiri',
      flowId: 'ajukan',
      params: { layanan_id: 9 },
    });
    expect((exec as { paramsHash: string }).paramsHash).toBe(paramsHash('dukcapil__ajukan_layanan', args));

    const second = await runTurn(env.deps, { urusanId: u.id, userText: 'sekali lagi' });
    expect(types(second.events)).not.toContain('execution_request');
    expect(second.events.find((e) => e.type === 'policy_gate')!).toMatchObject({
      aturan: 'CONFIRMATION_MISMATCH',
    });
  });

  it('parameter berbeda dari yang disetujui warga ditolak', async () => {
    const { env, u, provider } = setup([]);
    const conf = env.store.createConfirmation(u.id, 'dukcapil__ajukan_layanan', {
      kodeKabKota: '3312',
      layananId: 9,
    });
    provider.enqueue(
      fakeCompletion({
        toolCalls: [
          { name: 'dukcapil__ajukan_layanan', arguments: ajukan({ layananId: 10, confirmationId: conf }) },
        ],
      }),
      fakeCompletion({ content: 'gagal' }),
    );
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'x' });
    expect(out.events.find((e) => e.type === 'policy_gate')!).toMatchObject({
      aturan: 'CONFIRMATION_MISMATCH',
    });
  });

  it('konfirmasi kedaluwarsa ditolak (jam palsu)', async () => {
    let t = new Date('2026-11-08T10:00:00.000Z').getTime();
    const { env, u, provider } = setup([], () => new Date(t));
    const conf = env.store.createConfirmation(
      u.id,
      'dukcapil__ajukan_layanan',
      { kodeKabKota: '3312', layananId: 9 },
      60_000,
    );
    t += 120_000;
    provider.enqueue(
      fakeCompletion({
        toolCalls: [{ name: 'dukcapil__ajukan_layanan', arguments: ajukan({ confirmationId: conf }) }],
      }),
      fakeCompletion({ content: 'gagal' }),
    );
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'x' });
    expect(out.events.find((e) => e.type === 'policy_gate')!).toMatchObject({
      aturan: 'CONFIRMATION_EXPIRED',
    });
  });

  it('konfirmasi urusan lain tidak berlaku', async () => {
    const { env, u, provider } = setup([]);
    const other = buatUrusanTerwilayah(env.store, { kodeKabKota: '3312' });
    const conf = env.store.createConfirmation(other.id, 'dukcapil__ajukan_layanan', {
      kodeKabKota: '3312',
      layananId: 9,
    });
    provider.enqueue(
      fakeCompletion({
        toolCalls: [{ name: 'dukcapil__ajukan_layanan', arguments: ajukan({ confirmationId: conf }) }],
      }),
      fakeCompletion({ content: 'gagal' }),
    );
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'x' });
    expect(types(out.events)).not.toContain('execution_request');
  });

  it('kota yang bukan kirim-asli: origin tidak ada → ditolak walau konfirmasi sah', async () => {
    const { env, u, provider } = setup([]);
    const args = { kodeKabKota: '3578', layananId: 9 };
    const conf = env.store.createConfirmation(u.id, 'dukcapil__ajukan_layanan', args);
    provider.enqueue(
      fakeCompletion({
        toolCalls: [
          { name: 'dukcapil__ajukan_layanan', arguments: JSON.stringify({ ...args, confirmationId: conf }) },
        ],
      }),
      fakeCompletion({ content: 'gagal' }),
    );
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'x' });
    expect(out.events.find((e) => e.type === 'policy_gate')!).toMatchObject({
      aturan: 'ORIGIN_NOT_OFFICIAL',
    });
  });

  it('tool final dan tool tak dikenal ditolak; placeholder/PII di parameter ditolak', async () => {
    const { env, u } = setup([
      fakeCompletion({ toolCalls: [{ name: 'dukcapil__klik_selesai', arguments: '{}' }] }),
      fakeCompletion({ toolCalls: [{ name: 'kirim_formulir', arguments: '{}' }] }),
      fakeCompletion({
        toolCalls: [
          { name: 'rag__cari_pengetahuan', arguments: JSON.stringify({ query: 'cek {{PEMOHON.NIK}}' }) },
        ],
      }),
      fakeCompletion({
        toolCalls: [
          { name: 'rag__cari_pengetahuan', arguments: JSON.stringify({ query: `nik ${FAKE_NIK}` }) },
        ],
      }),
      fakeCompletion({ content: 'selesai' }),
    ]);
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'x' });
    const rules = out.events
      .filter((e) => e.type === 'policy_gate')
      .map((e) => (e as { aturan: string }).aturan);
    expect(rules).toEqual([
      'FINAL_REQUIRES_CITIZEN',
      'UNKNOWN_TOOL',
      'PLACEHOLDER_OR_PII_IN_PARAM',
      'PLACEHOLDER_OR_PII_IN_PARAM',
    ]);
  });

  it('argumen bukan JSON → SCHEMA_INVALID', async () => {
    const { env, u } = setup([
      fakeCompletion({ toolCalls: [{ name: 'rag__cari_pengetahuan', arguments: '{bukan json' }] }),
      fakeCompletion({ content: 'ok' }),
    ]);
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'x' });
    expect(out.events.find((e) => e.type === 'policy_gate')!).toMatchObject({ aturan: 'SCHEMA_INVALID' });
  });
});

describe('degraded: JSON satu aksi (tanpa tools)', () => {
  it('berjalan lewat policy yang sama: aksi tulis tanpa konfirmasi ditolak', async () => {
    const provider = new FakeProvider({
      without: ['tools'],
      replies: [
        fakeCompletion({ content: JSON.stringify({ jenis: 'lainnya', keyakinan: 0.5 }) }),
        fakeCompletion({
          content: JSON.stringify({
            jenis: 'tool',
            nama: 'dukcapil__ajukan_layanan',
            argsJson: JSON.stringify({ kodeKabKota: '3312', layananId: 9 }),
            teks: null,
            confirmationId: null,
          }),
        }),
      ],
    });
    // json_schema strict hidup; tools mati.
    const env = makeEnv({ provider, caps: { tools: false } });
    const u = buatUrusanTerwilayah(env.store, { kodeKabKota: '3312' });
    advance(env, u.id, [
      'MEMAHAMI',
      'RENCANA_DIUSULKAN',
      'RENCANA_DISETUJUI',
      'MENYIAPKAN_BERKAS',
      'BERKAS_SIAP',
    ]);
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'ajukan' });
    expect(out.degraded).toBe(true);
    expect(out.events.find((e) => e.type === 'policy_gate')!).toMatchObject({
      keputusan: 'deny',
      aturan: 'CONFIRMATION_REQUIRED',
    });
    expect(types(out.events)).not.toContain('execution_request');
    const done = out.events.at(-1)!;
    expect(done).toMatchObject({ degraded: true, lanjutkan: true });
    // tidak ada panggilan yang membawa parameter tools
    expect(provider.calls.every((c) => c.kind !== 'create' || !c.params.tools?.length)).toBe(true);
  });

  it('DemoProvider tanpa tools: alur tetap jalan dalam beberapa turn ("lanjutkan")', async () => {
    const provider = new DemoProvider({ without: ['tools'] });
    const env = makeEnv({ provider, caps: { tools: false } });
    const u = buatUrusanTerwilayah(env.store, { kodeKabKota: '3312' });
    const t1 = await runTurn(env.deps, { urusanId: u.id, userText: 'Apa syarat akta kelahiran?' });
    expect(t1.events.at(-1)!).toMatchObject({ degraded: true, lanjutkan: true });
    const t2 = await runTurn(env.deps, { urusanId: u.id, userText: 'lanjut' });
    expect(
      types(t2.events).some((t) => t === 'grounded_answer' || t === 'handoff' || t === 'assistant_text'),
    ).toBe(true);
    expect(env.store.getUrusanOrThrow(u.id).turnCount).toBe(2);
  });
});

describe('timeout, pembatalan, konkurensi', () => {
  class SlowProvider extends FakeProvider {
    override async create(params: ChatParams, opts: { signal?: AbortSignal } = {}) {
      this.calls.push({ kind: 'create', params });
      return new Promise<never>((_, reject) => {
        opts.signal?.addEventListener('abort', () => reject(new Error('dibatalkan')), { once: true });
      });
    }
  }

  it('provider lambat dihentikan di batas turn; state konsisten dan urusan bisa dilanjutkan', async () => {
    const provider = new SlowProvider();
    const env = makeEnv({ provider, config: { turnTimeoutMs: 60, llmTimeoutMs: 10_000 } });
    const u = env.store.createUrusan({ jenis: 'akta' });
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'halo' });
    expect(out.status).toBe('timeout');
    expect(out.events.map((e) => e.type)).toContain('timeout');
    expect(out.events.at(-1)!).toMatchObject({ status: 'timeout' });
    const row = env.store.db.prepare('SELECT status FROM turns WHERE id = ?').get(out.turnId);
    expect(row).toEqual({ status: 'timeout' });
    expect(() => env.store.claimTurn(u.id, 'lagi')).not.toThrow();
  });

  it('klien putus (signal abort): tidak ada panggilan LLM berikutnya', async () => {
    const provider = new SlowProvider();
    const env = makeEnv({ provider, config: { turnTimeoutMs: 10_000 } });
    const u = env.store.createUrusan({ jenis: 'akta' });
    const ctrl = new AbortController();
    const p = runTurn(env.deps, { urusanId: u.id, userText: 'halo', signal: ctrl.signal });
    await new Promise((r) => setTimeout(r, 20));
    ctrl.abort();
    const out = await p;
    expect(out.status).toBe('dibatalkan');
    const callsAtAbort = provider.calls.length;
    await new Promise((r) => setTimeout(r, 50));
    expect(provider.calls.length).toBe(callsAtAbort);
    // done tetap dikirim saat batal agar versi terbaru sampai ke klien (tanpa 409 pada pesan berikutnya)
    const done = out.events.at(-1) as Extract<StreamEnvelope, { type: 'done' }>;
    expect(done).toMatchObject({ type: 'done', status: 'dibatalkan' });
    expect(done.version).toBe(env.store.getUrusanOrThrow(u.id).version);
  });

  it('turn kedua pada urusan yang sama saat turn pertama berjalan → 409, tanpa event ganda', async () => {
    const provider = new SlowProvider();
    const env = makeEnv({ provider, config: { turnTimeoutMs: 80 } });
    const u = env.store.createUrusan({ jenis: 'akta' });
    const first = prepareTurn(env.deps, { urusanId: u.id, userText: 'a' });
    expect(() => prepareTurn(env.deps, { urusanId: u.id, userText: 'b' })).toThrow(TurnInProgressError);
    const out = await first.run();
    expect(out.status).toBe('timeout');
    expect(env.store.getUrusanOrThrow(u.id).turnCount).toBe(1);
  });

  it('expectedVersion basi pada klaim → ConflictError', () => {
    const env = makeEnv({ provider: new DemoProvider() });
    const u = env.store.createUrusan();
    expect(() => prepareTurn(env.deps, { urusanId: u.id, userText: 'a', expectedVersion: 9 })).toThrow(
      ConflictError,
    );
    // kunci in-process dilepas saat klaim gagal
    expect(() => prepareTurn(env.deps, { urusanId: u.id, userText: 'a' })).not.toThrow();
  });

  it('rag__cari_pengetahuan: layanan teks bebas yang bukan kategori korpus tidak memaksa abstain', async () => {
    const provider = new FakeProvider({
      replies: [
        fakeCompletion({
          toolCalls: [
            {
              name: 'rag__cari_pengetahuan',
              arguments: JSON.stringify({ query: 'syarat akta kelahiran', layanan: 'akta kelahiran anak' }),
            },
          ],
        }),
        fakeCompletion({ content: 'Selesai.' }),
      ],
    });
    const env = makeEnv({ provider });
    const u = buatUrusanTerwilayah(env.store, { kodeKabKota: '3312', jenis: 'akta' });
    // Setelah rencana diusulkan: model sendiri yang memilih langkah sesudah pencarian (di MEMAHAMI harness langsung
    // menjalankan urusan__jawab_persyaratan).
    advance(env, u.id, ['MEMAHAMI', 'RENCANA_DIUSULKAN']);
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'syarat akta kelahiran?' });
    expect(types(out.events)).not.toContain('error');
    expect(env.store.getChunks(u.id).length).toBeGreaterThan(0);
  });

  it('catatan state tidak memisahkan assistant(tool_calls) dari hasil tool-nya (penyedia menolak: 400)', async () => {
    const call = (name: string, args: object) => ({ name, arguments: JSON.stringify(args) });
    const provider = new FakeProvider({
      replies: [
        fakeCompletion({ toolCalls: [call('rag__cari_pengetahuan', { query: 'syarat akta kelahiran' })] }),
        fakeCompletion({
          toolCalls: [
            call('rag__cari_pengetahuan', { query: 'akta kelahiran terlambat' }),
            call('rag__cari_pengetahuan', { query: 'biaya akta kelahiran' }),
          ],
        }),
        fakeCompletion({ content: 'Selesai.' }),
      ],
    });
    const env = makeEnv({ provider });
    const u = buatUrusanTerwilayah(env.store, { kodeKabKota: '3312', jenis: 'akta' });
    // Setelah rencana diusulkan: model sendiri yang memilih langkah sesudah pencarian (di MEMAHAMI harness langsung
    // menjalankan urusan__jawab_persyaratan).
    advance(env, u.id, ['MEMAHAMI', 'RENCANA_DIUSULKAN']);
    await runTurn(env.deps, { urusanId: u.id, userText: 'syarat akta kelahiran?' });
    const sent = provider.calls.flatMap((c) => (c.kind === 'create' ? [c.params.messages] : []));
    expect(sent).toHaveLength(3);
    for (const msgs of sent) {
      msgs.forEach((m, i) => {
        if (m.role !== 'assistant' || !m.tool_calls?.length) return;
        const ids = m.tool_calls.map((tc) => tc.id);
        const next = msgs.slice(i + 1, i + 1 + ids.length);
        expect(next.map((n) => n.role)).toEqual(ids.map(() => 'tool'));
        expect(next.map((n) => (n.role === 'tool' ? n.tool_call_id : null))).toEqual(ids);
      });
    }
    // Catatan state tetap ada di setiap panggilan (sebelum grup tool terakhir).
    for (const msgs of sent) expect(msgs.filter((m) => m.role === 'system')).toHaveLength(2);
  });

  it('rag__cari_pengetahuan: kategori sah tanpa hasil diulang tanpa filter', async () => {
    const provider = new FakeProvider({
      replies: [
        fakeCompletion({
          toolCalls: [
            {
              name: 'rag__cari_pengetahuan',
              arguments: JSON.stringify({ query: 'syarat akta kelahiran', layanan: 'samsat' }),
            },
          ],
        }),
        fakeCompletion({ content: 'Selesai.' }),
      ],
    });
    const env = makeEnv({ provider });
    const u = buatUrusanTerwilayah(env.store, { kodeKabKota: '3312', jenis: 'akta' });
    advance(env, u.id, ['MEMAHAMI']);
    await runTurn(env.deps, { urusanId: u.id, userText: 'syarat akta kelahiran?' });
    expect(env.store.getChunks(u.id).length).toBeGreaterThan(0);
  });

  it('rag__cari_pengetahuan: pencari produksi (ragSearch async) dipakai bila ada, dengan wilayah urusan', async () => {
    const provider = new FakeProvider({
      replies: [
        fakeCompletion({
          toolCalls: [{ name: 'rag__cari_pengetahuan', arguments: JSON.stringify({ query: 'syarat akta' }) }],
        }),
        fakeCompletion({ content: 'Selesai.' }),
      ],
    });
    const inputs: unknown[] = [];
    const ragSearch = async (input: unknown) => {
      inputs.push(input);
      return {
        mode: 'hybrid' as const,
        tanpaHasil: false,
        hasil: [
          {
            id: 'hybrid-1',
            text: 'Akta kelahiran: surat keterangan lahir (hasil hybrid + rerank).',
            skor: 0.9,
            kutipan: { url: 'https://contoh.go.id/akta', judul: 'Akta', instansi: 'Disdukcapil' },
            verifiedAt: '2026-11-01T00:00:00.000Z',
            kodeWilayah: '3312',
            layanan: 'adminduk',
          },
        ],
      };
    };
    const env = makeEnv({ provider, ragSearch });
    const u = buatUrusanTerwilayah(env.store, { kodeKabKota: '3312', jenis: 'akta' });
    advance(env, u.id, ['MEMAHAMI']);
    await runTurn(env.deps, { urusanId: u.id, userText: 'syarat akta kelahiran?' });
    expect(inputs).toEqual([{ query: 'syarat akta', kodeKabKota: '3312', k: 4 }]);
    expect(env.store.getChunks(u.id).map((c) => c.text)).toContain(
      'Akta kelahiran: surat keterangan lahir (hasil hybrid + rerank).',
    );
  });

  it('rag__cari_pengetahuan: layanan ditawarkan sebagai enum kategori; nilai lain diabaikan', async () => {
    const { ragCariPengetahuan } = await import('./builtin-tools.js');
    const { LAYANAN_KORPUS } = await import('@urusin/rag');
    const { z } = await import('zod');
    const schema = z.toJSONSchema(ragCariPengetahuan.input, {
      target: 'draft-7',
      io: 'input',
    }) as unknown as {
      properties: { layanan: { enum: string[]; description: string } };
    };
    expect(schema.properties.layanan.enum).toEqual([...LAYANAN_KORPUS]);
    expect(schema.properties.layanan.description).toMatch(/Kategori korpus/);
    expect(ragCariPengetahuan.input.parse({ query: 'a', layanan: 'akta kelahiran' })).toEqual({ query: 'a' });
    expect(ragCariPengetahuan.input.parse({ query: 'a', layanan: 'samsat' })).toEqual({
      query: 'a',
      layanan: 'samsat',
    });
  });

  it('batas langkah: model yang terus memanggil tool berhenti di maxSteps dengan error', async () => {
    const loop = () =>
      fakeCompletion({
        toolCalls: [{ name: 'rag__cari_pengetahuan', arguments: JSON.stringify({ query: 'akta' }) }],
      });
    const provider = new FakeProvider({ replies: Array.from({ length: 20 }, loop) });
    const env = makeEnv({ provider, config: { maxSteps: 3 } });
    const u = env.store.createUrusan({ jenis: 'akta' });
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'x' });
    expect(provider.calls).toHaveLength(3);
    expect(out.events.find((e) => e.type === 'error')!).toMatchObject({ kode: 'LLM_FAILED' });
  });
});

describe('error LLM bertipe (#22)', () => {
  it.each([
    ['refusal', { content: null, refusal: 'Maaf.' }, 'LLM_REFUSAL', false],
    ['content_filter', { content: '', finishReason: 'content_filter' as const }, 'LLM_CONTENT_FILTER', false],
  ])('%s → error event %s tanpa panggilan tambahan', async (_n, reply, kode, retry) => {
    const provider = new FakeProvider({ replies: [fakeCompletion(reply)] });
    const env = makeEnv({ provider });
    const u = env.store.createUrusan({ jenis: 'akta' });
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'x' });
    expect(out.status).toBe('galat');
    expect(out.events.find((e) => e.type === 'error')!).toMatchObject({ kode, bisaUlang: retry });
    expect(provider.calls).toHaveLength(1);
  });
});

describe('balasan terpotong (finish_reason=length)', () => {
  const potong = () => fakeCompletion({ content: 'terpot', finishReason: 'length' });

  it('diulang sekali dengan instruksi ringkas dan ruang token dua kali lipat', async () => {
    const provider = new FakeProvider({
      replies: [potong(), fakeCompletion({ content: 'Bisa, ini singkatnya.' })],
    });
    const env = makeEnv({ provider });
    const u = env.store.createUrusan({ jenis: 'akta' });
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'x' });
    expect(out.status).toBe('selesai');
    expect(out.events.some((e) => e.type === 'error')).toBe(false);
    const [a, b] = provider.calls.map((c) => (c.kind === 'create' ? c.params : undefined));
    expect(b!.max_tokens).toBe(a!.max_tokens! * 2);
    expect(JSON.stringify(b!.messages)).toMatch(/Balasanmu tadi terpotong/);
    expect(JSON.stringify(a!.messages)).not.toMatch(/Balasanmu tadi terpotong/);
  });

  it('klasifikasi terpotong (p06): turn tetap berjalan, jenis diklasifikasi ulang giliran berikutnya', async () => {
    const provider = new FakeProvider({
      replies: [potong(), fakeCompletion({ content: 'Bisa, Bapak/Ibu.' })],
    });
    const env = makeEnv({ provider });
    const u = env.store.createUrusan({});
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'Sa mau bikin kartu identitas anak.' });
    expect(out.status).toBe('selesai');
    expect(out.events.some((e) => e.type === 'error')).toBe(false);
    expect(env.store.getUrusanOrThrow(u.id).jenis).toBeNull();
    const c = provider.calls[0];
    expect(c?.kind === 'create' ? c.params.max_tokens : undefined).toBe(256);
  });

  it('terpotong lagi: error LLM_LENGTH (bisa diulang), tanpa ulangan ketiga', async () => {
    const provider = new FakeProvider({ replies: [potong(), potong(), fakeCompletion({ content: 'x' })] });
    const env = makeEnv({ provider });
    const u = env.store.createUrusan({ jenis: 'akta' });
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'x' });
    expect(out.status).toBe('galat');
    expect(out.events.find((e) => e.type === 'error')!).toMatchObject({
      kode: 'LLM_LENGTH',
      bisaUlang: true,
    });
    expect(provider.calls).toHaveLength(2);
  });
});

describe('kuota dan biaya (jam palsu)', () => {
  const prices = { inputPerMTok: 1_000_000, outputPerMTok: 1_000_000, audioPerMin: 0 };

  it('biaya IDR = usage × harga × kurs dan tercatat per urusan, span, dan hari', async () => {
    const provider = new FakeProvider({
      replies: [fakeCompletion({ content: 'Halo!', usage: { prompt_tokens: 1000, completion_tokens: 500 } })],
    });
    const env = makeEnv({ provider, prices, quota: { idrPerUsd: 10 } });
    const u = env.store.createUrusan({ jenis: 'akta' });
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'halo' });
    // (1500 token × $1/token) × 10 = 15.000 IDR
    expect(out.costIdr).toBeCloseTo(15_000);
    expect(env.store.getUrusanOrThrow(u.id).costIdr).toBeCloseTo(15_000);
    expect(env.store.dailyCostIdr()).toBeCloseTo(15_000);
    const span = env.store.db
      .prepare("SELECT cost_idr, tokens_in, tokens_out, model FROM spans WHERE operation = 'chat'")
      .get();
    expect(span).toMatchObject({ tokens_in: 1000, tokens_out: 500, model: 'fake-model' });
  });

  it('batas turn per sesi: turn ke-3 ditolak ramah (QUOTA + handoff) pada cap 2', async () => {
    const provider = new DemoProvider();
    const env = makeEnv({ provider, quota: { sessionTurnCap: 2 } });
    const u = buatUrusanTerwilayah(env.store, { kodeKabKota: '3312' });
    await runTurn(env.deps, { urusanId: u.id, userText: 'Halo' });
    await runTurn(env.deps, { urusanId: u.id, userText: 'Halo' });
    const third = await runTurn(env.deps, { urusanId: u.id, userText: 'Halo' });
    expect(types(third.events)).toContain('handoff');
    expect(third.events.find((e) => e.type === 'error')!).toMatchObject({
      kode: 'QUOTA',
      bisaUlang: false,
    });
  });

  it('cap harian global: 70% → mode hemat (max_tokens kecil); 100% → AI berhenti', async () => {
    let now = new Date('2026-11-08T03:00:00.000Z');
    const provider = new DemoProvider();
    const env = makeEnv({
      provider,
      now: () => now,
      quota: { dailyIdrCap: 1000, maxTokens: 1024, maxTokensHemat: 200 },
    });
    const u = env.store.createUrusan({ jenis: 'akta' });
    const maxTokensOfLastCall = () => {
      const last = [...provider.calls].reverse().find((c) => c.kind === 'create');
      return last?.kind === 'create' ? last.params.max_tokens : undefined;
    };
    await runTurn(env.deps, { urusanId: u.id, userText: 'Halo' });
    expect(maxTokensOfLastCall()).toBe(1024);

    env.store.addUsage(u.id, { tokensIn: 1, tokensOut: 1, costIdr: 750, degraded: false }); // 75% dari cap
    await runTurn(env.deps, { urusanId: u.id, userText: 'Halo' });
    expect(maxTokensOfLastCall()).toBe(200);

    env.store.addUsage(u.id, { tokensIn: 1, tokensOut: 1, costIdr: 300, degraded: false }); // > 100%
    const before = provider.calls.length;
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'Halo' });
    expect(provider.calls.length).toBe(before);
    expect(out.events.find((e) => e.type === 'error')!).toMatchObject({ kode: 'QUOTA' });

    now = new Date('2026-11-09T03:00:00.000Z'); // hari berikutnya: kuota baru
    const next = await runTurn(env.deps, { urusanId: u.id, userText: 'Halo' });
    expect(types(next.events)).toContain('assistant_text');
  });
});

describe('PII', () => {
  it('lapis 1: LLM tidak pernah melihat NIK/HP/email; DB tidak memuatnya', async () => {
    const provider = new DemoProvider();
    const env = makeEnv({ provider });
    const u = env.store.createUrusan();
    await runTurn(env.deps, {
      urusanId: u.id,
      userText: `Halo, NIK saya ${FAKE_NIK}, HP ${FAKE_HP}, email a${'@'}b.id. Apa syarat KK baru?`,
    });
    const seen = JSON.stringify(provider.calls);
    expect(seen).not.toMatch(SIXTEEN_DIGIT_RUN);
    expect(seen).not.toContain(FAKE_HP);
    expect(seen).toContain('{{PEMOHON.NIK}}');
    expect(dumpDb(env.store.db)).not.toMatch(SIXTEEN_DIGIT_RUN);
  });
});

describe('span OTel GenAI dan query /jejak /transparansi', () => {
  it('setiap LLM call, tool call, retrieval, dan gate mendapat span; tanpa isi prompt/respons', async () => {
    const provider = new DemoProvider();
    const env = makeEnv({ provider, prices: { inputPerMTok: 1, outputPerMTok: 2, audioPerMin: 0 } });
    const u = buatUrusanTerwilayah(env.store, { kodeKabKota: '3312' });
    await runTurn(env.deps, { urusanId: u.id, userText: 'Apa syarat akta kelahiran?' });
    const ops = new Set(
      (env.store.db.prepare('SELECT DISTINCT operation FROM spans').all() as { operation: string }[]).map(
        (r) => r.operation,
      ),
    );
    expect(ops).toEqual(new Set(['chat', 'retrieval', 'execute_tool', 'urusin.gate']));
    const dump = (env.store.db.prepare('SELECT * FROM spans').all() as Record<string, unknown>[])
      .map((r) => JSON.stringify(r))
      .join('\n');
    expect(dump).not.toContain('syarat akta kelahiran');
    expect(dump).not.toContain('Menurut sumber resmi');
    const modes = env.store.db
      .prepare('SELECT structured_mode FROM spans WHERE structured_mode IS NOT NULL')
      .all();
    expect(modes.length).toBeGreaterThan(0);
  });

  it('jejakView: timeline gabungan event+span, rantai valid; manipulasi terdeteksi', async () => {
    const env = makeEnv({ provider: new DemoProvider() });
    const u = env.store.createUrusan();
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'Apa syarat KK baru?' });
    const head = out.events.at(-1)!.chainHead;
    const view = jejakView(env.store, u.id, head);
    expect(view.rantai.valid).toBe(true);
    expect(view.timeline.some((t) => t.jenis === 'span')).toBe(true);
    expect(view.timeline.some((t) => t.jenis === 'event')).toBe(true);
    const ats = view.timeline.map((t) => t.at);
    expect(ats).toEqual([...ats].sort());

    env.store.db.prepare('UPDATE events SET payload = \'{"x":1}\' WHERE urusan_id = ? AND seq = 2').run(u.id);
    const tampered = jejakView(env.store, u.id, head);
    expect(tampered.rantai).toMatchObject({ valid: false, rusakDiSeq: 2 });
  });

  it('transparansiView: p50/p95, biaya per hari, porsi degraded', async () => {
    const env = makeEnv({
      provider: new DemoProvider(),
      prices: { inputPerMTok: 1, outputPerMTok: 1, audioPerMin: 0 },
    });
    const u = env.store.createUrusan();
    await runTurn(env.deps, { urusanId: u.id, userText: 'Halo' });
    const v = transparansiView(env.store.db);
    expect(v.latensiMs.sampel).toBeGreaterThan(0);
    expect(v.latensiMs.p95).toBeGreaterThanOrEqual(v.latensiMs.p50);
    expect(v.biayaPerHariIdr.length).toBe(1);
    expect(v.persenDegraded).toBe(0);
    expect(v.totalPermintaan).toBeGreaterThan(0);
  });
});

describe('versi urusan sampai ke klien (regresi 409 pada pesan lanjutan)', () => {
  it('event done membawa versi terbaru; expectedVersion dari done diterima turn berikutnya', async () => {
    const env = makeEnv({ provider: new DemoProvider() });
    const u = buatUrusanTerwilayah(env.store, { kodeKabKota: '3312' });
    let expected = env.store.getUrusanOrThrow(u.id).version;
    for (const teks of ['halo', 'Apa syarat akta kelahiran anak saya?', 'terima kasih']) {
      const out = await runTurn(env.deps, { urusanId: u.id, userText: teks, expectedVersion: expected });
      const done = out.events.at(-1) as Extract<StreamEnvelope, { type: 'done' }>;
      expect(done.type).toBe('done');
      expect(done.version).toBe(env.store.getUrusanOrThrow(u.id).version);
      expected = done.version!;
    }
  });
  it('tanpa memakai versi dari done, versi klaim turn membuat versi lama basi (409 asli)', async () => {
    const env = makeEnv({ provider: new DemoProvider() });
    const u = buatUrusanTerwilayah(env.store, { kodeKabKota: '3312' });
    const v0 = env.store.getUrusanOrThrow(u.id).version;
    await runTurn(env.deps, { urusanId: u.id, userText: 'halo', expectedVersion: v0 });
    expect(() => prepareTurn(env.deps, { urusanId: u.id, userText: 'lagi', expectedVersion: v0 })).toThrow(
      ConflictError,
    );
  });
});
