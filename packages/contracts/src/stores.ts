import { z } from 'zod';
import { UrusanStateSchema } from './common.js';
import type { UrusinEvent } from './events.js';

/**
 * Antarmuka store UI (Svelte 5 runes, di apps/web/src/lib/stores). UI hanya MEMBACA state dan memanggil
 * method. Interface di sini adalah kontrak; implementasi `urusan`, `capabilities`, `connectivity`,
 * `prefs`, `tts` ada di apps/web, sedangkan `vault`, `dompet`, `extension` menyusul.
 */

// --- Keadaan umum yang dibaca layar ---
export const KeadaanKoneksiSchema = z.object({
  online: z.boolean(),
  hemat: z.boolean(),
});
export type KeadaanKoneksi = z.infer<typeof KeadaanKoneksiSchema>;

export const PrefsSchema = z.object({
  /** Skala ukuran huruf dasar: 1 = 18px. */
  ukuranHuruf: z.union([z.literal(1), z.literal(1.125), z.literal(1.25), z.literal(1.5)]),
  bacakanOtomatis: z.boolean(),
  hematData: z.boolean(),
  tema: z.enum(['terang', 'gelap', 'sistem']),
  modeUji: z.boolean(),
  modePresentasi: z.boolean(),
});
export type Prefs = z.infer<typeof PrefsSchema>;
export const PREFS_DEFAULT: Prefs = {
  ukuranHuruf: 1,
  bacakanOtomatis: false,
  hematData: false,
  tema: 'sistem',
  modeUji: false,
  modePresentasi: false,
};

// --- Status koneksi stream urusan ---
export type StatusStream = 'diam' | 'menghubungkan' | 'tersambung' | 'terputus' | 'selesai';

/** State turunan dari event SSE; semua yang dibutuhkan layar `/urusan/[id]`. */
export type KeadaanUrusan = {
  id: string | null;
  status: StatusStream;
  state: z.infer<typeof UrusanStateSchema> | null;
  version: number;
  chainHead: string | null;
  lastSeq: number;
  /** Teks progres terakhir, null bila tidak ada turn berjalan. */
  progres: string | null;
  sedangBerjalan: boolean;
  jawaban: Extract<UrusinEvent, { type: 'grounded_answer' }> | null;
  handoff: Extract<UrusinEvent, { type: 'handoff' }> | null;
  rencana: Extract<UrusinEvent, { type: 'plan_card' }> | null;
  checklist: Extract<UrusinEvent, { type: 'checklist' }> | null;
  kelayakan: Extract<UrusinEvent, { type: 'eligibility' }> | null;
  permintaanEksekusi: Extract<UrusinEvent, { type: 'execution_request' }> | null;
  gate: Extract<UrusinEvent, { type: 'gate' }> | null;
  degraded: Extract<UrusinEvent, { type: 'degraded' }> | null;
  galat: Extract<UrusinEvent, { type: 'error' }> | null;
  teksAsisten: string;
  /** true bila agen di mode degraded meminta warga mengirim "lanjut". */
  perluLanjut: boolean;
  /** Event mentah berurutan, untuk timeline/debug. */
  events: readonly UrusinEvent[];
};

export interface StoreUrusan {
  readonly keadaan: KeadaanUrusan;
  /** Buka stream (resume dari `lastSeq` lewat Last-Event-ID) dan terapkan event ke state. */
  sambung(id: string): void;
  putus(): void;
  /** Terapkan satu event; dipakai stream dan pemutar fixture. */
  terapkan(e: UrusinEvent): void;
  reset(): void;
}

// --- Kemampuan perangkat/server ---
export type KeadaanKapabilitas = {
  ai: 'normal' | 'hemat' | 'tanpa_ai';
  vision: boolean;
  rag: 'siap' | 'tidak_siap' | 'tidak_diketahui';
  dimuat: boolean;
};
export interface StoreKapabilitas {
  readonly keadaan: KeadaanKapabilitas;
  muat(): Promise<void>;
}

export interface StoreKoneksi {
  readonly keadaan: KeadaanKoneksi;
}

export interface StorePrefs {
  readonly nilai: Prefs;
  atur<K extends keyof Prefs>(kunci: K, nilai: Prefs[K]): void;
}

export interface StoreTts {
  readonly tersedia: boolean;
  readonly membaca: boolean;
  baca(teks: string): void;
  berhenti(): void;
}

// --- Antarmuka saja (implementasi menyusul) ---
export type DokumenDompet = {
  id: string;
  jenis: 'ktp' | 'kk' | 'akta' | 'surat' | 'foto' | 'lainnya';
  judul: string;
  disimpanPada: string;
  /** Kedaluwarsa masa simpan; null = sampai dihapus warga. */
  simpanSampai: string | null;
  dipakaiDiUrusan: string[];
};
export interface StoreDompet {
  readonly dokumen: readonly DokumenDompet[];
  muat(): Promise<void>;
  hapus(id: string): Promise<void>;
}

export interface StoreVault {
  readonly terkunci: boolean;
  /** Vault berisi data diri terenkripsi di perangkat; server tidak pernah memegang nilainya. */
  buka(frasa: string): Promise<boolean>;
  kunci(): void;
  /** Mengisi placeholder menjadi nilai asli, hanya di sisi klien/ekstensi. */
  resolve(placeholder: string): Promise<string | null>;
}

export const StatusEkstensiSchema = z.enum([
  'belum_dipasang',
  'belum_dipasangkan',
  'siap',
  'menunggu_warga',
  'mengisi',
  'menunggu_selesai',
  'selesai',
  'galat',
]);
export type StatusEkstensi = z.infer<typeof StatusEkstensiSchema>;

export interface StoreEkstensi {
  readonly status: StatusEkstensi;
  readonly versi: string | null;
  deteksi(): Promise<void>;
  jalankan(permintaan: Extract<UrusinEvent, { type: 'execution_request' }>): Promise<void>;
}

/** Keadaan layar tanpa data server (memuat, kosong, offline, izin ditolak, dst.). */
export const KeadaanLayarSchema = z.object({
  keadaan: z.enum([
    'memuat',
    'kosong',
    'offline',
    'sesi_habis',
    'izin_ditolak',
    'tanpa_ekstensi',
    'browser_tidak_didukung',
    'belum_diinstal',
    'mode_uji',
    'mode_presentasi',
    'ekstensi_belum_dipasangkan',
    'ekstensi_id_salah',
    'ekstensi_menunggu_warga',
    'ekstensi_mengisi',
    'ekstensi_menunggu_selesai',
    'ekstensi_selesai',
    'adapter_drift_dipandu',
  ]),
  pesanWarga: z.string().min(1),
  /** Satu tombol aksi utama bila ada. */
  aksi: z.string().optional(),
  izin: z.enum(['kamera', 'mikrofon', 'notifikasi', 'penyimpanan']).optional(),
});
export type KeadaanLayar = z.infer<typeof KeadaanLayarSchema>;
