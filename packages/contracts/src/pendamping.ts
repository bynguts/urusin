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
  /**
   * (aditif) Sesi demo "lihat saja" di situs resmi asli: AI hanya membuka dan menavigasi, tidak mengisi kolom
   * apa pun dan tidak menekan Lanjut/Kirim (data demo adalah data contoh).
   */
  lihatSaja: z.boolean().optional(),
  /**
   * (aditif) Sesi simulasi pengisian (akun demo) di replika uji: alur formulir contoh deterministik, bukan
   * Navigator generik. Tanpa dinding login replika; tidak ada yang terkirim ke pemerintah.
   */
  simulasi: z.boolean().optional(),
});
export type SesiPendamping = z.infer<typeof SesiPendampingSchema>;

// --- POST /api/urusan/[id]/pendamping (warga, lewat web app) ---
export const MulaiPendampingRequestSchema = z.object({
  /** `executionId` dari event `execution_request` yang sudah disetujui warga. */
  executionId: z.string().min(1).max(100),
  viewport: PendampingViewportSchema.optional(),
  /**
   * (aditif) Akun demo saja: buka SIMULASI di replika uji dengan data contoh (Mode Uji), bukan situs resmi asli.
   * Diabaikan untuk akun warga biasa (selalu situs resmi asli).
   */
  simulasi: z.boolean().optional(),
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
  /**
   * (aditif) Demo di situs resmi asli: worker menolak setiap isi/pilih/centang/unggah, klik selain navigasi/
   * ui_lokal (dan tautan pembuka GET), serta jalur Izinkan isi; adapter bawaan tidak dijalankan sama sekali.
   */
  lihatSaja: z.boolean().optional(),
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
/**
 * Mode "lihat saja" (sesi demo di situs resmi asli): hanya navigasi murni. `lanjut` (bisa menyimpan draf) dan
 * semua kelas lain ditolak; tautan pembuka (`tautanPembuka`, navigasi GET ke href) tetap boleh.
 */
export const KELAS_BOLEH_KLIK_LIHAT_SAJA: readonly KelasKendali[] = ['navigasi', 'ui_lokal'];

/** Pesan templat saat AI berhenti di sesi demo "lihat saja" (halaman masuk / formulir / langkah menyimpan). */
export const PESAN_LIHAT_SAJA =
  'Ini situs resmi asli. Di mode demo, Urusin tidak mengetik data contoh ke sistem pemerintah, jadi AI ' +
  'berhenti di sini tanpa mengisi apa pun. Dengan akun sendiri (Daftar atau Masuk dengan Google), AI mengisi ' +
  'kolom dari Data Diri Anda setelah Anda menekan Izinkan isi, dan tombol Kirim selalu Anda yang menekan. ' +
  'Anda tetap boleh mencoba situsnya sendiri dari layar ini.';

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

/**
 * Isyarat jenis data kolom dari atribut halaman yang terstruktur (bukan teks bebas): `autocomplete`, `type`, lalu
 * token `name`/`id`. Hanya enum, jadi tidak membawa teks situs ke model. Dipakai validator untuk menilai kecocokan
 * kolom dengan data (mis. kolom `type=tel` berlabel "Kontak" lazim untuk Nomor HP). Tidak pernah untuk NIK/KK.
 */
export const IsyaratKolomSchema = z.enum(['tel', 'email', 'tanggal_lahir', 'nama', 'alamat', 'kode_pos']);
export type IsyaratKolom = z.infer<typeof IsyaratKolomSchema>;

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
  /** (aditif) Hanya kolom isian: jenis data menurut atribut terstruktur halaman (lihat IsyaratKolomSchema). */
  isyarat: IsyaratKolomSchema.optional(),
  /**
   * Tautan GET berkelas `kirim` HANYA karena namanya (mis. "Ajukan Permohonan"): jalur, id/kelas, dan ikon
   * bersih. Kemungkinan pembuka formulir, tetapi tetap TIDAK boleh diklik AI: serahkan ke warga untuk diketuk
   * sendiri, lalu AI melanjutkan.
   */
  tautanPembuka: z.literal(true).optional(),
  /** Formulir pemilik elemen (`f0`..`f99`). */
  form: z
    .string()
    .regex(/^f\d{1,2}$/)
    .optional(),
  /** Pesan galat validasi situs di dekat kolom (sudah diredaksi). */
  galat: z.string().max(120).optional(),
});
export type ElemenAmatan = z.infer<typeof ElemenAmatanSchema>;

/** Kosakata nama kendali akun warga: SELURUH kata nama harus dari sini (label halaman tidak tepercaya). */
const KATA_AKUN: ReadonlySet<string> = new Set(
  (
    'masuk login log in sign signin daftar pendaftaran register registrasi signup up buat akun account baru ' +
    'sekarang disini di sini ke sudah belum punya anda saya my warga pengguna user member here now create ' +
    'gratis new free atau or dan and sso'
  ).split(' '),
);
const RE_KATA_MASUK = /(^| )(masuk|login|signin|log in|sign in|sso)( |$)/;
const RE_KATA_DAFTAR =
  /(^| )(daftar|pendaftaran|register|registrasi|signup|sign up|buat akun|create account)( |$)/;
const RE_KATA_KELUAR = /(^| )(keluar|logout|log out|signout|sign out|logoff)( |$)/;
/** Kata tambahan kendali keluar ("Keluar Aplikasi", "Log Out"); layanan "Perpindahan Keluar" bukan kendali akun. */
const KATA_KELUAR: ReadonlySet<string> = new Set(
  'keluar logout out signout logoff off aplikasi dari'.split(' '),
);

/** Nama kendali dinormalkan untuk pencocokan kata: huruf kecil, tanpa diakritik/tanda baca. */
function kataNama(nama: string): string {
  return nama
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Kendali akun warga yang terlihat di satu pengamatan (beranda/menu portal): tombol/tautan yang namanya HANYA
 * berisi kata akun (maks. 6 kata), mis. "Masuk", "Sudah punya akun? Masuk", "LOGIN", "Daftar Akun Gratis",
 * "Belum punya akun? Daftar". `masuk` didahulukan atas "Login / Register" (nama gabungan = masuk).
 * `keluar` = ada kendali keluar/logout (warga sudah masuk), juga hanya dari kata akun/keluar (QA prod gel6
 * Semarang: tautan layanan "Perpindahan Keluar" bukan tanda sesi). Kendali tersembunyi/tantangan tidak dihitung.
 */
export function kendaliAkun(elemen: readonly ElemenAmatan[]): {
  masuk?: ElemenAmatan;
  daftar?: ElemenAmatan;
  keluar: boolean;
} {
  let masuk: ElemenAmatan | undefined;
  let daftar: ElemenAmatan | undefined;
  let keluar = false;
  for (const e of elemen) {
    if (e.peran !== 'tombol' && e.peran !== 'tautan') continue;
    const k = kataNama(e.nama);
    const kata = k.split(' ');
    if (
      RE_KATA_KELUAR.test(k) &&
      kata.length <= 4 &&
      kata.every((w) => KATA_AKUN.has(w) || KATA_KELUAR.has(w))
    )
      keluar = true;
    if (e.kelas === 'tantangan' || e.kelas === 'tidak_pasti' || !k) continue;
    if (kata.length > 6 || !kata.every((w) => KATA_AKUN.has(w))) continue;
    if (RE_KATA_MASUK.test(k)) masuk ??= e;
    else if (RE_KATA_DAFTAR.test(k)) daftar ??= e;
  }
  return { ...(masuk ? { masuk } : {}), ...(daftar ? { daftar } : {}), keluar };
}

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

/**
 * `ketuk_tautan` (aditif): warga mengetuk sendiri tautan pembuka (`ElemenAmatan.tautanPembuka`) yang disorot,
 * lalu AI melanjutkan. Bukan serah final.
 * `berhenti` (aditif): serah akhir; Navigator berhenti dan warga melanjutkan sendiri (tanpa janji coba lagi).
 * `kembalikan` sesudahnya tetap `takeover`.
 */
export const AlasanSerahkanSchema = z.enum([
  'masuk_akun',
  'otp',
  'captcha',
  'isi_sendiri',
  'final',
  'tidak_yakin',
  'ketuk_tautan',
  'berhenti',
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
export const AmatiSesiInternalSchema = PemilikSesiInternalSchema.extend({
  /**
   * Pantau baca-saja (mis. menunggu `sinyal.sukses` saat warga memegang kendali): jejak `amati` tidak dicatat dan
   * peta ref worker tidak diganti (ref dari pengamatan pantau = REF_BASI bila dipakai aksi).
   */
  pantau: z.boolean().optional(),
  /** (Aditif) Bila ada: harus eksekusi yang sedang dipegang sesi (selain itu 409), seperti `selesai`. */
  executionId: z.string().min(1).optional(),
});
export type AmatiSesiInternal = z.infer<typeof AmatiSesiInternalSchema>;
export const AmatiSesiResponseSchema = z.object({
  /** Pemegang kendali saat ini: `takeover` = warga, Navigator menunggu lewat `/internal/sesi/tunggu`. */
  mode: PendampingModeSchema,
  pengamatan: PengamatanSchema,
  /** Eksekusi yang sedang dipegang sesi (loop lama berhenti bila berbeda). */
  executionId: z.string().min(1).optional(),
});
export type AmatiSesiResponse = z.infer<typeof AmatiSesiResponseSchema>;

// --- POST /internal/sesi/aksi (web -> worker): aksi rencana yang sudah divalidasi web ---
export const AksiSesiInternalSchema = PemilikSesiInternalSchema.extend({
  rencanaHash: RencanaHashSchema,
  aksi: z.array(AksiSchema).min(1).max(25),
  /** `seq` pengamatan yang menjadi dasar rencana (ref dari pengamatan lain ditolak). */
  seq: z.number().int().nonnegative().optional(),
  /**
   * Baris lembar "Izinkan AI mengisi?" dari validator web (termasuk `tidakLazim`). Setiap `placeholder` wajib
   * muncul di aksi isi/pilih rencana ini (kolom asing = 422). Tidak ada = worker menurunkan baris sendiri dari
   * label pengamatan.
   */
  kolom: z.array(KolomButuhSchema).max(150).optional(),
  /** (Aditif) Bila ada: harus eksekusi yang sedang dipegang sesi (selain itu 409); loop lama tidak beraksi. */
  executionId: z.string().min(1).optional(),
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

// --- POST /internal/sesi/selesai (web -> worker): Navigator melihat halaman sukses ---
/**
 * Navigator melihat `sinyal.sukses` (biasanya sesudah warga sendiri menekan Kirim, juga saat warga memegang
 * kendali). Worker memeriksa ulang halaman SAAT INI (harus sukses; bila tidak = 409), mencatat bukti ke jejak
 * audit, lalu sesi menjadi `siaga` dengan hasil `berhasil`. `bukti.nomor` hanya disimpan bila tertulis di
 * halaman itu. Idempoten saat sesi sudah siaga.
 */
export const SelesaiSesiInternalSchema = PemilikSesiInternalSchema.extend({
  /** Bila ada: harus eksekusi yang sedang dipegang sesi (selain itu 409). */
  executionId: z.string().min(1).optional(),
  bukti: PendampingBuktiSchema.optional(),
});
export type SelesaiSesiInternal = z.infer<typeof SelesaiSesiInternalSchema>;
export const SelesaiSesiResponseSchema = SesiPendampingSchema;
export type SelesaiSesiResponse = z.infer<typeof SelesaiSesiResponseSchema>;

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
  /**
   * Navigator generik: rencana yang disetujui warga (dari `butuh.rencanaHash`). Worker menolak isi untuk
   * rencana lain; pasangan (sidik ref, placeholder) yang disetujui terikat ke hash ini.
   */
  rencanaHash: RencanaHashSchema.optional(),
  /**
   * Navigator generik: berkas yang disetujui warga di putaran INI (bukan seluruh berkas sesi). Tidak ada = berkas
   * yang dikirim lewat `/internal/sesi/berkas` sejak lembar ini dibuka.
   */
  berkas: z.array(NamaBerkasAdapterSchema).max(20).optional(),
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
  /**
   * (aditif) Giliran `ketuk_tautan`: warga menekan tombol Urusin "Buka …" alih-alih mengetuk elemen halaman.
   * `ref` harus tautan pembuka yang sedang disorot; worker membuka href-nya (GET, host wilayah), bukan klik.
   */
  z.object({ type: z.literal('buka_tautan'), ref: RefSchema }),
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
    /**
     * (aditif) Navigator generik: fase AI yang jujur (`membuka` situs/halaman, `membaca` halaman, `mengisi`
     * formulir). `indeks`/`total` tidak bermakna (selalu 0/1); layar tidak menampilkan penghitung bila ada.
     */
    fase: z.enum(['membuka', 'membaca', 'mengisi']).optional(),
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
     * `ketuk_tautan` (aditif): warga mengetuk tautan pembuka yang disorot (navigasi GET), lalu Lanjutkan.
     * `berhenti` (aditif): Navigator berhenti; warga melanjutkan sendiri (tanpa tombol coba lagi).
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
      'ketuk_tautan',
      'berhenti',
    ]),
    pesan: z.string(),
    sorot: PendampingSorotSchema.optional(),
    /** Hanya `final`: nama tombol kirim yang tersorot, dibaca dari halaman (mis. "Selesai"). */
    tombol: z.string().min(1).max(40).optional(),
    /**
     * (aditif) Nama kendali situs yang menjadi sasaran giliran ini (mis. "Masuk", "Tutup"), dibaca dari halaman dan
     * dibersihkan worker (teks tak tepercaya: tampil sebagai teks biasa). Untuk instruksi ringkas "Giliran Anda".
     */
    kendali: z.string().min(1).max(40).optional(),
    /** Hanya `berkas_kurang`: nama berkas adapter dan origin situs tujuan (untuk persetujuan ulang). */
    berkas: z
      .object({ nama: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/), origin: z.url().max(2048) })
      .optional(),
    /**
     * (aditif) Hanya `ketuk_tautan`: tautan pembuka yang disorot. `nama` teks situs (tak tepercaya, tampil
     * sebagai teks biasa); `ref` dikirim kembali lewat `buka_tautan`.
     */
    tautan: z
      .object({
        ref: RefSchema,
        nama: z.string().max(80),
        host: z.string().min(1).max(253),
        jalur: z.string().max(200),
      })
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
