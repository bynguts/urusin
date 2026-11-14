import { FakeProvider, fakeCompletion, type ChatParams } from '@urusin/llm';
import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_CONFIG, runTurn } from './agent.js';
import { BALASAN_DI_LUAR_URUSAN } from './intent.js';
import { buildStateNote, buildSystemPrompt } from './prompt.js';
import { DEFAULT_QUOTA } from './quota.js';
import { makeEnv } from './testing.js';

// Model bernalar dilepas: jawaban tanpa batas panjang buatan, effort penalaran per peran, tanggal hari ini.

const NOW = new Date('2026-11-14T10:00:00Z');

const createParams = (p: FakeProvider): ChatParams[] =>
  p.calls.flatMap((c) => (c.kind === 'create' ? [c.params] : []));

const teksSistem = (params: ChatParams) =>
  params.messages
    .filter((m) => m.role === 'system')
    .map((m) => (typeof m.content === 'string' ? m.content : ''))
    .join('\n');

describe('batas bawaan untuk model bernalar', () => {
  it('token jawaban lega; timeout dan langkah agen lega', () => {
    expect(DEFAULT_QUOTA).toMatchObject({ maxTokens: 16_000, maxTokensHemat: 8_000 });
    expect(DEFAULT_AGENT_CONFIG).toEqual({ turnTimeoutMs: 300_000, llmTimeoutMs: 180_000, maxSteps: 12 });
  });

  it('prompt sistem tidak lagi membatasi panjang balasan ke 4 kalimat', () => {
    const p = buildSystemPrompt();
    expect(p).not.toContain('paling banyak 4 kalimat pendek');
    expect(p).toContain(
      'Jawab selengkap yang dibutuhkan warga: ringkas untuk hal sederhana, lengkap dan terstruktur (daftar bernomor, subjudul) untuk urusan berlapis. Ikuti gaya bahasa warga.',
    );
  });
});

describe('tanggal hari ini di catatan state', () => {
  it('buildStateNote menulis tanggal WIB dari jam agen', () => {
    const note = buildStateNote({
      state: 'MEMAHAMI',
      jenis: null,
      kodeKabKota: null,
      tools: [],
      confirmations: [],
      // 14 Nov 2026 20:00 UTC = 15 Nov 2026 03:00 WIB.
      now: new Date('2026-11-14T20:00:00Z'),
    });
    expect(note.split('\n').slice(0, 2)).toEqual([
      'STATE URUSAN: MEMAHAMI',
      'Hari ini: Minggu, 15 November 2026.',
    ]);
  });

  it('turn agen mengirim tanggal hari ini ke model', async () => {
    const provider = new FakeProvider({
      replies: [
        fakeCompletion({ content: JSON.stringify({ jenis: 'lainnya', keyakinan: 0.6 }) }),
        fakeCompletion({ content: 'Disdukcapil buka Senin-Jumat.' }),
      ],
    });
    const env = makeEnv({ provider, now: () => NOW });
    const u = env.store.createUrusan({});
    await runTurn(env.deps, { urusanId: u.id, userText: 'Jam buka Disdukcapil jam berapa?' });
    const agen = createParams(provider).at(-1)!;
    expect(teksSistem(agen)).toContain('Hari ini: Sabtu, 14 November 2026.');
  });
});

describe('reasoning_effort per peran', () => {
  it('panggilan utama agen memakai effort agen; klasifikasi tetap global (tanpa field)', async () => {
    const provider = new FakeProvider({
      replies: [
        fakeCompletion({ content: JSON.stringify({ jenis: 'lainnya', keyakinan: 0.6 }) }),
        fakeCompletion({ content: 'Disdukcapil buka Senin-Jumat.' }),
      ],
    });
    const env = makeEnv({ provider, reasoningEffort: 'high', reasoningEffortJawaban: 'medium' });
    const u = env.store.createUrusan({});
    await runTurn(env.deps, { urusanId: u.id, userText: 'Jam buka Disdukcapil jam berapa?' });
    const [klasifikasi, agen] = createParams(provider);
    expect(klasifikasi && 'reasoning_effort' in klasifikasi).toBe(false);
    expect(agen?.reasoning_effort).toBe('high');
    expect(agen?.max_tokens).toBe(16_000);
  });

  it('tanpa effort agen: field tidak dikirim (global provider berlaku)', async () => {
    const provider = new FakeProvider({
      replies: [
        fakeCompletion({ content: JSON.stringify({ jenis: 'lainnya', keyakinan: 0.6 }) }),
        fakeCompletion({ content: 'Disdukcapil buka Senin-Jumat.' }),
      ],
    });
    const env = makeEnv({ provider });
    const u = env.store.createUrusan({});
    await runTurn(env.deps, { urusanId: u.id, userText: 'Jam buka Disdukcapil jam berapa?' });
    expect(createParams(provider).some((p) => 'reasoning_effort' in p)).toBe(false);
  });
});

describe('guardrail: pesan campuran urusan + tugas/ujian', () => {
  it('SKCK untuk ujian CPNS diteruskan ke model dengan catatan tolak tegas', async () => {
    const provider = new FakeProvider({
      replies: [fakeCompletion({ content: 'Untuk SKCK, siapkan KTP-el dan KK.' })],
    });
    const env = makeEnv({ provider });
    const u = env.store.createUrusan({});
    const out = await runTurn(env.deps, {
      urusanId: u.id,
      userText: 'Saya harus selesaikan ujian CPNS, salah satu syaratnya SKCK. Gimana cara bikin SKCK?',
    });
    const calls = createParams(provider);
    expect(calls.length).toBeGreaterThan(0);
    expect(teksSistem(calls.at(-1)!)).toContain('PESAN MEMUAT PERMINTAAN DI LUAR CAKUPAN (tugas/ujian/game)');
    expect(
      out.events.filter((e) => e.type === 'assistant_text').map((e) => (e as { delta: string }).delta),
    ).not.toContain(BALASAN_DI_LUAR_URUSAN);
  });

  it('"buatkan script python cek KTP" tetap ditolak tanpa model', async () => {
    const provider = new FakeProvider({ replies: [] });
    const env = makeEnv({ provider });
    const u = env.store.createUrusan({});
    const out = await runTurn(env.deps, { urusanId: u.id, userText: 'buatkan script python cek KTP' });
    expect(createParams(provider)).toHaveLength(0);
    expect(
      out.events.filter((e) => e.type === 'assistant_text').map((e) => (e as { delta: string }).delta),
    ).toEqual([BALASAN_DI_LUAR_URUSAN]);
  });
});
