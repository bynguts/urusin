import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { SourceRefSchema } from './schema.js';
import { rawTokens, stemTokens } from './stem/stem.js';

export const GlossaryEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  /** Frasa awam pemicu; dicocokkan setelah normalisasi (stem + buang stopword). */
  pemicu: z.array(z.string().min(1)).min(1),
  /** Istilah resmi yang ditambahkan ke kueri. */
  resmi: z.array(z.string().min(1)).min(1),
  /** Asal istilah resmi; wajib, dan menunjuk sumber di data/sources.json. */
  sourceRef: SourceRefSchema,
  verifiedAt: z.iso.datetime().nullable(),
});
export type GlossaryEntry = z.infer<typeof GlossaryEntrySchema>;

export const GlossarySchema = z.object({
  version: z.literal(1),
  catatan: z.string(),
  entries: z.array(GlossaryEntrySchema),
});
export type Glossary = z.infer<typeof GlossarySchema>;

export function parseGlossary(json: unknown): Glossary {
  return GlossarySchema.parse(json);
}

export function loadGlossary(path: string): Glossary {
  return parseGlossary(JSON.parse(readFileSync(path, 'utf8')));
}

/** `data/glossary/adminduk.json` di akar repo; src/ dan dist/ sama dalamnya, jadi URL relatifnya sama. */
const DEFAULT_PATH = new URL('../../../data/glossary/adminduk.json', import.meta.url);

let cached: Glossary | null | undefined;

/** Glosarium bawaan; null bila berkas tidak ada (perluasan lalu dinonaktifkan, bukan galat). */
export function defaultGlossary(): Glossary | null {
  if (cached === undefined) {
    try {
      cached = loadGlossary(fileURLToPath(DEFAULT_PATH));
    } catch {
      cached = null;
    }
  }
  return cached;
}

export type Expansion = {
  /** Token istilah resmi (sudah dinormalisasi) yang belum ada di kueri asli. */
  terms: string[];
  /** id entri yang cocok (bukan teks kueri; aman untuk debug). */
  matched: string[];
};

function containsSeq(hay: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    if (needle.every((n, j) => hay[i + j] === n)) return true;
  }
  return false;
}

type Compiled = { entry: GlossaryEntry; triggers: string[][]; terms: string[] };
const compiledCache = new WeakMap<Glossary, Compiled[]>();

function compile(g: Glossary): Compiled[] {
  let c = compiledCache.get(g);
  if (!c) {
    c = g.entries.map((entry) => ({
      entry,
      triggers: entry.pemicu.map((p) => stemTokens(p)).filter((t) => t.length > 0),
      terms: entry.resmi.flatMap((r) => rawTokens(r).map((t) => t.toLowerCase())),
    }));
    compiledCache.set(g, c);
  }
  return c;
}

/**
 * Perluasan deterministik: tiap entri yang salah satu pemicunya muncul (urutan token berurutan,
 * sesudah stem + buang stopword) menambahkan istilah resminya. Istilah yang sudah ada di kueri
 * tidak ditambahkan lagi. Pemanggil memberi bobot lebih rendah pada hasil perluasan.
 */
export function expandQuery(query: string, glossary: Glossary | null = defaultGlossary()): Expansion {
  if (!glossary) return { terms: [], matched: [] };
  const q = stemTokens(query);
  const original = new Set(rawTokens(query).map((t) => t.toLowerCase()));
  const terms = new Set<string>();
  const matched: string[] = [];
  for (const { entry, triggers, terms: official } of compile(glossary)) {
    if (!triggers.some((t) => containsSeq(q, t))) continue;
    matched.push(entry.id);
    for (const t of official) if (!original.has(t)) terms.add(t);
  }
  return { terms: [...terms], matched };
}
