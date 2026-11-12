import { z } from 'zod';
import { IsoWaktuSchema } from './common.js';

/**
 * Data keluarga warga di brankas (melengkapi Data Diri "Saya"): anggota keluarga untuk urusan yang melibatkan
 * mereka (akta kelahiran: ayah, ibu, bayi; KK: semua anggota; KIA: anak; pindah: anggota yang ikut). Disimpan
 * terenkripsi bersama Data Diri (satu blob per pemilik); Nomor KK dan alamat dipakai bersama dari Data Diri.
 * Nilai tidak pernah ke model: placeholder `{{AYAH.NIK}}`, `{{IBU.NAMA}}`, `{{ANAK.TGL_LAHIR}}`,
 * `{{PASANGAN.NIK}}` diselesaikan server hanya setelah warga menekan "Izinkan isi".
 */

export const HubunganKeluargaSchema = z.enum([
  'pasangan',
  'suami',
  'istri',
  'anak',
  'ayah',
  'ibu',
  'lainnya',
]);
export type HubunganKeluarga = z.infer<typeof HubunganKeluargaSchema>;

export const IdAnggotaKeluargaSchema = z.string().regex(/^agt_[0-9a-f]{32}$/);

/** Paling banyak anggota per pemilik. */
export const ANGGOTA_KELUARGA_MAKS = 20;

const teks = (max: number) => z.string().trim().max(max);

/** Isian anggota (tanpa id): nama wajib, sisanya boleh menyusul. */
export const AnggotaKeluargaInputSchema = z.object({
  hubungan: HubunganKeluargaSchema,
  namaLengkap: teks(200).min(1),
  nik: z
    .string()
    .regex(/^\d{16}$/)
    .optional(),
  tanggalLahir: z.iso.date().optional(),
  jenisKelamin: z.enum(['laki-laki', 'perempuan']).optional(),
  tempatLahir: teks(100).optional(),
});
export type AnggotaKeluargaInput = z.infer<typeof AnggotaKeluargaInputSchema>;

export const AnggotaKeluargaSchema = AnggotaKeluargaInputSchema.extend({ id: IdAnggotaKeluargaSchema });
export type AnggotaKeluarga = z.infer<typeof AnggotaKeluargaSchema>;

// --- GET/POST /api/vault/keluarga, PUT/DELETE /api/vault/keluarga/[id] ---
export const DataKeluargaResponseSchema = z.object({
  anggota: z.array(AnggotaKeluargaSchema).max(ANGGOTA_KELUARGA_MAKS),
  diubahPada: IsoWaktuSchema.nullable(),
});
export type DataKeluargaResponse = z.infer<typeof DataKeluargaResponseSchema>;
export const AnggotaKeluargaResponseSchema = z.object({
  anggota: AnggotaKeluargaSchema,
  diubahPada: IsoWaktuSchema,
});
export const HapusAnggotaResponseSchema = z.object({ terhapus: z.literal(true) });

/**
 * Ringkasan ketersediaan data TANPA nilai (untuk agen): data mana yang sudah ada di brankas, agar agen meminta
 * warga melengkapi di halaman Data diri alih-alih menanyakan NIK di chat.
 */
export const RingkasanDataKeluargaSchema = z.object({
  dataDiri: z.boolean(),
  ayah: z.boolean(),
  ibu: z.boolean(),
  pasangan: z.boolean(),
  anak: z.number().int().nonnegative(),
  lainnya: z.number().int().nonnegative(),
});
export type RingkasanDataKeluarga = z.infer<typeof RingkasanDataKeluargaSchema>;

export const ENDPOINT_KELUARGA = {
  daftar: { method: 'GET', path: '/api/vault/keluarga', sukses: 200 },
  tambah: { method: 'POST', path: '/api/vault/keluarga', sukses: 201 },
  ubah: { method: 'PUT', path: '/api/vault/keluarga/[id]', sukses: 200 },
  hapus: { method: 'DELETE', path: '/api/vault/keluarga/[id]', sukses: 200 },
} as const;
