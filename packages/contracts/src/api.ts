import { z } from 'zod';
import {
  IsoWaktuSchema,
  JenisLangkahSchema,
  KodeKabKotaSchema,
  SumberSchema,
  TierSchema,
  UrusanStateSchema,
} from './common.js';

/**
 * Skema request/response tiap endpoint JSON. Semua error memakai `GalatApiSchema` (`{kode, pesanWarga}`).
 * Status sukses dan galat umum dicatat di `ENDPOINT` di bawah.
 */

// --- POST /api/urusan ---
export const BuatUrusanRequestSchema = z.object({
  /**
   * Wilayah dari pemilih di perangkat. Hanya USULAN: warga tetap diminta memastikan wilayah KTP-nya di urusan
   * (event `wilayah`); Data Diri akun yang masuk didahulukan sebagai usulan.
   */
  kodeKabKota: KodeKabKotaSchema.optional(),
  peristiwa: z.enum(['kelahiran', 'kematian', 'perkawinan', 'pindah', 'lainnya']).optional(),
  /** Pesan pertama (opsional); bila ada, satu turn langsung berjalan. */
  pesan: z.string().min(1).max(2000).optional(),
});
export const BuatUrusanResponseSchema = z.object({
  id: z.string().min(1),
  state: UrusanStateSchema,
  version: z.number().int().nonnegative(),
  chainHead: z.string(),
  turnId: z.string().optional(),
});

// --- GET /api/urusan/[id] ---
/** Status ringan untuk pemulihan klien: versi terbaru dan apakah ada turn yang benar-benar berjalan. */
export const StatusUrusanResponseSchema = z.object({
  id: z.string().min(1),
  state: UrusanStateSchema,
  version: z.number().int().nonnegative(),
  berjalan: z.boolean(),
});

// --- POST /api/urusan/[id]/turn ---
export const TurnRequestSchema = z.object({
  teks: z.string().min(1).max(2000),
  /** Opsional: version yang dilihat klien; basi → 409 dan klien mengantre lalu mengirim ulang. */
  expectedVersion: z.number().int().nonnegative().optional(),
});
export const TurnResponseSchema = z.object({ turnId: z.string().min(1), diterima: z.literal(true) });

// --- POST /api/urusan/[id]/execution-result ---
export const ExecutionResultRequestSchema = z.object({
  executionId: z.string().min(1),
  /** drift = struktur situs berubah dan adapter berhenti aman: urusan beralih ke mode dipandu. */
  status: z.enum(['berhasil', 'gagal', 'dibatalkan', 'drift']),
  /** Ringkasan netral dari ekstensi, tanpa data pribadi. */
  ringkasan: z.string().max(500).optional(),
});
export const ExecutionResultResponseSchema = z.object({
  diterima: z.literal(true),
  state: UrusanStateSchema,
  version: z.number().int().nonnegative(),
});

// --- POST /api/urusan/[id]/konfirmasi ---
export const KonfirmasiRequestSchema = z.object({
  /** Persis `tool` dan `paramsHash` dari event `execution_request` yang ditampilkan ke warga. */
  tool: z.string().min(1),
  paramsHash: z.string().min(1),
});
export const KonfirmasiResponseSchema = z.object({
  confirmationId: z.string().min(1),
  kedaluwarsa: IsoWaktuSchema,
});

// --- POST /api/urusan/[id]/wilayah ---
/** Tombol "Ya, betul" / pilihan kab/kota: warga memastikan wilayah KTP urusan ini. */
export const TetapkanWilayahRequestSchema = z.object({
  kodeKabKota: KodeKabKotaSchema,
  expectedVersion: z.number().int().nonnegative().optional(),
});
export const TetapkanWilayahResponseSchema = z.object({
  state: UrusanStateSchema,
  version: z.number().int().nonnegative(),
  /** true bila rencana langsung diusulkan (jenis urusan sudah diketahui). */
  rencana: z.boolean(),
  /** Tanpa rencana tetapi sudah ada percakapan: giliran agen dilanjutkan untuk wilayah ini (ikuti lewat stream). */
  turnId: z.string().optional(),
});

// --- GET /api/urusan?ids=a,b ---
export const RingkasanUrusanSchema = z.object({
  id: z.string().min(1),
  state: UrusanStateSchema,
  version: z.number().int().nonnegative(),
  kodeKabKota: KodeKabKotaSchema.nullable(),
  /** Menunggu siapa: dipakai layar /lacak. */
  menunggu: z.enum(['warga', 'instansi', 'sistem']).nullable(),
  dibuatPada: IsoWaktuSchema,
  diubahPada: IsoWaktuSchema,
});
export const DaftarUrusanResponseSchema = z.object({ urusan: z.array(RingkasanUrusanSchema) });

// --- GET /api/urusan/[id]/jejak dan /api/transparansi ---
export const JejakItemSchema = z.discriminatedUnion('jenis', [
  z.object({
    jenis: z.literal('event'),
    seq: z.number().int(),
    at: IsoWaktuSchema,
    type: z.string(),
    ringkas: z.string(),
  }),
  z.object({
    jenis: z.literal('span'),
    id: z.string(),
    at: IsoWaktuSchema,
    nama: z.string(),
    operasi: z.string(),
    durasiMs: z.number(),
    model: z.string().optional(),
    tokenMasuk: z.number().optional(),
    tokenKeluar: z.number().optional(),
    biayaIdr: z.number().optional(),
    modeStruktur: z.string().optional(),
    status: z.enum(['ok', 'error']),
  }),
]);
export const JejakResponseSchema = z.object({
  urusanId: z.string(),
  state: UrusanStateSchema,
  version: z.number().int().nonnegative(),
  chainHead: z.string(),
  rantai: z.object({
    valid: z.boolean(),
    jumlahEvent: z.number().int().nonnegative(),
    rusakDiSeq: z.number().int().optional(),
  }),
  biayaIdr: z.number(),
  tokenMasuk: z.number(),
  tokenKeluar: z.number(),
  timeline: z.array(JejakItemSchema),
});

export const TransparansiResponseSchema = z.object({
  jendela: z.object({ dari: IsoWaktuSchema, sampai: IsoWaktuSchema }),
  latensiMs: z.object({ p50: z.number(), p95: z.number(), sampel: z.number().int() }),
  biayaPerHariIdr: z.array(
    z.object({ hari: z.string(), biayaIdr: z.number(), permintaan: z.number().int() }),
  ),
  persenDegraded: z.number(),
  totalPermintaan: z.number().int(),
});

// --- Referensi: kota, peristiwa, pengetahuan ---
export const KotaSchema = z.object({
  kodeKabKota: KodeKabKotaSchema,
  nama: z.string().min(1),
  tier: TierSchema,
  validasi: z.enum(['kirim-asli', 'read-only', 'pending-recon', 'tidak-ada-portal']),
  verifiedAt: IsoWaktuSchema.nullable(),
});
export const WilayahResponseSchema = z.object({ kota: z.array(KotaSchema) });

export const LangkahPeristiwaSchema = z.object({
  id: z.string(),
  judul: z.string(),
  jenis: JenisLangkahSchema,
  lokasi: z.string().optional(),
  dependsOn: z.array(z.string()),
  dokumen: z.array(z.string()),
  bawa: z.array(z.string()),
  keterangan: z.string(),
  sumber: z.array(SumberSchema),
  verifiedAt: IsoWaktuSchema.nullable(),
});
export const PeristiwaResponseSchema = z.object({
  slug: z.string(),
  judul: z.string(),
  tier: TierSchema,
  /** null = lintas instansi / belum memilih kota. */
  kodeKabKota: KodeKabKotaSchema.nullable(),
  kota: KotaSchema.nullable(),
  keluaran: z.array(z.string()),
  peringatan: z.string().optional(),
  catatan: z.string(),
  langkah: z.array(LangkahPeristiwaSchema).min(1),
});

export const HasilPengetahuanSchema = z.object({
  refId: z.string(),
  judul: z.string(),
  instansi: z.string(),
  url: z.url(),
  cuplikan: z.string(),
  verifiedAt: IsoWaktuSchema.nullable(),
  perluDicekUlang: z.boolean(),
});
export const PengetahuanResponseSchema = z.object({
  hasil: z.array(HasilPengetahuanSchema),
  /** Diisi bila tidak ada sumber yang cukup relevan: UI menampilkan hand-off, bukan jawaban. */
  abstain: z.object({ alasan: z.enum(['di_luar_cakupan', 'skor_rendah']) }).nullable(),
});

// --- GET /api/health (bagian untuk store `capabilities`) ---
export const KapabilitasSchema = z.object({
  ai: z.enum(['normal', 'hemat', 'tanpa_ai']),
  vision: z.boolean(),
  rag: z.enum(['siap', 'tidak_siap']),
});
export const HealthResponseSchema = z.object({
  ok: z.boolean(),
  status: z.string(),
  gitSha: z.string(),
  version: z.string(),
  kapabilitas: KapabilitasSchema.optional(),
});

// --- Hanya skema (belum diimplementasi): kartu, sambung, hapus data ---
export const KartuResponseSchema = z.object({
  layanan: z.string(),
  judul: z.string(),
  kodeKabKota: KodeKabKotaSchema,
  bawa: z.array(z.string()),
  lokasi: z.string(),
  catatan: z.string().optional(),
  sumber: z.array(SumberSchema),
  verifiedAt: IsoWaktuSchema.nullable(),
});
export const SambungResponseSchema = z.object({
  /** Kode 6 digit untuk diketik manual. */
  kode: z.string().regex(/^\d{6}$/),
  qrPayload: z.string().min(1),
  kedaluwarsa: IsoWaktuSchema,
});
export const SambungKlaimRequestSchema = z.object({ kode: z.string().regex(/^\d{6}$/) });
export const SambungKlaimResponseSchema = z.object({
  /** Kunci publik laptop untuk relay ECDH; pesan sesungguhnya dienkripsi klien. */
  kunciPublikLaptop: z.string().min(1),
  kedaluwarsa: IsoWaktuSchema,
});
export const HapusDataRequestSchema = z.object({
  urusanIds: z.array(z.string()).min(1).max(100),
});
export const HapusDataResponseSchema = z.object({ terhapus: z.number().int().nonnegative() });

/** Metadata endpoint untuk dokumentasi dan klien. `diimplementasi: false` = hanya skema. */
export const ENDPOINT = {
  buatUrusan: { method: 'POST', path: '/api/urusan', sukses: 201, diimplementasi: true },
  turn: { method: 'POST', path: '/api/urusan/[id]/turn', sukses: 202, diimplementasi: true },
  // Laporan ekstensi; dihapus bersama ekstensi (hasil kini lewat status Browser Pendamping). Skema tetap (beku).
  executionResult: {
    method: 'POST',
    path: '/api/urusan/[id]/execution-result',
    sukses: 200,
    diimplementasi: false,
  },
  konfirmasi: { method: 'POST', path: '/api/urusan/[id]/konfirmasi', sukses: 201, diimplementasi: true },
  tetapkanWilayah: { method: 'POST', path: '/api/urusan/[id]/wilayah', sukses: 200, diimplementasi: true },
  statusUrusan: { method: 'GET', path: '/api/urusan/[id]', sukses: 200, diimplementasi: true },
  daftarUrusan: { method: 'GET', path: '/api/urusan', sukses: 200, diimplementasi: true },
  stream: { method: 'GET', path: '/api/urusan/[id]/stream', sukses: 200, diimplementasi: true },
  jejak: { method: 'GET', path: '/api/urusan/[id]/jejak', sukses: 200, diimplementasi: true },
  peristiwa: { method: 'GET', path: '/api/peristiwa/[slug]', sukses: 200, diimplementasi: true },
  wilayah: { method: 'GET', path: '/api/wilayah', sukses: 200, diimplementasi: true },
  pengetahuan: { method: 'GET', path: '/api/pengetahuan', sukses: 200, diimplementasi: true },
  transparansi: { method: 'GET', path: '/api/transparansi', sukses: 200, diimplementasi: true },
  health: { method: 'GET', path: '/api/health', sukses: 200, diimplementasi: true },
  kartu: { method: 'GET', path: '/api/kartu/[layanan]', sukses: 200, diimplementasi: false },
  sambung: { method: 'POST', path: '/api/sambung', sukses: 201, diimplementasi: false },
  sambungKlaim: { method: 'POST', path: '/api/sambung/klaim', sukses: 200, diimplementasi: false },
  hapusData: { method: 'DELETE', path: '/api/data', sukses: 200, diimplementasi: false },
  // Browser Pendamping (skema di pendamping.ts)
  pendampingMulai: {
    method: 'POST',
    path: '/api/urusan/[id]/pendamping',
    sukses: 201,
    diimplementasi: true,
  },
  pendampingStatus: { method: 'GET', path: '/api/urusan/[id]/pendamping', sukses: 200, diimplementasi: true },
  pendampingTiket: {
    method: 'POST',
    path: '/api/urusan/[id]/pendamping/tiket',
    sukses: 201,
    diimplementasi: true,
  },
  pendampingSerahkan: {
    method: 'POST',
    path: '/api/urusan/[id]/pendamping/serahkan',
    sukses: 200,
    diimplementasi: true,
  },
  pendampingAkhiri: {
    method: 'DELETE',
    path: '/api/urusan/[id]/pendamping',
    sukses: 200,
    diimplementasi: true,
  },
  pendampingAntrean: { method: 'GET', path: '/api/pendamping/antrean', sukses: 200, diimplementasi: true },
} as const;

export type BuatUrusanRequest = z.infer<typeof BuatUrusanRequestSchema>;
export type BuatUrusanResponse = z.infer<typeof BuatUrusanResponseSchema>;
export type TurnRequest = z.infer<typeof TurnRequestSchema>;
export type TurnResponse = z.infer<typeof TurnResponseSchema>;
export type ExecutionResultRequest = z.infer<typeof ExecutionResultRequestSchema>;
export type ExecutionResultResponse = z.infer<typeof ExecutionResultResponseSchema>;
export type KonfirmasiRequest = z.infer<typeof KonfirmasiRequestSchema>;
export type KonfirmasiResponse = z.infer<typeof KonfirmasiResponseSchema>;
export type TetapkanWilayahRequest = z.infer<typeof TetapkanWilayahRequestSchema>;
export type TetapkanWilayahResponse = z.infer<typeof TetapkanWilayahResponseSchema>;
export type RingkasanUrusan = z.infer<typeof RingkasanUrusanSchema>;
export type StatusUrusanResponse = z.infer<typeof StatusUrusanResponseSchema>;
export type DaftarUrusanResponse = z.infer<typeof DaftarUrusanResponseSchema>;
export type JejakItem = z.infer<typeof JejakItemSchema>;
export type JejakResponse = z.infer<typeof JejakResponseSchema>;
export type TransparansiResponse = z.infer<typeof TransparansiResponseSchema>;
export type Kota = z.infer<typeof KotaSchema>;
export type WilayahResponse = z.infer<typeof WilayahResponseSchema>;
export type PeristiwaResponse = z.infer<typeof PeristiwaResponseSchema>;
export type PengetahuanResponse = z.infer<typeof PengetahuanResponseSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type KartuResponse = z.infer<typeof KartuResponseSchema>;
export type SambungResponse = z.infer<typeof SambungResponseSchema>;
export type SambungKlaimRequest = z.infer<typeof SambungKlaimRequestSchema>;
export type SambungKlaimResponse = z.infer<typeof SambungKlaimResponseSchema>;
export type HapusDataRequest = z.infer<typeof HapusDataRequestSchema>;
export type HapusDataResponse = z.infer<typeof HapusDataResponseSchema>;
