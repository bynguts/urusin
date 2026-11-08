import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ALL_ON } from './capabilities.js';
import {
  LlmContentFilterError,
  LlmLengthError,
  LlmRefusalError,
  assertCompletionUsable,
  isLlmTerminalError,
} from './errors.js';
import { FakeProvider, fakeCompletion } from './fake.js';
import { generateStructured } from './structured.js';
import {
  StrictSchemaError,
  findStrictViolations,
  strictSchemaFor,
  toStrictJsonSchema,
} from './strict-schema.js';

const Answer = z.object({
  klaim: z.array(
    z.object({
      teks: z.string().min(1).max(500),
      kutipan: z.array(z.object({ refId: z.string(), kutipanPersis: z.string() })).min(1),
    }),
  ),
  handoff: z.object({ pesan: z.string(), url: z.url().optional() }).optional(),
  catatan: z.string().default('-'),
});

describe('toStrictJsonSchema (aturan OpenAI strict mode)', () => {
  const json = toStrictJsonSchema(Answer) as Record<string, any>;

  it('lolos pemeriksa aturan strict', () => {
    expect(findStrictViolations(json)).toEqual([]);
  });

  it('akar objek, semua properti required, additionalProperties false di setiap objek', () => {
    expect(json.type).toBe('object');
    expect(json.additionalProperties).toBe(false);
    expect(json.required).toEqual(['klaim', 'handoff', 'catatan']);
    const item = json.properties.klaim.items;
    expect(item.additionalProperties).toBe(false);
    expect(item.required).toEqual(['teks', 'kutipan']);
    expect(item.properties.kutipan.items.additionalProperties).toBe(false);
  });

  it('optional dan default menjadi nullable (anyOf dengan null)', () => {
    expect(json.properties.handoff.anyOf).toContainEqual({ type: 'null' });
    expect(json.properties.catatan.anyOf).toContainEqual({ type: 'null' });
    // properti optional di dalam objek bersarang juga nullable dan required
    const handoffObj = json.properties.handoff.anyOf.find((b: any) => b.type === 'object');
    expect(handoffObj.required).toEqual(['pesan', 'url']);
    expect(handoffObj.properties.url.anyOf).toContainEqual({ type: 'null' });
  });

  it('membuang kata kunci yang tidak didukung (minLength, maxLength, default, format uri, $schema)', () => {
    const text = JSON.stringify(json);
    for (const kw of ['minLength', 'maxLength', '"default"', '$schema', '"uri"']) {
      expect(text).not.toContain(kw);
    }
  });

  it('discriminatedUnion (oneOf) menjadi anyOf dan const menjadi enum', () => {
    const Action = z.object({
      aksi: z.discriminatedUnion('jenis', [
        z.object({ jenis: z.literal('balas'), teks: z.string() }),
        z.object({ jenis: z.literal('tool'), nama: z.string(), args: z.object({ q: z.string() }) }),
      ]),
    });
    const s = toStrictJsonSchema(Action) as Record<string, any>;
    expect(findStrictViolations(s)).toEqual([]);
    expect(s.properties.aksi.oneOf).toBeUndefined();
    expect(s.properties.aksi.anyOf).toHaveLength(2);
    expect(s.properties.aksi.anyOf[0].properties.jenis).toEqual({ type: 'string', enum: ['balas'] });
  });

  it('akar anyOf ditolak (aturan: akar harus objek)', () => {
    const union = z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]);
    expect(() => toStrictJsonSchema(union)).toThrow(StrictSchemaError);
  });

  it('objek bebas (z.record) ditolak karena tidak bisa strict', () => {
    expect(() => toStrictJsonSchema(z.object({ x: z.record(z.string(), z.string()) }))).toThrow(
      StrictSchemaError,
    );
  });

  it('pemeriksa menangkap pelanggaran pada skema mentah non-strict', () => {
    const raw = z.toJSONSchema(Answer, { target: 'draft-7', io: 'input' });
    const messages = findStrictViolations(raw).map((v) => v.message);
    expect(messages).toContain('additionalProperties harus false');
    expect(messages).toContain('properti harus ada di required');
  });

  it('batas kedalaman 10 ditegakkan', () => {
    let nested: z.ZodType = z.object({ v: z.string() });
    for (let i = 0; i < 12; i++) nested = z.object({ n: nested });
    expect(() => toStrictJsonSchema(nested)).toThrow(/kedalaman/);
  });
});

describe('strictSchemaFor().parse', () => {
  it('menerima null untuk field optional (dibuang sebelum zod) dan default tetap berlaku', () => {
    const strict = strictSchemaFor(Answer);
    const r = strict.parse({ klaim: [], handoff: null, catatan: null });
    expect(r.success).toBe(true);
    expect(r.success && r.data).toEqual({ klaim: [], catatan: '-' });
  });

  it('tetap menolak null pada field wajib', () => {
    const strict = strictSchemaFor(Answer);
    expect(strict.parse({ klaim: null, handoff: null, catatan: null }).success).toBe(false);
  });

  it('union terdiskriminasi: null pada field optional cabang dibuang', () => {
    const S = z.object({
      aksi: z.discriminatedUnion('jenis', [
        z.object({ jenis: z.literal('balas'), teks: z.string() }),
        z.object({ jenis: z.literal('tool'), nama: z.string(), confirmationId: z.string().optional() }),
      ]),
    });
    const r = strictSchemaFor(S).parse({ aksi: { jenis: 'tool', nama: 'x', confirmationId: null } });
    expect(r.success && r.data).toEqual({ aksi: { jenis: 'tool', nama: 'x' } });
  });
});

describe('refusal / length / content_filter', () => {
  const Intent = z.object({ ya: z.boolean() });
  const base = {
    model: 'm',
    name: 'x',
    schema: Intent,
    messages: [{ role: 'user' as const, content: 'halo' }],
    caps: ALL_ON,
  };

  it('refusal menjadi LlmRefusalError dan tidak turun tangga (tepat 1 panggilan)', async () => {
    const provider = new FakeProvider({
      replies: [fakeCompletion({ content: null, refusal: 'Maaf, saya tidak bisa membantu.' })],
    });
    await expect(generateStructured({ ...base, provider })).rejects.toBeInstanceOf(LlmRefusalError);
    expect(provider.calls).toHaveLength(1);
  });

  it('finish_reason=length menjadi LlmLengthError tanpa mencoba memperbaiki JSON terpotong', async () => {
    const provider = new FakeProvider({
      replies: [fakeCompletion({ content: '{"ya": tr', finishReason: 'length' })],
    });
    await expect(generateStructured({ ...base, provider, maxTokens: 20 })).rejects.toBeInstanceOf(
      LlmLengthError,
    );
    expect(provider.calls).toHaveLength(1);
  });

  it('finish_reason=content_filter menjadi LlmContentFilterError', async () => {
    const provider = new FakeProvider({
      replies: [fakeCompletion({ content: '', finishReason: 'content_filter' })],
    });
    await expect(generateStructured({ ...base, provider })).rejects.toBeInstanceOf(LlmContentFilterError);
  });

  it('refusal pada anak tangga forced tool juga tidak ditelan', async () => {
    const provider = new FakeProvider({
      without: ['json_schema_strict'],
      replies: [fakeCompletion({ content: null, refusal: 'tidak' })],
    });
    await expect(generateStructured({ ...base, provider })).rejects.toBeInstanceOf(LlmRefusalError);
  });

  it('json_schema yang dikirim adalah versi strict', async () => {
    const provider = new FakeProvider({
      replies: [fakeCompletion({ content: JSON.stringify({ ya: true }) })],
    });
    await generateStructured({ ...base, provider });
    const call = provider.calls[0];
    const rf = call?.kind === 'create' ? call.params.response_format : undefined;
    expect(rf?.type === 'json_schema' && rf.json_schema.schema).toMatchObject({
      additionalProperties: false,
      required: ['ya'],
    });
  });

  it('assertCompletionUsable + isLlmTerminalError', () => {
    expect(() => assertCompletionUsable(fakeCompletion({ content: 'ok' }))).not.toThrow();
    try {
      assertCompletionUsable(fakeCompletion({ content: 'x', finishReason: 'length' }));
    } catch (e) {
      expect(isLlmTerminalError(e)).toBe(true);
    }
    expect(isLlmTerminalError(new Error('x'))).toBe(false);
  });
});
