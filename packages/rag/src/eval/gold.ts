import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { KodeWilayahSchema } from '../schema.js';

/**
 * Satu pertanyaan gold. `relevan` = id chunk ATAU url sumber (`sourceRef.url`). Pertanyaan di luar
 * cakupan korpus (`luarCakupan: true`) tidak punya jawaban: `relevan` kosong dan jawaban benar = abstain.
 */
export const GoldItemSchema = z
  .object({
    id: z.string().min(1),
    pertanyaan: z.string().min(1),
    kodeWilayah: KodeWilayahSchema.optional(),
    relevan: z.array(z.string().min(1)),
    luarCakupan: z.boolean().optional(),
    /** Catatan bebas, mis. 'contoh sintetis'. */
    catatan: z.string().optional(),
  })
  .refine((g) => (g.luarCakupan ? g.relevan.length === 0 : g.relevan.length > 0), {
    message: 'relevan wajib terisi, kecuali luarCakupan (harus kosong)',
    path: ['relevan'],
  });
export const GoldSetSchema = z.array(GoldItemSchema).min(1);
export type GoldItem = z.infer<typeof GoldItemSchema>;

export function loadGold(path: string): GoldItem[] {
  return GoldSetSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}
