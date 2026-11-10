import { ADAPTERS, buildProgram } from '@urusin/adapters';
import { FakeProvider, fakeCompletion } from '@urusin/llm';
import { describe, expect, it } from 'vitest';
import type { UrusinEvent } from '@urusin/contracts';
import { runTurn } from './agent.js';
import { alurBaca, builtinTools, dukcapilCekStatus } from './builtin-tools.js';
import { paramsHash } from './store.js';
import { makeEnv } from './testing.js';
import type { ToolContext } from './tools.js';

type Exec = Extract<UrusinEvent, { type: 'execution_request' }>;
type Gate = Extract<UrusinEvent, { type: 'gate' }>;

async function panggil(name: string, args: Record<string, unknown>, kodeKabKota?: string) {
  const provider = new FakeProvider({
    replies: [
      fakeCompletion({ toolCalls: [{ name, arguments: JSON.stringify(args) }] }),
      fakeCompletion({ content: 'Silakan izinkan.' }),
    ],
  });
  const env = makeEnv({ provider });
  // Jenis sudah diketahui: tanpa klasifikasi niat, balasan pertama model langsung memanggil tool.
  const u = env.store.createUrusan({ jenis: 'cek', ...(kodeKabKota ? { kodeKabKota } : {}) });
  const out = await runTurn(env.deps, { urusanId: u.id, userText: 'Tolong cek.' });
  return { out, env, u, provider };
}

const kasus = [
  {
    tool: 'dukcapil__cek_status',
    args: { kodeKabKota: '3578' },
    adapterId: 'klampid-surabaya',
    flowId: 'cek_status',
    origin: 'https://wargaklampid-dispendukcapil.surabaya.go.id',
    jujur: /Tampilan situs asli belum teramati/,
  },
  {
    tool: 'dukcapil__cek_status',
    args: { kodeKabKota: '3374' },
    adapterId: 'sidnok-semarang',
    flowId: 'cek_status',
    origin: 'https://sidnok.semarangkota.go.id',
    jujur: /pertanyaan keamanan/,
  },
  {
    tool: 'dukcapil__cek_status',
    args: { kodeKabKota: '3312' },
    adapterId: 'telunjuk-sakti-wonogiri',
    flowId: 'cek_status',
    origin: 'https://telunjuksakti.wonogirikab.go.id',
    jujur: /kata sandi dan CAPTCHA sendiri/,
  },
  {
    tool: 'samsat__cek_pkb',
    args: {},
    adapterId: 'samsat-dki',
    flowId: 'cek_pkb',
    origin: 'https://samsat-pkb2.jakarta.go.id',
    jujur: /Hanya kendaraan terdaftar di Samsat DKI Jakarta.*Struktur halaman hasil belum teramati/,
  },
  {
    tool: 'oss__cari_nib',
    args: {},
    adapterId: 'oss-nib',
    flowId: 'cari_nib',
    origin: 'https://oss.go.id',
    jujur: /Turnstile\) Anda selesaikan sendiri/,
  },
] as const;

describe('tool baca-saja Browser Pendamping', () => {
  it('dukcapil__cek_status tanpa konteks urusan (dipanggil langsung oleh e2e pendamping): pakai argumen', () => {
    const ctx = {} as ToolContext;
    const out = dukcapilCekStatus.execute(ctx, { kodeKabKota: '3374' }) as Awaited<
      ReturnType<typeof dukcapilCekStatus.execute>
    >;
    expect(out.execution).toMatchObject({ adapterId: 'sidnok-semarang', flowId: 'cek_status' });
    expect(dukcapilCekStatus.origin?.({ kodeKabKota: '3374' }, undefined as never)).toBe(
      ADAPTERS['sidnok-semarang']!.origin,
    );
  });

  for (const k of kasus) {
    it(`${k.tool} ${JSON.stringify(k.args)} -> execution_request ${k.adapterId}/${k.flowId} lalu gate konfirmasi`, async () => {
      const { out } = await panggil(k.tool, k.args);
      const t = out.events.map((e) => e.type);
      const iExec = t.indexOf('execution_request');
      expect(iExec).toBeGreaterThan(-1);
      const exec = out.events[iExec] as Exec;
      expect(exec).toMatchObject({
        adapterId: k.adapterId,
        flowId: k.flowId,
        origin: k.origin,
        bacaSaja: true,
        params: {},
        tool: k.tool,
        paramsHash: paramsHash(k.tool, k.args),
      });
      expect(exec.executionId).toMatch(/^x_[0-9a-f-]{36}$/);
      expect(exec.ringkasan).toMatch(/Baca saja, tidak ada yang dikirim\./);
      // Baca saja bukan tingkat semi (semi = Browser Pendamping bisa mengisi/mengirim).
      expect(exec.ringkasan).toMatch(/lewat Browser Pendamping\./);
      expect(exec.ringkasan).not.toMatch(/tingkat semi/);
      expect(exec.ringkasan).toMatch(k.jujur);
      // Gate SESUDAH permintaan, dengan pasangan tool + paramsHash yang sama (kartu konfirmasi + POST /konfirmasi).
      const gate = out.events.slice(iExec + 1).find((e) => e.type === 'gate') as Gate | undefined;
      expect(gate).toMatchObject({ jenis: 'konfirmasi', tool: k.tool, paramsHash: exec.paramsHash });
      // Program adapter benar-benar bisa dibangun dari permintaan ini (origin resmi + aturan DSL).
      const built = buildProgram(exec.adapterId, exec.flowId, exec.params);
      expect(built.ok && built.program.origin).toBe(k.origin);
      // Tidak ada tool tulis: tidak perlu confirmationId, tidak ada policy_gate allow.
      expect(t).not.toContain('policy_gate');
      // Giliran warga: turn berakhir setelah tool, model tidak dipanggil lagi.
      expect(t.at(-1)).toBe('done');
    });
  }

  it('kota tanpa alur cek status: jujur dipandu, tanpa execution_request', async () => {
    const { out, provider } = await panggil('dukcapil__cek_status', { kodeKabKota: '3573' });
    expect(out.events.map((e) => e.type)).not.toContain('execution_request');
    const hasilTool = provider.calls
      .flatMap((c) => (c.kind === 'create' ? c.params.messages : []))
      .find((m) => m.role === 'tool');
    expect(JSON.stringify(hasilTool)).toMatch(/tingkat dipandu untuk cek status/);
    expect(JSON.stringify(hasilTool)).toMatch(/SIAPEL/);
  });

  it('kode di luar registry: tidak ada portal, warga diarahkan ke kanal resmi (nasional)', () => {
    const ctx = { urusan: { kodeKabKota: null } } as unknown as ToolContext;
    const r = dukcapilCekStatus.execute(ctx, { kodeKabKota: '9999' });
    expect(r).toMatchObject({
      content: expect.stringMatching(/kanal nasional https:\/\/dukcapil\.kemendagri\.go\.id/),
    });
    expect((r as { execution?: unknown }).execution).toBeUndefined();
    expect(dukcapilCekStatus.origin?.({ kodeKabKota: '9999' }, { urusan: {} as never })).toBeUndefined();
  });

  it('input tidak menerima nilai pribadi: argumen tambahan dibuang, params tetap kosong', async () => {
    const { out } = await panggil('samsat__cek_pkb', { nopol: 'B 1234 XYZ' });
    const exec = out.events.find((e) => e.type === 'execution_request') as Exec;
    expect(exec.params).toEqual({});
    expect(JSON.stringify(out.events)).not.toContain('1234');
  });

  it('alurBaca: hanya alur baca-saja adapter bawaan', () => {
    expect(alurBaca('telunjuk-sakti-wonogiri', 'ajukan')).toBeUndefined();
    expect(alurBaca('tidak-ada', 'cek_status')).toBeUndefined();
    expect(alurBaca(undefined, 'cek_status')).toBeUndefined();
    expect(alurBaca('samsat-dki', 'tidak-ada')).toBeUndefined();
    expect(alurBaca('constructor', 'cek_status')).toBeUndefined();
    // Setiap alur baca-saja bawaan punya tool yang menawarkannya.
    const baca = Object.entries(ADAPTERS).flatMap(([id, a]) =>
      Object.entries(a.flows).flatMap(([f, fl]) => (fl.bacaSaja ? [`${id}/${f}`] : [])),
    );
    expect(baca.sort()).toEqual(kasus.map((k) => `${k.adapterId}/${k.flowId}`).sort());
    const nama = builtinTools().map((t) => t.name);
    for (const n of ['dukcapil__cek_status', 'samsat__cek_pkb', 'oss__cari_nib']) expect(nama).toContain(n);
  });
});
