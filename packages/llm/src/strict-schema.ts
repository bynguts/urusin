import { z } from 'zod';

/**
 * Transformer zod → JSON Schema yang diterima OpenAI Structured Outputs (strict).
 * Aturan (platform.openai.com/docs/guides/structured-outputs):
 *  - akar harus objek (bukan anyOf);
 *  - setiap objek: semua properti masuk `required` dan `additionalProperties: false`;
 *  - field optional dinyatakan sebagai union dengan null;
 *  - `oneOf` tidak didukung (pakai anyOf); kata kunci validasi tertentu tidak didukung.
 * Validasi sebenarnya tetap oleh zod setelah respons diterima (lihat `strictSchemaFor().parse`).
 */

export class StrictSchemaError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(`${message} (di ${path || '<akar>'})`);
    this.name = 'StrictSchemaError';
  }
}

type Json = Record<string, unknown>;

/** Kata kunci yang ditolak mode strict; dibuang karena zod memvalidasi ulang di sisi kita. */
const UNSUPPORTED_KEYWORDS = [
  '$schema',
  'default',
  'minLength',
  'maxLength',
  'uniqueItems',
  'minProperties',
  'maxProperties',
  'propertyNames',
  'patternProperties',
  'contains',
  'minContains',
  'maxContains',
  'unevaluatedProperties',
  'unevaluatedItems',
  'if',
  'then',
  'else',
] as const;

/** Format string yang didukung strict mode. */
const SUPPORTED_FORMATS = new Set([
  'date-time',
  'time',
  'date',
  'duration',
  'email',
  'hostname',
  'ipv4',
  'ipv6',
  'uuid',
]);

export const STRICT_MAX_DEPTH = 10;
export const STRICT_MAX_PROPERTIES = 5000;

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function nullable(prop: Json): Json {
  if (Array.isArray(prop.anyOf)) {
    const hasNull = prop.anyOf.some((b) => isObj(b) && b.type === 'null');
    return hasNull ? prop : { ...prop, anyOf: [...prop.anyOf, { type: 'null' }] };
  }
  return { anyOf: [prop, { type: 'null' }] };
}

function convert(node: unknown, path: string): unknown {
  if (Array.isArray(node)) return node.map((n, i) => convert(n, `${path}[${i}]`));
  if (!isObj(node)) return node;

  const out: Json = {};
  for (const [k, v] of Object.entries(node)) {
    if ((UNSUPPORTED_KEYWORDS as readonly string[]).includes(k)) continue;
    if (k === 'format' && typeof v === 'string' && !SUPPORTED_FORMATS.has(v)) continue;
    if (k === 'properties' && isObj(v)) {
      out[k] = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, convert(pv, `${path}.${pk}`)]));
    } else if ((k === 'definitions' || k === '$defs') && isObj(v)) {
      out[k] = Object.fromEntries(
        Object.entries(v).map(([dk, dv]) => [dk, convert(dv, `${path}/${k}/${dk}`)]),
      );
    } else {
      out[k] = convert(v, `${path}.${k}`);
    }
  }

  if ('oneOf' in out) {
    out.anyOf = out.oneOf;
    delete out.oneOf;
  }
  if ('const' in out) {
    out.enum = [out.const];
    delete out.const;
  }
  if (out.allOf !== undefined || out.not !== undefined) {
    throw new StrictSchemaError('allOf/not tidak didukung mode strict', path);
  }

  if (out.type === 'object' || isObj(out.properties)) {
    if (!isObj(out.properties)) {
      throw new StrictSchemaError('objek tanpa properti tetap (z.record/objek bebas) tidak didukung', path);
    }
    const originallyRequired = new Set(Array.isArray(node.required) ? (node.required as string[]) : []);
    const props = out.properties;
    for (const key of Object.keys(props)) {
      if (!originallyRequired.has(key)) props[key] = nullable(props[key] as Json);
    }
    out.required = Object.keys(props);
    out.additionalProperties = false;
  }
  return out;
}

export type StrictViolation = { path: string; message: string };

/** Periksa skema terhadap aturan strict mode; kosong = diterima. Dipakai tes dan sebagai pagar terakhir. */
export function findStrictViolations(schema: unknown): StrictViolation[] {
  const issues: StrictViolation[] = [];
  let propertyCount = 0;

  const walk = (node: unknown, path: string, depth: number) => {
    if (!isObj(node)) return;
    if (depth > STRICT_MAX_DEPTH) issues.push({ path, message: `kedalaman > ${STRICT_MAX_DEPTH}` });
    for (const kw of UNSUPPORTED_KEYWORDS) {
      if (kw in node) issues.push({ path, message: `kata kunci tidak didukung: ${kw}` });
    }
    for (const kw of ['oneOf', 'allOf', 'not', 'const']) {
      if (kw in node) issues.push({ path, message: `kata kunci tidak didukung: ${kw}` });
    }
    if (typeof node.format === 'string' && !SUPPORTED_FORMATS.has(node.format)) {
      issues.push({ path, message: `format tidak didukung: ${node.format}` });
    }
    if (node.type === 'object' || isObj(node.properties)) {
      const props = isObj(node.properties) ? node.properties : undefined;
      if (!props) issues.push({ path, message: 'objek tanpa properti tetap' });
      if (node.additionalProperties !== false) {
        issues.push({ path, message: 'additionalProperties harus false' });
      }
      const keys = Object.keys(props ?? {});
      propertyCount += keys.length;
      const required = Array.isArray(node.required) ? (node.required as string[]) : [];
      for (const k of keys) {
        if (!required.includes(k))
          issues.push({ path: `${path}.${k}`, message: 'properti harus ada di required' });
      }
      for (const [k, v] of Object.entries(props ?? {})) walk(v, `${path}.${k}`, depth + 1);
    }
    if (isObj(node.items)) walk(node.items, `${path}[]`, depth + 1);
    if (Array.isArray(node.anyOf)) node.anyOf.forEach((b, i) => walk(b, `${path}|${i}`, depth + 1));
    for (const dk of ['definitions', '$defs']) {
      const defs = node[dk];
      if (isObj(defs)) for (const [k, v] of Object.entries(defs)) walk(v, `${path}/${dk}/${k}`, depth + 1);
    }
  };

  if (!isObj(schema) || schema.type !== 'object') {
    issues.push({ path: '', message: 'akar harus bertipe object' });
  } else if ('anyOf' in schema) {
    issues.push({ path: '', message: 'akar tidak boleh anyOf' });
  }
  walk(schema, '', 0);
  if (propertyCount > STRICT_MAX_PROPERTIES) {
    issues.push({ path: '', message: `jumlah properti > ${STRICT_MAX_PROPERTIES}` });
  }
  return issues;
}

/** JSON Schema strict-compatible dari skema zod (mode `input`: field ber-default dianggap optional). */
export function toStrictJsonSchema(schema: z.ZodType): Json {
  const original = z.toJSONSchema(schema, { target: 'draft-7', io: 'input' }) as Json;
  const strict = convert(original, '') as Json;
  const [first] = findStrictViolations(strict);
  if (first) throw new StrictSchemaError(first.message, first.path);
  return strict;
}

function branchMatches(branch: Json, value: Json): boolean {
  if (!isObj(branch.properties)) return false;
  const required = Array.isArray(branch.required) ? (branch.required as string[]) : [];
  if (!required.every((k) => k in value)) return false;
  for (const [k, p] of Object.entries(branch.properties)) {
    if (isObj(p) && 'const' in p && value[k] !== p.const) return false;
    if (isObj(p) && Array.isArray(p.enum) && k in value && !p.enum.includes(value[k])) return false;
  }
  return true;
}

/**
 * Hasil model pada skema strict memuat `null` untuk field optional. Buang `null` pada properti yang
 * aslinya optional sebelum zod memvalidasi (zod `.optional()` menolak null).
 */
export function dropOptionalNulls(data: unknown, original: Json): unknown {
  const resolve = (s: Json): Json => {
    const ref = typeof s.$ref === 'string' ? s.$ref : undefined;
    if (!ref) return s;
    const defs = (original.definitions ?? original.$defs) as Json | undefined;
    const hit = defs?.[ref.split('/').pop() ?? ''];
    return isObj(hit) ? hit : s;
  };
  const walk = (value: unknown, schema: unknown): unknown => {
    if (!isObj(schema)) return value;
    const s = resolve(schema);
    if (Array.isArray(value)) return value.map((v) => walk(v, s.items));
    if (!isObj(value)) return value;
    const branches = (Array.isArray(s.anyOf) ? s.anyOf : Array.isArray(s.oneOf) ? s.oneOf : undefined) as
      unknown[] | undefined;
    if (branches) {
      const branch = branches.find((b) => isObj(b) && branchMatches(resolve(b), value));
      return branch ? walk(value, branch) : value;
    }
    const props = isObj(s.properties) ? s.properties : {};
    const required = new Set(Array.isArray(s.required) ? (s.required as string[]) : []);
    const out: Json = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === null && k in props && !required.has(k)) continue;
      out[k] = walk(v, props[k]);
    }
    return out;
  };
  return walk(data, original);
}

export type StrictSchema<T> = {
  /** JSON Schema yang dikirim ke provider. */
  json: Json;
  /** Parse respons mentah: buang null untuk field optional lalu validasi dengan zod. */
  parse(raw: unknown): ReturnType<z.ZodType<T>['safeParse']>;
};

export function strictSchemaFor<T>(schema: z.ZodType<T>): StrictSchema<T> {
  const original = z.toJSONSchema(schema, { target: 'draft-7', io: 'input' }) as Json;
  return {
    json: toStrictJsonSchema(schema),
    parse: (raw) => schema.safeParse(dropOptionalNulls(raw, original)),
  };
}
