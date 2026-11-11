import { z } from 'zod';
import { IsoWaktuSchema } from './common.js';

/**
 * Ingatan warga (ADR 0031): fakta terbatas yang warga nyatakan sendiri, disimpan terenkripsi di vault pemilik dan
 * dipakai lintas urusan. Bukan teks bebas tak terbatas: jenis butir tetap, catatan paling banyak 10 butir masing-masing
 * paling panjang 200 karakter. PII (NIK, KK, HP, email, nama ibu, alamat lengkap) tidak pernah masuk ke sini.
 *
 * - ktp/domisili/tujuan: kode kab/kota (4 digit) sesuai yang warga sebut;
 * - bahasa_sederhana/lansia: `ya`;
 * - kanal: `online` atau `datang`;
 * - aksesibilitas/catatan: teks pendek dari ucapan warga.
 */
export const JenisButirIngatanSchema = z.enum([
  'ktp',
  'domisili',
  'tujuan',
  'bahasa_sederhana',
  'lansia',
  'kanal',
  'aksesibilitas',
  'catatan',
]);
export type JenisButirIngatan = z.infer<typeof JenisButirIngatanSchema>;

export const BATAS_INGATAN = Object.freeze({ catatanMaks: 10, panjangMaks: 200 });

export const IdButirIngatanSchema = z.string().regex(/^ing_[0-9a-f]{16}$/);

/** Satu butir tersimpan (isi vault, terenkripsi). */
export const ButirIngatanSchema = z.object({
  id: IdButirIngatanSchema,
  jenis: JenisButirIngatanSchema,
  nilai: z.string().min(1).max(BATAS_INGATAN.panjangMaks),
  at: IsoWaktuSchema,
});
export type ButirIngatan = z.infer<typeof ButirIngatanSchema>;

/** Butir yang ditampilkan ke warga: `label` = kalimat siap baca ("Domisili: Kota Semarang"). */
export const ButirIngatanTampilSchema = z.object({
  id: IdButirIngatanSchema,
  jenis: JenisButirIngatanSchema,
  label: z.string().min(1).max(260),
  at: IsoWaktuSchema,
});
export type ButirIngatanTampil = z.infer<typeof ButirIngatanTampilSchema>;

/** Butir di kartu chat (event `ingatan`): tanpa waktu (amplop event sudah membawa `at`). */
export const ButirIngatanKartuSchema = ButirIngatanTampilSchema.omit({ at: true });
export type ButirIngatanKartu = z.infer<typeof ButirIngatanKartuSchema>;

// --- GET /api/ingatan ---
export const IngatanResponseSchema = z.object({
  butir: z.array(ButirIngatanTampilSchema),
});
export type IngatanResponse = z.infer<typeof IngatanResponseSchema>;

// --- DELETE /api/ingatan, DELETE /api/ingatan/[id] ---
export const HapusIngatanResponseSchema = z.object({
  dihapus: z.number().int().nonnegative(),
});
export type HapusIngatanResponse = z.infer<typeof HapusIngatanResponseSchema>;
