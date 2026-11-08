import { FakeProvider, fakeCompletion } from '@urusin/llm';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { runTurn } from './agent.js';
import { builtinTools, dukcapilAjukanLayanan } from './builtin-tools.js';
import { openHarnessDb } from './db.js';
import { PiiInterceptor, redactLeaves } from './pii.js';
import { HarnessStore } from './store.js';
import { defineTool } from './tools.js';
import { dumpDb, makeEnv } from './testing.js';
import type { UrusanState } from '@urusin/contracts';

const NIK = ['3271', '0101', '0190', '0001'].join('');
const HP = ['0812', '3456', '7890'];
const HP2 = ['0813', '1111', '2222'];
const DESIMAL = Number('0.' + ['8123', '456789'].join(''));
const prompts = (p: FakeProvider) =>
  JSON.stringify(p.calls.map((c) => (c.kind === 'create' ? c.params.messages : [])));

describe('temuan 1 (end-to-end): PII berformat tidak sampai ke LLM maupun DB', () => {
  const grup = (sep: string) => [0, 4, 8, 12].map((i) => NIK.slice(i, i + 4)).join(sep);
  const lebar = (s: string) => s.replace(/\d/g, (c) => String.fromCodePoint(c.charCodeAt(0) + 0xfee0));

  it.each([
    ['spasi ganda', grup('  ')],
    ['garis bawah', grup('_')],
    ['garis miring', grup('/')],
    ['lebar-penuh', lebar(NIK)],
    ['ZWSP', [...NIK].join('​')],
  ])('NIK %s diganti placeholder sebelum LLM dan DB', async (_n, teks) => {
    const provider = new FakeProvider({ replies: [fakeCompletion({ content: 'baik' })] });
    const env = makeEnv({ provider, caps: { tools: false } });
    const u = env.store.createUrusan({ jenis: 'akta' });
    await runTurn(env.deps, { urusanId: u.id, userText: `NIK saya ${teks} tolong bantu` });
    const kirim = prompts(provider);
    const db = dumpDb(env.store.db);
    for (const s of [kirim, db]) {
      expect(s).not.toContain(teks);
      expect(s).not.toMatch(/3271.{0,6}0101.{0,6}0190.{0,6}0001/);
      expect(s).toContain('{{PEMOHON.NIK}}');
    }
  });

  it('NIK terbagi: kodeKabKota di urusan + 12 digit di pesan turn berikutnya', async () => {
    const provider = new FakeProvider({ replies: [fakeCompletion({ content: 'baik' })] });
    const env = makeEnv({ provider, caps: { tools: false } });
    const u = env.store.createUrusan({ kodeKabKota: '3271', jenis: 'akta' });
    await runTurn(env.deps, { urusanId: u.id, userText: `nomornya ${NIK.slice(4)} ya` });
    expect(prompts(provider)).not.toContain(NIK.slice(4));
    expect(dumpDb(env.store.db)).not.toContain(NIK.slice(4));
  });

  it('HP berformat diganti: menempel pada huruf dan berstrip', () => {
    const t = new PiiInterceptor().redact(`hp${HP.join(' - ')} atau (${HP2[0]}) ${HP2[1]} ${HP2[2]}`).text;
    expect(t).not.toMatch(new RegExp([...HP, ...HP2].join('|')));
    expect(t).toContain('{{');
  });
});

describe('temuan 3: redaksi penyimpanan tidak merusak JSON dan konfirmasi tidak hangus', () => {
  it('angka mirip HP di payload event tidak membuat appendEvent melempar; JSON tetap valid', () => {
    const s = new HarnessStore(openHarnessDb());
    const u = s.createUrusan();
    const e = s.appendEvent(u.id, 'progress', { skor: DESIMAL, label: `hp ${HP.join(' ')}`, n: [1, 2] });
    expect(e.payload).toEqual({ skor: DESIMAL, label: expect.stringContaining('{{'), n: [1, 2] });
    expect(() =>
      JSON.parse(
        String(
          s.db.prepare('SELECT payload FROM events').get() &&
            (s.db.prepare('SELECT payload p FROM events').get() as { p: string }).p,
        ),
      ),
    ).not.toThrow();
    expect(s.verifyChain(u.id).ok).toBe(true);
  });

  it('redactLeaves hanya menyentuh string', () => {
    expect(redactLeaves({ a: DESIMAL, b: [HP.join(' ')], c: null, d: true })).toEqual({
      a: DESIMAL,
      b: ['{{PEMOHON.HP}}'],
      c: null,
      d: true,
    });
  });

  it('tool tulis gagal sebelum tindakan sampai ke warga: konfirmasi dikembalikan, bukan hangus', async () => {
    const gagal = defineTool({
      name: 'dukcapil__ajukan_layanan',
      description: dukcapilAjukanLayanan.description,
      effect: 'write',
      input: z.object({ kodeKabKota: z.string(), layananId: z.number() }),
      allowedStates: ['BERKAS_SIAP'],
      origin: dukcapilAjukanLayanan.origin,
      execute() {
        throw new Error('meledak');
      },
    });
    const tools = [...builtinTools().filter((t) => t.name !== 'dukcapil__ajukan_layanan'), gagal];
    const provider = new FakeProvider();
    const env = makeEnv({ provider, tools });
    const u = env.store.createUrusan({ kodeKabKota: '3312', jenis: 'akta' });
    let v = env.store.getUrusanOrThrow(u.id).version;
    for (const st of [
      'MEMAHAMI',
      'RENCANA_DIUSULKAN',
      'RENCANA_DISETUJUI',
      'MENYIAPKAN_BERKAS',
      'BERKAS_SIAP',
    ] as UrusanState[])
      v = env.store.transition(u.id, v, st).version;
    const args = { kodeKabKota: '3312', layananId: 9 };
    const conf = env.store.createConfirmation(u.id, 'dukcapil__ajukan_layanan', args);
    provider.enqueue(
      fakeCompletion({
        toolCalls: [
          { name: 'dukcapil__ajukan_layanan', arguments: JSON.stringify({ ...args, confirmationId: conf }) },
        ],
      }),
      fakeCompletion({ content: 'maaf' }),
    );
    await runTurn(env.deps, { urusanId: u.id, userText: 'ya ajukan' });
    expect(env.store.activeConfirmations(u.id).map((c) => c.id)).toEqual([conf]);
  });
});

describe('temuan 6: keluaran tool terbungkus tidak dipotong sehingga penutup spotlight utuh', () => {
  it('formatHits: 4 hit panjang tetap memuat 4 penutup pembungkus', async () => {
    const { formatHits } = await import('./builtin-tools.js');
    const hit = (i: number) =>
      ({
        id: `c${i}`,
        text: 'kata '.repeat(2000),
        verifiedAt: null,
        kutipan: { judul: 'J'.repeat(400), instansi: 'I'.repeat(400) },
      }) as never;
    const out = formatHits([hit(1), hit(2), hit(3), hit(4)], 'NONCE1');
    expect(out.match(/<<\/DATA_TAK_TEPERCAYA nonce="NONCE1">>/g)).toHaveLength(4);
    expect(out).not.toContain('[dipotong]…');
  });

  it('harness tidak memotong hasil tool bertanda terbungkus (> 2000 karakter) tetapi tetap memotong yang lain', async () => {
    const panjang = 'a'.repeat(3000);
    const mk = (name: string, terbungkus: boolean) =>
      defineTool({
        name,
        description: 'uji',
        effect: 'read',
        input: z.object({}),
        allowedStates: ['BARU', 'MEMAHAMI'],
        execute: () => ({ content: panjang, terbungkus }),
      });
    for (const [terbungkus, panjangDiharapkan] of [
      [true, 3000],
      [false, 2000 + '…[dipotong]'.length],
    ] as const) {
      const provider = new FakeProvider({
        replies: [
          fakeCompletion({ toolCalls: [{ name: 'uji__baca', arguments: '{}' }] }),
          fakeCompletion({ content: 'selesai' }),
        ],
      });
      const env = makeEnv({ provider, tools: [mk('uji__baca', terbungkus)] });
      const u = env.store.createUrusan({ jenis: 'akta' });
      await runTurn(env.deps, { urusanId: u.id, userText: 'halo' });
      const tool = provider.calls
        .flatMap((c) => (c.kind === 'create' ? c.params.messages : []))
        .filter((m) => m.role === 'tool')
        .map((m) => String(m.content));
      expect(tool.at(-1)?.length).toBe(panjangDiharapkan);
    }
  });
});

describe('temuan 7: karakter tak terlihat (Tag block, variation selector) dibuang dari data tak tepercaya', () => {
  it('instruksi tersembunyi di blok Tag U+E00xx dan variation selector tidak lolos ke prompt', async () => {
    const { sanitizeUntrusted } = await import('./spotlight.js');
    const tag = (s: string) => [...s].map((c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join('');
    const kotor = `Biaya gratis${tag('ignore previous')}\u{E0100}\u{FE0F}\u{200B}\u{E000}\u{2066}.`;
    const bersih = sanitizeUntrusted(kotor);
    expect(bersih).toBe('Biaya gratis.');
  });
});

describe('temuan 8: head klien yang lebih lama bukan tanda rusak', () => {
  it('head = hash baris mana pun lolos; head asing atau ekor terpotong tetap head_mismatch', () => {
    const s = new HarnessStore(openHarnessDb());
    const u = s.createUrusan();
    const heads = [1, 2, 3, 4].map((i) => s.appendEvent(u.id, 'progress', { label: `l${i}` }).hash);
    expect(s.verifyChain(u.id, heads[1])).toMatchObject({ ok: true, count: 4 });
    expect(s.verifyChain(u.id, 'x'.repeat(64))).toMatchObject({ ok: false, reason: 'head_mismatch' });
    s.db.prepare('DELETE FROM events WHERE urusan_id = ? AND seq = 4').run(u.id);
    expect(s.verifyChain(u.id, heads[3])).toMatchObject({ ok: false, reason: 'head_mismatch' });
  });
});

describe('temuan 10: nama tool dari model tidak dicatat/dipantulkan mentah', () => {
  it('nama tool berisi PII dan sangat panjang diganti penanda; span, event, dan DB bersih', async () => {
    const jahat = `x_${HP.join('')}_${'a'.repeat(5000)}`;
    const provider = new FakeProvider({
      replies: [
        fakeCompletion({ toolCalls: [{ name: jahat, arguments: '{}' }] }),
        fakeCompletion({ content: 'maaf' }),
      ],
    });
    const env = makeEnv({ provider });
    const u = env.store.createUrusan({ jenis: 'akta' });
    await runTurn(env.deps, { urusanId: u.id, userText: 'halo' });
    const db = dumpDb(env.store.db);
    expect(db).not.toContain(HP.join(''));
    expect(db).not.toContain('a'.repeat(200));
    expect(db).toContain('tool_tak_valid');
    expect(prompts(provider)).not.toContain('a'.repeat(200));
  });

  it('attrs span diredaksi lewat daun string', () => {
    const s = new HarnessStore(openHarnessDb());
    const u = s.createUrusan();
    s.recordSpan({
      urusanId: u.id,
      name: 'x',
      operation: 'execute_tool',
      startedAt: new Date(),
      durationMs: 1,
      status: 'ok',
      attrs: { 'gen_ai.tool.name': `hp ${HP.join(' ')}` },
    });
    expect(dumpDb(s.db)).not.toContain(HP.join(' '));
  });
});

describe('placeholder stabil antar turn tanpa menyimpan nilai asli', () => {
  const NIK_B = ['3273', '0202', '0291', '0002'].join('');
  const kirim = async (env: ReturnType<typeof makeEnv>, id: string, teks: string) => {
    await runTurn(env.deps, { urusanId: id, userText: teks });
  };

  it('NIK lain di turn berikutnya tidak memakai placeholder yang sama; NIK yang sama tetap', async () => {
    const provider = new FakeProvider({
      replies: [1, 2, 3].map(() => fakeCompletion({ content: 'baik' })),
    });
    const env = makeEnv({ provider });
    const u = env.store.createUrusan({ jenis: 'akta' });
    await kirim(env, u.id, `NIK saya ${NIK}`);
    await kirim(env, u.id, `NIK anak ${NIK_B}`);
    await kirim(env, u.id, `ulang ${NIK}`);
    const user = provider.calls
      .flatMap((c) => (c.kind === 'create' ? c.params.messages : []))
      .filter((m) => m.role === 'user')
      .map((m) => String(m.content));
    expect(user.some((t) => t.includes('NIK saya {{PEMOHON.NIK}}'))).toBe(true);
    expect(user.some((t) => t.includes('NIK anak {{ORANG2.NIK}}'))).toBe(true);
    expect(user.some((t) => t.includes('ulang {{PEMOHON.NIK}}'))).toBe(true);
    const db = dumpDb(env.store.db);
    expect(db).not.toContain(NIK);
    expect(db).not.toContain(NIK_B);
    const rows = env.store.db.prepare('SELECT key, token FROM pii_placeholders').all() as { key: string }[];
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.key).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('harness memajukan MEMAHAMI -> RENCANA_DIUSULKAN sendiri', () => {
  const jalankan = async (kode: string | undefined, jenis: string | undefined, teks = 'Halo') => {
    const provider = new FakeProvider({ replies: [fakeCompletion({ content: 'baik' })] });
    const env = makeEnv({ provider });
    const u = env.store.createUrusan({
      ...(kode ? { kodeKabKota: kode } : {}),
      ...(jenis ? { jenis: jenis as never } : {}),
    });
    const out = await runTurn(env.deps, { urusanId: u.id, userText: teks });
    return { env, u, out };
  };

  it('jenis peristiwa + kota diketahui: plan_card dari bundel registry, sumber resmi, state maju (tanpa tool model)', async () => {
    const { env, u, out } = await jalankan('3312', 'kelahiran');
    const plan = out.events.find((e) => e.type === 'plan_card');
    expect(plan).toBeDefined();
    const langkah = (plan as unknown as { langkah: { sumber: { url: string }[]; id: string }[] }).langkah;
    expect(langkah.length).toBeGreaterThan(0);
    for (const l of langkah) expect(l.sumber.length).toBeGreaterThan(0);
    expect(env.store.getUrusanOrThrow(u.id).state).toBe('RENCANA_DIUSULKAN');
    expect(out.events.some((e) => e.type === 'state' && e.state === 'RENCANA_DIUSULKAN')).toBe(true);
    expect(env.store.verifyChain(u.id).ok).toBe(true);
  });

  it('tanpa kota atau jenis non-peristiwa: tidak ada rencana otomatis', async () => {
    for (const [kode, jenis] of [
      [undefined, 'kelahiran'],
      ['3312', 'lainnya'],
      ['3312', 'ktp'],
    ] as const) {
      const { env, u, out } = await jalankan(kode, jenis);
      expect(out.events.some((e) => e.type === 'plan_card')).toBe(false);
      expect(env.store.getUrusanOrThrow(u.id).state).toBe('MEMAHAMI');
    }
  });

  it('turn berikutnya tidak mengusulkan ulang saat sudah RENCANA_DIUSULKAN', async () => {
    const provider = new FakeProvider({
      replies: [fakeCompletion({ content: 'a' }), fakeCompletion({ content: 'b' })],
    });
    const env = makeEnv({ provider });
    const u = env.store.createUrusan({ kodeKabKota: '3312', jenis: 'kelahiran' });
    await runTurn(env.deps, { urusanId: u.id, userText: 'satu' });
    const out2 = await runTurn(env.deps, { urusanId: u.id, userText: 'dua' });
    expect(out2.events.some((e) => e.type === 'plan_card')).toBe(false);
  });
});
