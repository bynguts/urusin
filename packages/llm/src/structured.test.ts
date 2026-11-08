import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ALL_ON } from './capabilities.js';
import { FakeProvider, fakeCompletion } from './fake.js';
import { StructuredOutputError, generateStructured } from './structured.js';

const Intent = z.object({
  peristiwa: z.enum(['kelahiran', 'kematian', 'perkawinan', 'pindah']),
  yakin: z.number(),
});
const base = {
  model: 'm',
  name: 'intent',
  schema: Intent,
  messages: [{ role: 'user' as const, content: 'anak saya baru lahir' }],
};
const good = JSON.stringify({ peristiwa: 'kelahiran', yakin: 0.9 });

describe('tangga structured output', () => {
  it('anak tangga 1: json_schema strict', async () => {
    const provider = new FakeProvider({ replies: [fakeCompletion({ content: good })] });
    const r = await generateStructured({ ...base, provider, caps: ALL_ON });
    expect(r).toMatchObject({ method: 'json_schema', degraded: false, attempts: 1 });
    expect(r.data.peristiwa).toBe('kelahiran');
    const call = provider.calls[0];
    expect(call?.kind === 'create' && call.params.response_format?.type).toBe('json_schema');
  });

  it('provider menolak json_schema (400) → turun ke forced tool', async () => {
    const provider = new FakeProvider({
      without: ['json_schema_strict'],
      replies: [fakeCompletion({ toolCalls: [{ name: 'emit_result', arguments: good }] })],
    });
    const r = await generateStructured({ ...base, provider, caps: ALL_ON });
    expect(r).toMatchObject({ method: 'forced_tool', degraded: true, attempts: 2 });
  });

  it('kapabilitas json_schema mati dari probe → langsung forced tool tanpa request sia-sia', async () => {
    const provider = new FakeProvider({
      replies: [fakeCompletion({ toolCalls: [{ name: 'emit_result', arguments: good }] })],
    });
    const r = await generateStructured({
      ...base,
      provider,
      caps: { json_schema_strict: false, tools: true },
    });
    expect(r.method).toBe('forced_tool');
    expect(provider.calls).toHaveLength(1);
  });

  it('tanpa json_schema dan tanpa tools → json_object + zod', async () => {
    const provider = new FakeProvider({ replies: [fakeCompletion({ content: good })] });
    const r = await generateStructured({
      ...base,
      provider,
      caps: { json_schema_strict: false, tools: false },
    });
    expect(r.method).toBe('json_object');
    const call = provider.calls[0];
    expect(call?.kind === 'create' && call.params.response_format?.type).toBe('json_object');
  });

  it('json_object memperbaiki output salah dengan retry (≤ 2)', async () => {
    const provider = new FakeProvider({
      replies: [
        fakeCompletion({ content: '{"peristiwa":"lahir"}' }),
        fakeCompletion({ content: 'bukan json' }),
        fakeCompletion({ content: good }),
      ],
    });
    const r = await generateStructured({
      ...base,
      provider,
      caps: { json_schema_strict: false, tools: false },
    });
    expect(r.attempts).toBe(3);
    expect(r.usage).toHaveLength(3);
    const last = provider.calls[2];
    expect(last?.kind === 'create' && JSON.stringify(last.params.messages)).toContain('Perbaiki');
  });

  it('gagal total setelah semua anak tangga → StructuredOutputError', async () => {
    const provider = new FakeProvider({
      without: ['json_schema_strict', 'tools'],
      replies: [1, 2, 3].map(() => fakeCompletion({ content: '{}' })),
    });
    await expect(generateStructured({ ...base, provider, caps: ALL_ON })).rejects.toBeInstanceOf(
      StructuredOutputError,
    );
  });

  it('error selain "unsupported parameter" tidak ditelan', async () => {
    const provider = new FakeProvider({ replies: [new Error('jaringan putus')] });
    await expect(generateStructured({ ...base, provider, caps: ALL_ON })).rejects.toThrow('jaringan putus');
  });

  it('json_schema yang dikirim adalah JSON Schema dari zod tanpa $schema', async () => {
    const provider = new FakeProvider({ replies: [fakeCompletion({ content: good })] });
    await generateStructured({ ...base, provider, caps: ALL_ON });
    const call = provider.calls[0];
    const rf = call?.kind === 'create' ? call.params.response_format : undefined;
    expect(rf?.type === 'json_schema' && rf.json_schema.schema).toMatchObject({
      type: 'object',
      required: ['peristiwa', 'yakin'],
    });
    expect(rf?.type === 'json_schema' && rf.json_schema.schema).not.toHaveProperty('$schema');
  });
});
