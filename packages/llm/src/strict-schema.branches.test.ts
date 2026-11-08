/* eslint-disable @typescript-eslint/no-explicit-any -- tes menelusuri JSON Schema dinamis */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  StrictSchemaError,
  dropOptionalNulls,
  findStrictViolations,
  strictSchemaFor,
  toStrictJsonSchema,
} from './strict-schema.js';

const messages = (schema: unknown) => findStrictViolations(schema).map((v) => v.message);

describe('toStrictJsonSchema: cabang konversi', () => {
  it('union (oneOf) menjadi anyOf dan literal (const) menjadi enum', () => {
    const json = toStrictJsonSchema(
      z.object({
        jenis: z.union([z.literal('a'), z.literal('b')]),
        tetap: z.literal('x'),
      }),
    ) as any;
    expect(JSON.stringify(json)).not.toContain('"oneOf"');
    expect(JSON.stringify(json)).not.toContain('"const"');
    expect(json.properties.tetap.enum).toEqual(['x']);
  });

  it('field optional menjadi anyOf dengan null; yang sudah nullable tidak diberi null kedua', () => {
    const json = toStrictJsonSchema(
      z.object({ a: z.string().optional(), b: z.string().nullable().optional(), c: z.string() }),
    ) as any;
    expect(json.required).toEqual(['a', 'b', 'c']);
    expect(json.properties.a.anyOf.map((x: any) => x.type)).toEqual(['string', 'null']);
    expect(json.properties.b.anyOf.filter((x: any) => x.type === 'null')).toHaveLength(1);
    expect(json.properties.c.type).toBe('string');
  });

  it('menolak allOf (intersection union) dan objek bebas (record) dengan StrictSchemaError', () => {
    const u1 = z.union([z.object({ k: z.literal('a') }), z.object({ k: z.literal('b') })]);
    const u2 = z.union([z.object({ m: z.string() }), z.object({ n: z.string() })]);
    expect(() => toStrictJsonSchema(z.object({ x: z.intersection(u1, u2) }))).toThrow(StrictSchemaError);
    expect(() => toStrictJsonSchema(z.object({ x: z.record(z.string(), z.string()) }))).toThrow(
      StrictSchemaError,
    );
  });

  it('intersection objek biasa digabung zod menjadi satu objek strict', () => {
    const inter = z.intersection(z.object({ a: z.string() }), z.object({ b: z.string() }));
    const json = toStrictJsonSchema(z.object({ x: inter })) as any;
    expect(json.properties.x.required).toEqual(['a', 'b']);
  });

  it('skema rekursif (lazy) tetap menghasilkan skema tanpa pelanggaran atau ditolak jelas', () => {
    const Node: z.ZodType = z.lazy(() => z.object({ nama: z.string(), anak: z.array(Node).optional() }));
    let result: unknown;
    try {
      result = toStrictJsonSchema(z.object({ pohon: Node }));
    } catch (e) {
      expect(e).toBeInstanceOf(StrictSchemaError);
      return;
    }
    expect(findStrictViolations(result)).toEqual([]);
  });

  it('format didukung dipertahankan', () => {
    const json = toStrictJsonSchema(z.object({ t: z.iso.datetime() })) as any;
    expect(json.properties.t.format).toBe('date-time');
  });
});

describe('findStrictViolations: tiap aturan', () => {
  const ok = {
    type: 'object',
    properties: { a: { type: 'string' } },
    required: ['a'],
    additionalProperties: false,
  };

  it('skema valid tidak punya pelanggaran', () => {
    expect(findStrictViolations(ok)).toEqual([]);
  });

  it('akar bukan objek atau memakai anyOf', () => {
    expect(messages({ type: 'string' })).toContain('akar harus bertipe object');
    expect(messages({ ...ok, anyOf: [] })).toContain('akar tidak boleh anyOf');
    expect(messages('bukan skema')).toContain('akar harus bertipe object');
  });

  it('additionalProperties bukan false, properti di luar required, dan objek tanpa properti', () => {
    expect(messages({ ...ok, additionalProperties: true })).toContain('additionalProperties harus false');
    expect(messages({ ...ok, required: [] })).toContain('properti harus ada di required');
    expect(messages({ type: 'object', additionalProperties: false })).toContain('objek tanpa properti tetap');
  });

  it('kata kunci tidak didukung dan format tidak didukung', () => {
    expect(messages({ ...ok, minProperties: 1 }).some((m) => m.includes('minProperties'))).toBe(true);
    expect(messages({ ...ok, oneOf: [] }).some((m) => m.includes('oneOf'))).toBe(true);
    expect(messages({ ...ok, const: 1 }).some((m) => m.includes('const'))).toBe(true);
    const bad = { ...ok, properties: { a: { type: 'string', format: 'uuid-ish' } } };
    expect(messages(bad).some((m) => m.includes('format tidak didukung'))).toBe(true);
  });

  it('menelusuri items, anyOf, dan $defs', () => {
    const loose = { type: 'object', properties: {}, additionalProperties: true };
    const nested = {
      ...ok,
      properties: {
        list: { type: 'array', items: loose },
        u: { anyOf: [loose, { type: 'null' }] },
      },
      required: ['list', 'u'],
      $defs: { d: loose },
    };
    const paths = findStrictViolations(nested).map((v) => v.path);
    expect(paths).toEqual(expect.arrayContaining(['.list[]', '.u|0', '/$defs/d']));
  });

  it('kedalaman berlebih dilaporkan', () => {
    let deep: any = { type: 'object', properties: {}, required: [], additionalProperties: false };
    for (let i = 0; i < 12; i++) {
      deep = { type: 'object', properties: { n: deep }, required: ['n'], additionalProperties: false };
    }
    expect(messages(deep).some((m) => m.startsWith('kedalaman'))).toBe(true);
  });
});

describe('dropOptionalNulls', () => {
  const Schema = z.object({
    nama: z.string(),
    opsi: z.string().optional(),
    daftar: z.array(z.object({ x: z.number().optional() })),
  });

  it('membuang null pada properti optional, termasuk di dalam array', () => {
    const s = strictSchemaFor(Schema);
    const r = s.parse({ nama: 'a', opsi: null, daftar: [{ x: null }, { x: 2 }] });
    expect(r.success).toBe(true);
    expect(r.data).toEqual({ nama: 'a', daftar: [{}, { x: 2 }] });
  });

  it('mengikuti $ref ke definitions dan memilih cabang anyOf yang cocok', () => {
    const original: any = {
      definitions: { item: { type: 'object', properties: { a: { type: 'string' } }, required: [] } },
      type: 'object',
      properties: {
        satu: { $ref: '#/definitions/item' },
        pilih: {
          anyOf: [
            {
              type: 'object',
              properties: { kind: { const: 'p' }, a: { type: 'string' } },
              required: ['kind'],
            },
            {
              type: 'object',
              properties: { kind: { enum: ['q'] }, b: { type: 'string' } },
              required: ['kind'],
            },
          ],
        },
      },
      required: ['satu', 'pilih'],
    };
    const out = dropOptionalNulls({ satu: { a: null }, pilih: { kind: 'q', b: null } }, original) as any;
    expect(out).toEqual({ satu: {}, pilih: { kind: 'q' } });
  });

  it('cabang tak cocok dan $ref tak dikenal dibiarkan apa adanya; skalar lolos', () => {
    const original: any = {
      type: 'object',
      properties: {
        u: { anyOf: [{ type: 'object', properties: { k: { const: 'z' } }, required: ['k'] }] },
        r: { $ref: '#/definitions/hilang' },
        n: { type: 'number' },
      },
      required: ['u', 'r', 'n'],
    };
    const input = { u: { k: 'lain', v: null }, r: { a: null }, n: 3 };
    expect(dropOptionalNulls(input, original)).toEqual(input);
  });
});
