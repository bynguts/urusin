import { z } from 'zod';

export const SourceRefSchema = z.object({
  url: z.url(),
  judul: z.string().min(1),
  instansi: z.string().min(1),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;

/** Kode wilayah: 2 digit (provinsi) atau 4 digit (kab/kota). Tidak ada = nasional. */
export const KodeWilayahSchema = z.string().regex(/^(\d{2}|\d{4})$/);

export const ChunkSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  sourceRef: SourceRefSchema,
  /** ISO 8601 tanggal sumber dicek; null = belum diverifikasi. Kuncinya wajib ada. */
  verifiedAt: z.iso.datetime().nullable(),
  kodeWilayah: KodeWilayahSchema.optional(),
  layanan: z.string().min(1).optional(),
});
export type Chunk = z.infer<typeof ChunkSchema>;

export const CariPengetahuanInputSchema = z.object({
  query: z.string().min(1).max(500),
  /** Kode kab/kota warga (4 digit); tanpa ini hanya korpus nasional. */
  kodeKabKota: z
    .string()
    .regex(/^\d{4}$/)
    .optional(),
  layanan: z.string().min(1).optional(),
  k: z.number().int().min(1).max(20).default(6),
});
export type CariPengetahuanInput = z.input<typeof CariPengetahuanInputSchema>;

export const CariPengetahuanOutputSchema = z.object({
  mode: z.enum(['bm25', 'hybrid']),
  /** true bila tidak ada chunk relevan: hand-off ke kanal resmi, jangan menjawab dari ingatan. */
  tanpaHasil: z.boolean(),
  hasil: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      skor: z.number(),
      kutipan: SourceRefSchema,
      verifiedAt: z.string().nullable(),
      kodeWilayah: z.string().nullable(),
      layanan: z.string().nullable(),
    }),
  ),
});
export type CariPengetahuanOutput = z.infer<typeof CariPengetahuanOutputSchema>;
