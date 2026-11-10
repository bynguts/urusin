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

/**
 * Siklus hidup sesi. Status akhir: selesai, gagal, dipandu, kedaluwarsa, dibatalkan.
 * `siaga`: satu langkah (execution) selesai, peramban tetap hidup untuk langkah berikutnya di urusan yang
 * sama (warga cukup login sekali) sampai TTL/idle atau diakhiri; tidak ada yang disimpan setelah ditutup.
 */
export const PendampingStatusSchema = z.enum([
  'antre',
  'memulai',
  'menunggu_data',
  'berjalan',
  'siaga',
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

/**
 * Nilai terstruktur yang dibaca dari halaman konfirmasi lewat selektor yang dideklarasikan adapter (bukan teks
 * halaman bebas): nomor registrasi/permohonan dan status. Dipakai warga untuk melacak sendiri / `cek_status`.
 */
export const PendampingBuktiSchema = z.object({
  nomor: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9][A-Za-z0-9 ./_-]*$/)
    .optional(),
  status: z.string().min(1).max(120).optional(),
});
export type PendampingBukti = z.infer<typeof PendampingBuktiSchema>;

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
  /** Bukti dari halaman konfirmasi untuk `executionId` ini (bila adapter mendeklarasikannya). */
  bukti: PendampingBuktiSchema.optional(),
  /** Origin yang BENAR-BENAR dibuka peramban (Mode Uji: replika fixture, bukan portal resmi). */
  situs: z.url().max(2048).optional(),
  /** true bila `situs` adalah replika uji (fixture), bukan situs pemerintah asli. */
  replika: z.boolean().optional(),
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

// --- API internal web -> layanan pendamping (HMAC atas header termasuk x-urusin-isi-sha256; rahasia bersama) ---
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
  /**
   * Mode Uji (juri/tamu): origin resmi WAJIB dipetakan ke replika fixture (PENDAMPING_ORIGIN_OVERRIDES); tanpa
   * pemetaan sesi ditolak. false di produksi = portal resmi asli, override tidak pernah dipakai.
   */
  modeUji: z.boolean().optional(),
});
export type MulaiSesiInternal = z.infer<typeof MulaiSesiInternalSchema>;

export const PemilikSesiInternalSchema = z.object({
  urusanId: z.string().min(1),
  sidHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type PemilikSesiInternal = z.infer<typeof PemilikSesiInternalSchema>;

/** Kunci placeholder vault adapter, mis. `{{PEMOHON.NIK}}`. */
export const PlaceholderVaultSchema = z.string().regex(/^\{\{[A-Z][A-Z0-9_]*(?:\.[A-Z][A-Z0-9_]*)+\}\}$/);
/** Nama berkas adapter untuk `{{FILE:<nama>}}`, mis. `KTP`. */
export const NamaBerkasAdapterSchema = z
  .string()
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/);

// --- Navigator generik (ADR 0030): pengamatan halaman, rencana per halaman, aksi terbatas ---
/**
 * Rujukan elemen dari pengamatan terakhir (`e1`..`e9999`). Peta ref -> {jalur, sidik} hanya ada di memori
 * worker dan tidak pernah ditulis ke DOM; sidik berubah saat aksi = `REF_BASI`.
 */
export const RefSchema = z.string().regex(/^e\d{1,4}$/);
export type Ref = z.infer<typeof RefSchema>;

/**
 * Kelas kendali deterministik dari klasifikator di halaman (executor/klasifikasi.ts). AI hanya boleh mengeklik
 * `navigasi`, `ui_lokal`, atau `lanjut`; selebihnya dikerjakan warga (default tolak).
 */
export const KelasKendaliSchema = z.enum([
  'navigasi',
  'ui_lokal',
  'lanjut',
  'kirim',
  'masuk',
  'tantangan',
  'tidak_pasti',
]);
export type KelasKendali = z.infer<typeof KelasKendaliSchema>;
/** Kelas yang boleh diklik AI. Selain ini klik ditolak di validator web DAN diulang di halaman saat klik. */
export const KELAS_BOLEH_KLIK_AI: readonly KelasKendali[] = ['navigasi', 'ui_lokal', 'lanjut'];

export const PeranElemenSchema = z.enum([
  'teks',
  'angka',
  'tanggal',
  'pilihan',
  'centang',
  'radio',
  'berkas',
  'tombol',
  'tautan',
  'tab',
  'area',
]);
export type PeranElemen = z.infer<typeof PeranElemenSchema>;

/** Kolom yang tidak pernah diisi AI: sandi, OTP, CAPTCHA, dan pernyataan (warga sendiri). */
export const TerlarangSchema = z.enum(['sandi', 'otp', 'captcha', 'pernyataan']);
export type Terlarang = z.infer<typeof TerlarangSchema>;

/** Keadaan isian kolom: tidak pernah nilai mentah, hanya keadaan atau placeholder vault yang diisi worker. */
export const IsianElemenSchema = z.union([
  z.enum(['kosong', 'terisi_situs', 'terisi_warga']),
  PlaceholderVaultSchema,
]);

export const ElemenAmatanSchema = z.object({
  ref: RefSchema,
  peran: PeranElemenSchema,
  /** Label dari halaman: TIDAK TEPERCAYA (bisa berisi instruksi sisipan). */
  nama: z.string().max(120),
  petunjuk: z.string().max(120).optional(),
  wajib: z.boolean().optional(),
  isian: IsianElemenSchema.optional(),
  opsi: z.array(z.string().max(80)).max(40).optional(),
  /** Hanya tombol/tautan: kelas dari klasifikator deterministik. */
  kelas: KelasKendaliSchema.optional(),
  terlarang: TerlarangSchema.optional(),
  /** Formulir pemilik elemen (`f0`..`f99`). */
  form: z
    .string()
    .regex(/^f\d{1,2}$/)
    .optional(),
  /** Pesan galat validasi situs di dekat kolom (sudah diredaksi). */
  galat: z.string().max(120).optional(),
});
export type ElemenAmatan = z.infer<typeof ElemenAmatanSchema>;

export const SinyalHalamanSchema = z.object({
  login: z.boolean(),
  otp: z.boolean(),
  captcha: z.boolean(),
  tantangan: z.boolean(),
  /** Halaman tinjauan/pernyataan: kunci halaman akhir, AI tidak boleh mengeklik apa pun. */
  halamanAkhir: z.boolean(),
  sukses: z.boolean(),
  galatForm: z.boolean(),
});
export type SinyalHalaman = z.infer<typeof SinyalHalamanSchema>;

/** Pengamatan satu halaman yang sudah diredaksi worker; satu-satunya yang dilihat model tentang halaman. */
export const PengamatanSchema = z.object({
  v: z.literal(1),
  seq: z.number().int().nonnegative(),
  host: z
    .string()
    .min(1)
    .max(253)
    .regex(/^[a-z0-9.-]+(?::\d{1,5})?$/),
  /** Path tanpa query string dan fragmen. */
  jalur: z
    .string()
    .max(200)
    .regex(/^\/[^?#]*$/),
  judul: z.string().max(120),
  sinyal: SinyalHalamanSchema,
  elemen: z.array(ElemenAmatanSchema).max(150),
  /** Judul bagian/peringatan, sudah diredaksi di worker (nilai vault diganti token). */
  teks: z.string().max(2500),
  /** Hash struktural halaman untuk deteksi putaran. */
  sidik: z.string().min(1).max(128),
});
export type Pengamatan = z.infer<typeof PengamatanSchema>;

export const AlasanSerahkanSchema = z.enum([
  'masuk_akun',
  'otp',
  'captcha',
  'isi_sendiri',
  'final',
  'tidak_yakin',
]);
export const SebabTidakBisaSchema = z.enum([
  'layanan_tidak_ada',
  'hanya_aplikasi',
  'hanya_whatsapp',
  'situs_rusak',
  'butuh_kamera',
  'lainnya',
]);

/**
 * Ruang aksi model: hanya ref, placeholder vault, indeks opsi teramati, atau boolean. Tidak ada URL, teks bebas,
 * tombol keyboard (Enter), atau JS. Tidak ada aksi "kirim": pengiriman akhir selalu warga.
 */
export const AksiSchema = z.discriminatedUnion('jenis', [
  z.object({ jenis: z.literal('isi'), ref: RefSchema, nilai: PlaceholderVaultSchema }),
  z.object({
    jenis: z.literal('pilih'),
    ref: RefSchema,
    nilai: z.union([PlaceholderVaultSchema, z.object({ opsi: z.number().int().min(0).max(39) })]),
  }),
  z.object({ jenis: z.literal('centang'), ref: RefSchema, nilai: z.boolean() }),
  z.object({ jenis: z.literal('unggah'), ref: RefSchema, berkas: NamaBerkasAdapterSchema }),
  z.object({ jenis: z.literal('klik'), ref: RefSchema }),
  z.object({ jenis: z.literal('serahkan'), alasan: AlasanSerahkanSchema, ref: RefSchema.optional() }),
  z.object({ jenis: z.literal('tidak_bisa'), sebab: SebabTidakBisaSchema }),
]);
export type Aksi = z.infer<typeof AksiSchema>;
export type JenisAksi = Aksi['jenis'];
export const JenisAksiSchema = z.enum([
  'isi',
  'pilih',
  'centang',
  'unggah',
  'klik',
  'serahkan',
  'tidak_bisa',
]);
/** Aksi terminal: paling banyak satu per rencana dan harus yang terakhir. */
export const AKSI_TERMINAL: readonly JenisAksi[] = ['serahkan', 'tidak_bisa'];

/** Satu rencana per halaman. Paling banyak satu aksi terminal, dan harus di posisi terakhir. */
export const RencanaHalamanSchema = z
  .object({ aksi: z.array(AksiSchema).min(1).max(25) })
  .superRefine((r, ctx) => {
    r.aksi.forEach((a, i) => {
      if (AKSI_TERMINAL.includes(a.jenis) && i !== r.aksi.length - 1)
        ctx.addIssue({
          code: 'custom',
          path: ['aksi', i],
          message: 'aksi terminal (serahkan/tidak_bisa) harus satu-satunya dan terakhir',
        });
    });
  });
export type RencanaHalaman = z.infer<typeof RencanaHalamanSchema>;

/** sha256 hex atas rencana kanonik; persetujuan warga dan aksi worker terikat ke hash ini. */
export const RencanaHashSchema = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * Satu baris lembar "Izinkan AI mengisi?": kolom portal yang akan diisi dari placeholder vault.
 * `labelPortal` adalah label halaman (tidak tepercaya, ditampilkan sebagai teks biasa). `tidakLazim` = nilai
 * sensitif (mis. NIK) ke kolom yang tidak tampak seperti kolom itu; ditandai agar warga memeriksa.
 */
export const KolomButuhSchema = z.object({
  placeholder: PlaceholderVaultSchema,
  labelPortal: z.string().max(120),
  tidakLazim: z.boolean().optional(),
});
export type KolomButuh = z.infer<typeof KolomButuhSchema>;

/** Hasil satu aksi di worker. `REF_BASI`: sidik elemen berubah; Navigator mengikat ulang tanpa LLM. */
export const KodeHasilAksiSchema = z.enum([
  'ok',
  'REF_BASI',
  'REF_TIDAK_ADA',
  'KELAS_DITOLAK',
  'TERLARANG',
  'BELUM_DISETUJUI',
  'GERBANG_MEMBLOKIR',
  'HALAMAN_AKHIR',
  'DILEWATI',
  'GALAT',
]);
export type KodeHasilAksi = z.infer<typeof KodeHasilAksiSchema>;

export const HasilAksiSchema = z.object({
  indeks: z.number().int().min(0).max(24),
  kode: KodeHasilAksiSchema,
  /** Kelas klik saat itu (dihitung ulang di halaman), bila aksinya klik. */
  kelas: KelasKendaliSchema.optional(),
});
export type HasilAksi = z.infer<typeof HasilAksiSchema>;

// --- POST /internal/sesi/amati (web -> worker): pengamatan halaman saat ini ---
export const AmatiSesiInternalSchema = PemilikSesiInternalSchema;
export type AmatiSesiInternal = z.infer<typeof AmatiSesiInternalSchema>;
export const AmatiSesiResponseSchema = z.object({
  /** Pemegang kendali saat ini: `takeover` = warga, Navigator menunggu lewat `/internal/sesi/tunggu`. */
  mode: PendampingModeSchema,
  pengamatan: PengamatanSchema,
});
export type AmatiSesiResponse = z.infer<typeof AmatiSesiResponseSchema>;

// --- POST /internal/sesi/aksi (web -> worker): aksi rencana yang sudah divalidasi web ---
export const AksiSesiInternalSchema = PemilikSesiInternalSchema.extend({
  rencanaHash: RencanaHashSchema,
  aksi: z.array(AksiSchema).min(1).max(25),
  /** `seq` pengamatan yang menjadi dasar rencana (ref dari pengamatan lain ditolak). */
  seq: z.number().int().nonnegative().optional(),
});
export type AksiSesiInternal = z.infer<typeof AksiSesiInternalSchema>;
export const AksiSesiResponseSchema = z.object({
  mode: PendampingModeSchema,
  /** Satu entri per aksi yang dicoba; worker berhenti pada aksi pertama yang bukan `ok`. */
  hasil: z.array(HasilAksiSchema).max(25),
});
export type AksiSesiResponse = z.infer<typeof AksiSesiResponseSchema>;

// --- POST /internal/sesi/tunggu (web -> worker): long-poll selama warga memegang kendali ---
export const TUNGGU_MAKS_MS = 25_000;
export const TungguSesiInternalSchema = PemilikSesiInternalSchema.extend({
  maksMs: z.number().int().min(0).max(TUNGGU_MAKS_MS),
});
export type TungguSesiInternal = z.infer<typeof TungguSesiInternalSchema>;
export const TungguSesiResponseSchema = z.object({
  mode: PendampingModeSchema,
  status: PendampingStatusSchema,
  /** true bila kembali karena `maksMs` habis tanpa perubahan kendali. */
  habisWaktu: z.boolean(),
});
export type TungguSesiResponse = z.infer<typeof TungguSesiResponseSchema>;

// --- POST /internal/sesi/butuh: data yang masih dibutuhkan sesi sebelum AI mulai (A-M1, jalur isi server) ---
export const ButuhSesiInternalSchema = z.object({
  placeholder: z.array(PlaceholderVaultSchema),
  berkas: z.array(NamaBerkasAdapterSchema),
  /** Origin yang benar-benar dibuka peramban sesi (tujuan nilai; fixture saat dipetakan di dev/uji). */
  origin: z.url(),
  /** Navigator generik: baris lembar persetujuan per kolom halaman ini, terikat ke `rencanaHash`. */
  kolom: z.array(KolomButuhSchema).max(150).optional(),
  rencanaHash: RencanaHashSchema.optional(),
});
export type ButuhSesiInternal = z.infer<typeof ButuhSesiInternalSchema>;

/**
 * POST /internal/sesi/isi: nilai Data Diri yang sudah diselesaikan server (resolver vault, token persetujuan
 * sekali pakai) untuk placeholder sesi. Hanya lewat kanal internal; peramban warga tidak pernah mengirimnya.
 */
export const IsiSesiInternalSchema = PemilikSesiInternalSchema.extend({
  isian: z.record(PlaceholderVaultSchema, z.string().max(500)),
});
export type IsiSesiInternal = z.infer<typeof IsiSesiInternalSchema>;

/** POST /internal/sesi/berkas: satu berkas dari Dokumen akun (server) untuk `{{FILE:<nama>}}`. */
export const BerkasSesiInternalSchema = PemilikSesiInternalSchema.extend({
  nama: NamaBerkasAdapterSchema,
  namaBerkas: z.string().min(1).max(200),
  mime: z.string().min(1).max(100),
  dataBase64: z.string().min(1).max(12_600_000),
});
export type BerkasSesiInternal = z.infer<typeof BerkasSesiInternalSchema>;

// --- WebSocket: perangkat warga -> pendamping ---
const koordinat = z.number().min(-10_000).max(10_000);
/** Bitmask modifier CDP: Alt=1, Ctrl=2, Meta=4, Shift=8. */
const modifier = z.number().int().min(0).max(15);

/** Batas satu pesan WebSocket perangkat -> pendamping (berlaku juga sebelum `halo`). */
export const PENDAMPING_WS_MAX_PAYLOAD = 64 * 1024;

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
  /*
   * Tidak ada pesan nilai vault atau berkas dari perangkat (A-M1): nilai Data Diri dan Dokumen hanya masuk
   * lewat kanal internal web -> worker (`/internal/sesi/isi`, `/internal/sesi/berkas`) setelah "Izinkan isi".
   */
  z.object({ type: z.literal('akhiri') }),
  z.object({ type: z.literal('ping'), t: z.number() }),
  /** Frame `seq` sudah digambar: pendamping mengirim paling banyak 2 frame yang belum di-ack. */
  z.object({ type: z.literal('ack'), seq: z.number().int().nonnegative() }),
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
    /**
     * `masuk_akun`: halaman keluar/login terdeteksi probe adapter; `verifikasi_situs`: halaman tantangan situs
     * (mis. Cloudflare) yang hanya boleh diselesaikan warga sendiri. `login` dipertahankan untuk gerbang lama.
     * `isi_sendiri`: nilai kolom yang disorot tidak ada di daftar write (mis. nomor kitir, NIB); warga
     * mengetiknya di situs lalu menekan Lanjutkan (`kembalikan`). Nilainya tidak dicatat dan tidak ke AI.
     * `berkas_kurang`: Dokumen untuk langkah unggah belum ada di akun (`berkas`); warga menambahkannya di
     * /dokumen, lalu Lanjutkan = "Izinkan isi" baru untuk berkas itu saja, dan langkah unggah diulang.
     */
    alasan: z.enum([
      'login',
      'final',
      'diminta_warga',
      'periksa',
      'masuk_akun',
      'verifikasi_situs',
      'isi_sendiri',
      'berkas_kurang',
    ]),
    pesan: z.string(),
    sorot: PendampingSorotSchema.optional(),
    /** Hanya `berkas_kurang`: nama berkas adapter dan origin situs tujuan (untuk persetujuan ulang). */
    berkas: z
      .object({ nama: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/), origin: z.url().max(2048) })
      .optional(),
  }),
  /** Situs memblokir peramban server (WAF/bot wall): urusan beralih ke mode dipandu. */
  z.object({ jenis: z.literal('dipandu'), pesan: z.string() }),
  /** Permintaan peramban ke host di luar allowlist ditolak (tanpa path/isi). */
  z.object({ jenis: z.literal('diblokir'), host: z.string() }),
  z.object({
    jenis: z.literal('selesai'),
    hasil: PendampingHasilSchema,
    pesan: z.string(),
    /** Kode galat langkah otomatis (mis. DOMAIN_NOT_ALLOWED) dan galat jaringan navigasi, bila gagal. */
    kode: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{1,63}$/)
      .optional(),
    net: z
      .string()
      .regex(/^net::ERR_[A-Z0-9_]{1,64}$/)
      .optional(),
    bukti: PendampingBuktiSchema.optional(),
  }),
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
  /**
   * Data yang masih dibutuhkan sebelum AI mulai (tanpa nilai) + `origin` situs yang akan diisi. Perangkat
   * menampilkan lembar "Izinkan isi" lalu mengirim daftar write + origin ini ke web (bukan ke pendamping).
   */
  z.object({
    type: z.literal('butuh_data'),
    placeholder: z.array(z.string()),
    berkas: z.array(z.string()),
    origin: z.url(),
    /** Navigator generik: baris (placeholder, label portal) yang disetujui satu per satu oleh warga. */
    kolom: z.array(KolomButuhSchema).max(150).optional(),
    /** Navigator generik: persetujuan dikirim ke web bersama hash rencana halaman ini. */
    rencanaHash: RencanaHashSchema.optional(),
  }),
  z.object({ type: z.literal('galat'), kode: PendampingKodeGalatSchema, pesanWarga: z.string() }),
  z.object({ type: z.literal('pong'), t: z.number() }),
  /**
   * Jenis elemen yang sedang fokus di peramban pendamping (tanpa nilai): klien menyesuaikan input tersembunyi
   * (type=password untuk sandi, autocomplete=one-time-code untuk OTP) agar keyboard ponsel tidak menyimpan.
   */
  z.object({ type: z.literal('fokus'), jenis: z.enum(['tidak_ada', 'teks', 'sandi', 'otp', 'angka']) }),
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

/**
 * Frame layar biner (WebSocket binary): [u8 versi=1][u32 seq BE][u16 panjang meta BE][meta JSON UTF-8][JPEG].
 * Menggantikan `{type:'frame', data: base64}` (tetap valid untuk kompatibilitas) agar hemat ~33% dan tanpa
 * dekode base64 di ponsel. Isi frame tidak pernah direkam atau dicatat.
 */
export const PENDAMPING_FRAME_VERSI = 1;

export function encodePendampingFrame(seq: number, meta: PendampingFrameMeta, jpeg: Uint8Array): Uint8Array {
  const m = new TextEncoder().encode(JSON.stringify(meta));
  const out = new Uint8Array(7 + m.length + jpeg.length);
  const v = new DataView(out.buffer);
  v.setUint8(0, PENDAMPING_FRAME_VERSI);
  v.setUint32(1, seq >>> 0);
  v.setUint16(5, m.length);
  out.set(m, 7);
  out.set(jpeg, 7 + m.length);
  return out;
}

export type PendampingFrameBiner = { seq: number; meta: PendampingFrameMeta; jpeg: Uint8Array };

/** null bila bukan frame versi yang dikenal atau meta tidak valid. */
export function decodePendampingFrame(buf: ArrayBuffer | Uint8Array): PendampingFrameBiner | null {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes.length < 8) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint8(0) !== PENDAMPING_FRAME_VERSI) return null;
  const len = v.getUint16(5);
  if (7 + len >= bytes.length) return null;
  let meta: unknown;
  try {
    meta = JSON.parse(new TextDecoder().decode(bytes.subarray(7, 7 + len)));
  } catch {
    return null;
  }
  const parsed = PendampingFrameMetaSchema.safeParse(meta);
  if (!parsed.success) return null;
  return { seq: v.getUint32(1), meta: parsed.data, jpeg: bytes.subarray(7 + len) };
}
