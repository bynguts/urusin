import { readFileSync } from 'node:fs';
import { z } from 'zod';

/**
 * Teks pasal regulasi nasional (data/regulasi/pasal.json), per id sumber ber-adapter `pasal`. Berkas resminya
 * PDF; ingest mengambil PDF itu (robots, jeda sopan) untuk memastikan sumber hidup dan mencatat hash-nya agar
 * `rag:verify` menandai perubahan, sedangkan teks chunk diambil dari kutipan verbatim yang sudah diperiksa.
 */
export const PasalSchema = z.object({
  pasal: z.string().regex(/^Pasal \d+[A-Z]?$/),
  teks: z.string().min(20),
});
export type Pasal = z.infer<typeof PasalSchema>;

export const PasalFileSchema = z.object({
  version: z.literal(1),
  catatan: z.string(),
  sumber: z.record(z.string(), z.array(PasalSchema).min(1)),
});
export type PasalMap = Readonly<Record<string, readonly Pasal[]>>;

const DEFAULT_PATH = new URL('../../../../data/regulasi/pasal.json', import.meta.url);

export function loadPasal(path: string | URL = DEFAULT_PATH): PasalMap {
  return PasalFileSchema.parse(JSON.parse(readFileSync(path, 'utf8'))).sumber;
}

/** Awalan kunci chunk pasal; id chunk = `<id sumber>#pasal-27a` (dipakai prior retrieval di search.ts). */
export const PASAL_KEY_PREFIX = 'pasal-';

/** Satu chunk per pasal: kunci stabil `pasal-27a`, heading "Pasal 27A". */
export function pasalPieces(list: readonly Pasal[]): { key: string; heading: string; text: string }[] {
  return list.map((p) => ({
    key: PASAL_KEY_PREFIX + p.pasal.slice('Pasal '.length).toLowerCase(),
    heading: p.pasal,
    text: p.teks,
  }));
}
