import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { KodeWilayahSchema } from '../schema.js';

/** Satu pertanyaan gold. `relevan` = id chunk ATAU url sumber (`sourceRef.url`). */
export const GoldItemSchema = z.object({
  id: z.string().min(1),
  pertanyaan: z.string().min(1),
  kodeWilayah: KodeWilayahSchema.optional(),
  relevan: z.array(z.string().min(1)).min(1),
  /** Catatan bebas, mis. 'contoh sintetis'. */
  catatan: z.string().optional(),
});
export const GoldSetSchema = z.array(GoldItemSchema).min(1);
export type GoldItem = z.infer<typeof GoldItemSchema>;

export function loadGold(path: string): GoldItem[] {
  return GoldSetSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}
