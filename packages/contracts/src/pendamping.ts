import { z } from 'zod';
import { IsoWaktuSchema } from './common.js';

/**
 * Kontrak "Browser Pendamping": peramban Chromium di server yang layarnya dialirkan ke perangkat warga.
 * - AI mengisi formulir lewat Step DSL (mode `ai`); warga mengambil alih untuk login/OTP/CAPTCHA dan
 *   menekan Kirim sendiri (mode `takeover`); sesi dihancurkan setelah selesai (mode `done`).
 * - HTTP publik lewat web app (cookie `urusin_sid`); WebSocket langsung ke layanan pendamping dengan tiket
 *   sekali pakai yang dikirim sebagai pesan pertama (`halo`), bukan di URL.
 * Nama memakai bahasa Indonesia; nilai `mode` mengikuti istilah ai|takeover|done.
 */

export const PendampingModeSchema = z.enum(['ai', 'takeover', 'done']);
export type PendampingMode = z.infer<typeof PendampingModeSchema>;

/** Siklus hidup sesi. Status akhir: selesai, gagal, dipandu, kedaluwarsa, dibatalkan. */
export const PendampingStatusSchema = z.enum([
  'antre',
  'memulai',
  'menunggu_data',
  'berjalan',
  'selesai',
  'gagal',
  'dipandu',
  'kedaluwarsa',
  'dibatalkan',
]);
export type PendampingStatus = z.infer<typeof PendampingStatusSchema>;

/** Hasil akhir yang dilaporkan ke urusan (selaras dengan `ExecutionResultRequest.status`). */
export const PendampingHasilSchema = z.enum(['berhasil', 'gagal', 'dibatalkan', 'drift']);
export type PendampingHasil = z.infer<typeof PendampingHasilSchema>;

/** Ukuran layar perangkat warga (piksel CSS); dipakai sebagai viewport peramban pendamping. */
export const PendampingViewportSchema = z.object({
  lebar: z.number().int().min(320).max(1280),
  tinggi: z.number().int().min(480).max(1600),
  dpr: z.number().min(1).max(4),
  seluler: z.boolean(),
});
export type PendampingViewport = z.infer<typeof PendampingViewportSchema>;

export const PendampingAntreanSchema = z.object({
  /** 1 = berikutnya. */
  posisi: z.number().int().positive(),
  panjang: z.number().int().positive(),
});
export type PendampingAntrean = z.infer<typeof PendampingAntreanSchema>;

/** Kotak sorotan (piksel CSS viewport) untuk elemen yang harus disentuh warga. */
export const PendampingSorotSchema = z.object({
  x: z.number(),
  y: z.number(),
  lebar: z.number().nonnegative(),
  tinggi: z.number().nonnegative(),
});
export type PendampingSorot = z.infer<typeof PendampingSorotSchema>;

export const PendampingKodeGalatSchema = z.enum([
  'TIKET_TIDAK_SAH',
  'ORIGIN_DITOLAK',
  'SESI_TIDAK_ADA',
  'SESI_BUKAN_MILIK',
  'SESI_SUDAH_ADA',
  'ANTREAN_PENUH',
  'PESAN_TIDAK_SAH',
  'INPUT_DITOLAK_MODE_AI',
  'BERKAS_TERLALU_BESAR',
  'DATA_KURANG',
  'ADAPTER_TIDAK_ADA',
  'EKSEKUSI_TIDAK_DITEMUKAN',
  'FINAL_NOT_AUTOMATABLE',
  'ADAPTER_DRIFT',
  'SITUS_MEMBLOKIR',
  'KEDALUWARSA',
  'LAYANAN_TIDAK_TERSEDIA',
  'INTERNAL',
]);
export type PendampingKodeGalat = z.infer<typeof PendampingKodeGalatSchema>;

/** Galat pendamping memakai bentuk seragam `{kode, pesanWarga}` (lihat `GalatApiSchema`). */
export const PendampingGalatSchema = z.object({
  kode: PendampingKodeGalatSchema,
  pesanWarga: z.string().min(1),
});
export type PendampingGalat = z.infer<typeof PendampingGalatSchema>;

/** Status sesi untuk UI (layar antrean, banner mode, layar selesai). Tanpa data pribadi. */
export const SesiPendampingSchema = z.object({
  sesiId: z.string().min(1),
  urusanId: z.string().min(1),
  executionId: z.string().min(1),
  status: PendampingStatusSchema,
  /** null selama antre/memulai. */
  mode: PendampingModeSchema.nullable(),
  antrean: PendampingAntreanSchema.nullable(),
  dibuatPada: IsoWaktuSchema,
  /** Batas umur sesi (TTL); sesi dihancurkan paling lambat pada waktu ini. */
  kedaluwarsaPada: IsoWaktuSchema,
  /** Pesan untuk warga (mis. "Giliran Anda: ketik kode CAPTCHA"). */
  pesan: z.string().optional(),
  hasil: PendampingHasilSchema.optional(),
});
export type SesiPendamping = z.infer<typeof SesiPendampingSchema>;

// --- POST /api/urusan/[id]/pendamping (warga, lewat web app) ---
export const MulaiPendampingRequestSchema = z.object({
  /** `executionId` dari event `execution_request` yang sudah disetujui warga. */
  executionId: z.string().min(1).max(100),
  viewport: PendampingViewportSchema.optional(),
});
export type MulaiPendampingRequest = z.infer<typeof MulaiPendampingRequestSchema>;

// --- POST /api/urusan/[id]/pendamping/tiket ---
export const TiketPendampingResponseSchema = z.object({
  /** URL WebSocket (wss di produksi). Tiket dikirim sebagai pesan pertama `halo`, bukan di URL. */
  wsUrl: z.string().min(1),
  tiket: z.string().min(16),
  kedaluwarsa: IsoWaktuSchema,
});
export type TiketPendampingResponse = z.infer<typeof TiketPendampingResponseSchema>;

// --- GET /api/pendamping/antrean ---
export const AntreanPendampingResponseSchema = z.object({
  aktif: z.number().int().nonnegative(),
  maks: z.number().int().positive(),
  menunggu: z.number().int().nonnegative(),
});
export type AntreanPendampingResponse = z.infer<typeof AntreanPendampingResponseSchema>;

// --- API internal web -> layanan pendamping (Authorization: Bearer <token bersama>) ---
export const MulaiSesiInternalSchema = z.object({
  urusanId: z.string().min(1),
  /** sha256(urusin_sid) dalam hex: pendamping tidak pernah melihat cookie mentah. */
  sidHash: z.string().regex(/^[0-9a-f]{64}$/),
  executionId: z.string().min(1),
  adapterId: z.string().min(1),
  flowId: z.string().min(1),
  /** Origin portal resmi dari registry (https). */
  origin: z.url(),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  viewport: PendampingViewportSchema.optional(),
});
export type MulaiSesiInternal = z.infer<typeof MulaiSesiInternalSchema>;

export const PemilikSesiInternalSchema = z.object({
  urusanId: z.string().min(1),
  sidHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type PemilikSesiInternal = z.infer<typeof PemilikSesiInternalSchema>;

// --- WebSocket: perangkat warga -> pendamping ---
const koordinat = z.number().min(-10_000).max(10_000);
/** Bitmask modifier CDP: Alt=1, Ctrl=2, Meta=4, Shift=8. */
const modifier = z.number().int().min(0).max(15);

export const PendampingClientMessageSchema = z.discriminatedUnion('type', [
  /** Wajib pesan pertama; tiket sekali pakai dari POST /tiket. */
  z.object({ type: z.literal('halo'), tiket: z.string().min(16).max(200) }),
  z.object({
    type: z.literal('pointer'),
    aksi: z.enum(['down', 'move', 'up', 'cancel']),
    /** Koordinat piksel CSS viewport peramban pendamping (sudah dipetakan klien). */
    x: koordinat,
    y: koordinat,
    jenis: z.enum(['mouse', 'touch', 'pen']),
    tombol: z.enum(['none', 'left', 'middle', 'right']),
    klik: z.number().int().min(0).max(3).optional(),
    mod: modifier.optional(),
  }),
  z.object({
    type: z.literal('wheel'),
    x: koordinat,
    y: koordinat,
    dx: koordinat,
    dy: koordinat,
  }),
  z.object({
    type: z.literal('key'),
    aksi: z.enum(['down', 'up']),
    key: z.string().min(1).max(32),
    code: z.string().max(32),
    mod: modifier.optional(),
  }),
  /** Teks hasil IME/keyboard virtual (Input.insertText). Tidak pernah dicatat. */
  z.object({ type: z.literal('text'), teks: z.string().min(1).max(500) }),
  /** Warga mengambil alih kapan saja; AI berhenti setelah langkah yang sedang berjalan. */
  z.object({ type: z.literal('ambil_alih') }),
  /** Warga mengembalikan kendali ke AI. */
  z.object({ type: z.literal('kembalikan') }),
  /** Nilai placeholder dari vault perangkat, mis. {"{{PEMOHON.HP}}": "..."}; hanya di memori sesi. */
  z.object({
    type: z.literal('vault'),
    isian: z.record(z.string().regex(/^\{\{[A-Z][A-Z0-9_]*(?:\.[A-Z][A-Z0-9_]*)+\}\}$/), z.string().max(500)),
  }),
  /** Berkas untuk `{{FILE:<nama>}}`; base64, maks ~9 MB biner. Hanya di memori sesi. */
  z.object({
    type: z.literal('berkas'),
    nama: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/),
    namaBerkas: z.string().min(1).max(200),
    mime: z.string().min(1).max(100),
    dataBase64: z.string().min(1).max(12_600_000),
  }),
  z.object({ type: z.literal('akhiri') }),
  z.object({ type: z.literal('ping'), t: z.number() }),
]);
export type PendampingClientMessage = z.infer<typeof PendampingClientMessageSchema>;

// --- WebSocket: pendamping -> perangkat warga ---
export const PendampingFrameMetaSchema = z.object({
  /** Ukuran viewport halaman (piksel CSS) yang digambar frame ini. */
  lebar: z.number().positive(),
  tinggi: z.number().positive(),
  skala: z.number().positive(),
  offsetAtas: z.number(),
  scrollX: z.number(),
  scrollY: z.number(),
});
export type PendampingFrameMeta = z.infer<typeof PendampingFrameMetaSchema>;

export const PendampingEventSchema = z.discriminatedUnion('jenis', [
  /** Progres AI tanpa nilai isian. */
  z.object({
    jenis: z.literal('langkah'),
    indeks: z.number().int().nonnegative(),
    total: z.number().int().positive(),
    label: z.string(),
  }),
  /** Giliran warga: login/OTP/CAPTCHA (`login`), pengiriman akhir (`final`), atau diminta warga. */
  z.object({
    jenis: z.literal('giliran_anda'),
    alasan: z.enum(['login', 'final', 'diminta_warga', 'periksa']),
    pesan: z.string(),
    sorot: PendampingSorotSchema.optional(),
  }),
  /** Situs memblokir peramban server (WAF/bot wall): urusan beralih ke mode dipandu. */
  z.object({ jenis: z.literal('dipandu'), pesan: z.string() }),
  /** Permintaan peramban ke host di luar allowlist ditolak (tanpa path/isi). */
  z.object({ jenis: z.literal('diblokir'), host: z.string() }),
  z.object({ jenis: z.literal('selesai'), hasil: PendampingHasilSchema, pesan: z.string() }),
]);
export type PendampingEvent = z.infer<typeof PendampingEventSchema>;

export const PendampingServerMessageSchema = z.discriminatedUnion('type', [
  /** Frame JPEG base64 dari CDP screencast. Tidak pernah direkam atau dicatat. */
  z.object({
    type: z.literal('frame'),
    seq: z.number().int().nonnegative(),
    data: z.string().min(1),
    meta: PendampingFrameMetaSchema,
  }),
  z.object({
    type: z.literal('mode'),
    mode: PendampingModeSchema,
    pesan: z.string().optional(),
  }),
  z.object({ type: z.literal('event'), event: PendampingEventSchema }),
  z.object({ type: z.literal('status'), sesi: SesiPendampingSchema }),
  /** Placeholder vault dan nama berkas yang harus dikirim perangkat sebelum AI mulai. */
  z.object({
    type: z.literal('butuh_data'),
    placeholder: z.array(z.string()),
    berkas: z.array(z.string()),
  }),
  z.object({ type: z.literal('galat'), kode: PendampingKodeGalatSchema, pesanWarga: z.string() }),
  z.object({ type: z.literal('pong'), t: z.number() }),
]);
export type PendampingServerMessage = z.infer<typeof PendampingServerMessageSchema>;

/** Kode tutup WebSocket aplikasi (4000-4999). */
export const PENDAMPING_WS_CLOSE = {
  /** Sesi berakhir normal (selesai/dibatalkan/kedaluwarsa): jangan sambung ulang. */
  SELESAI: 4000,
  /** Tiket/Origin tidak sah: jangan sambung ulang dengan tiket yang sama. */
  TIDAK_SAH: 4401,
  /** Sesi tidak ada. */
  TIDAK_ADA: 4404,
  /** Digantikan koneksi lain dari warga yang sama. */
  DIGANTIKAN: 4409,
} as const;
