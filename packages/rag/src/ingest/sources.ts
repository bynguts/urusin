import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { KodeWilayahSchema, LayananKorpusSchema } from '../schema.js';

export const SourceEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  url: z.url(),
  judul: z.string().min(1),
  instansi: z.string().min(1),
  jenis: z.enum(['halaman', 'pdf', 'regulasi']),
  domain: z.string().min(1),
  kodeWilayah: KodeWilayahSchema.nullable(),
  layanan: LayananKorpusSchema.nullable(),
  status: z.enum(['confirmed', 'unverified']),
  robots: z.enum(['ditemukan', 'tidak-ada', 'tidak-terjangkau']),
  lastFetched: z.string().nullable(),
  /** Adapter khusus untuk sumber non-HTML (katalog GraphQL); tanpa ini = halaman HTML biasa. */
  adapter: z.enum(['klampid']).optional(),
  /** false = bukan sumber korpus (mis. portal login atau butuh ingester khusus). */
  ingest: z.boolean(),
  catatan: z.string(),
});
export type SourceEntry = z.infer<typeof SourceEntrySchema>;

export const SourcesFileSchema = z.object({
  version: z.literal(1),
  catatan: z.string(),
  sources: z.array(SourceEntrySchema),
});

export function loadSources(path: string): SourceEntry[] {
  return SourcesFileSchema.parse(JSON.parse(readFileSync(path, 'utf8'))).sources;
}
