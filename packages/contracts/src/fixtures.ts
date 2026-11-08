import { z } from 'zod';
import * as api from './api.js';
import { GalatApiSchema } from './common.js';
import { UrusinEventSchema } from './events.js';
import { KeadaanLayarSchema } from './stores.js';

/**
 * Format berkas fixture `fixtures/<layar>/<state>.json`:
 * `{ "skema": "<nama di SKEMA_FIXTURE>", "data": <isi sesuai skema>, "catatan"?: "..." }`.
 * Fixture `skema: "sse"` adalah urutan event yang dapat diputar `GET /dev/fixtures/sse?skenario=<layar>/<state>`.
 * Desain di pen.dev diisi dari fixture ini.
 */
export const SKEMA_FIXTURE = {
  sse: z.array(UrusinEventSchema).min(1),
  keadaan_layar: KeadaanLayarSchema,
  galat: GalatApiSchema,
  buat_urusan: api.BuatUrusanResponseSchema,
  daftar_urusan: api.DaftarUrusanResponseSchema,
  jejak: api.JejakResponseSchema,
  transparansi: api.TransparansiResponseSchema,
  wilayah: api.WilayahResponseSchema,
  peristiwa: api.PeristiwaResponseSchema,
  pengetahuan: api.PengetahuanResponseSchema,
  health: api.HealthResponseSchema,
  kartu: api.KartuResponseSchema,
  sambung: api.SambungResponseSchema,
} as const;
export type NamaSkemaFixture = keyof typeof SKEMA_FIXTURE;

export const BerkasFixtureSchema = z.object({
  skema: z.enum(Object.keys(SKEMA_FIXTURE) as [NamaSkemaFixture, ...NamaSkemaFixture[]]),
  data: z.unknown(),
  catatan: z.string().optional(),
});
export type BerkasFixture = z.infer<typeof BerkasFixtureSchema>;

/** Validasi satu berkas fixture terhadap skemanya; melempar ZodError bila tidak cocok. */
export function parseFixture(raw: unknown): { skema: NamaSkemaFixture; data: unknown } {
  const berkas = BerkasFixtureSchema.parse(raw);
  const data = SKEMA_FIXTURE[berkas.skema].parse(berkas.data);
  return { skema: berkas.skema, data };
}
