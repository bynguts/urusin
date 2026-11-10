import { z } from 'zod';

export const URUSAN_STATES = [
  'BARU',
  'MEMAHAMI',
  'RENCANA_DIUSULKAN',
  'RENCANA_DISETUJUI',
  'MENYIAPKAN_BERKAS',
  'BERKAS_SIAP',
  'MENUNGGU_LOGIN_WARGA',
  'MENUNGGU_PROFIL_WARGA',
  'MENGISI',
  'MENUNGGU_KONFIRMASI',
  'MENGUNGGAH',
  'MENUNGGU_SUBMIT_WARGA',
  'TERKIRIM',
  'DIPANTAU',
  'SELESAI',
  'DITOLAK',
  'DIBATALKAN',
  'DIPANDU',
  'GAGAL_AMAN',
] as const;
export const UrusanStateSchema = z.enum(URUSAN_STATES);
export type UrusanState = z.infer<typeof UrusanStateSchema>;

/** Tier kota: `semi` = adapter mengisi formulir, warga klik final; `dipandu` = panduan langkah saja. */
export const TierSchema = z.enum(['semi', 'dipandu']);
export type Tier = z.infer<typeof TierSchema>;

export const KodeKabKotaSchema = z.string().regex(/^\d{4}$/, 'empat digit kode kab/kota');

export const IsoWaktuSchema = z.iso.datetime();

/** Sumber resmi: tautan, judul halaman, instansi. */
export const SumberSchema = z.object({
  url: z.url(),
  judul: z.string().min(1),
  instansi: z.string().min(1),
});
export type Sumber = z.infer<typeof SumberSchema>;

/** Format error seragam di semua endpoint JSON. `pesanWarga` boleh ditampilkan apa adanya ke warga. */
export const GalatApiSchema = z.object({
  kode: z.string().min(1),
  pesanWarga: z.string().min(1),
});
export type GalatApi = z.infer<typeof GalatApiSchema>;

/**
 * online-adapter = Browser Pendamping mengisi; online-manual = warga mengisi online di kanal terverifikasi;
 * offline = datang ke kantor; cek-kanal = cara (online/loket) belum terverifikasi: warga memastikannya di kanal
 * Disdukcapil setempat.
 */
export const JenisLangkahSchema = z.enum(['online-adapter', 'online-manual', 'offline', 'cek-kanal']);
export type JenisLangkah = z.infer<typeof JenisLangkahSchema>;
