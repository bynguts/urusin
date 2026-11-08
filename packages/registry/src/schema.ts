import { z } from 'zod';

export const SourceRefSchema = z.object({
  url: z.url(),
  judul: z.string().min(1),
  instansi: z.string().min(1),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;

/** Empat digit pertama NIK = kode kab/kota (tanpa titik), mis. "3312". */
export const KodeKabKotaSchema = z.string().regex(/^\d{4}$/);

export const CityEntrySchema = z.object({
  kodeKabKota: KodeKabKotaSchema,
  nama: z.string().min(1),
  tier: z.enum(['semi', 'dipandu']),
  /** Status validasi apa adanya (rencana §3.8). */
  validasi: z.enum(['kirim-asli', 'read-only', 'pending-recon', 'tidak-ada-portal']),
  portal: z
    .object({
      origin: z
        .url()
        .refine((u) => u.startsWith('https://') && new URL(u).origin === u, 'origin https tanpa path'),
      nama: z.string().min(1),
    })
    .optional(),
  adapterId: z.string().min(1).optional(),
  sourceRef: z.array(SourceRefSchema),
  /** ISO 8601; null = belum diverifikasi tangan. */
  verifiedAt: z.iso.datetime().nullable(),
  catatan: z.string(),
});
export type CityEntry = z.infer<typeof CityEntrySchema>;
