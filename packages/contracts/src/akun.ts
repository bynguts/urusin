import { z } from 'zod';
import { IsoWaktuSchema, KodeKabKotaSchema } from './common.js';

/**
 * Kontrak akun warga (ADR 0028): daftar/masuk email + sandi, Google, sesi, Data Diri dan dokumen
 * terenkripsi per akun. Galat memakai `GalatApiSchema` (`{kode, pesanWarga}`) dengan kode dari
 * `KodeGalatAkunSchema`; respons 429 juga membawa header `Retry-After`. Lihat docs/ui/auth.md.
 */

export const EmailAkunSchema = z.string().trim().min(3).max(254);
/** Batas skema saja; kebijakan (≥ 8 karakter, bukan sandi umum) diperiksa server dan dilaporkan lewat kode galat. */
export const SandiSchema = z.string().min(1).max(1024);
/** Token dari tautan email (base64url 43 karakter). */
export const TokenEmailSchema = z.string().min(1).max(200);
/** Tujuan setelah masuk: path relatif di situs ini; yang lain diabaikan server (anti open redirect). */
export const NextSchema = z.string().max(512);

export const KodeGalatAkunSchema = z.enum([
  'EMAIL_TIDAK_VALID',
  'SANDI_TERLALU_PENDEK',
  'SANDI_TERLALU_PANJANG',
  'SANDI_TERLALU_UMUM',
  'KREDENSIAL_SALAH',
  'EMAIL_BELUM_TERVERIFIKASI',
  'TERKUNCI',
  'RATE_LIMITED',
  'TOKEN_TIDAK_VALID',
  'SANDI_LAMA_SALAH',
  'KONFIRMASI_SALAH',
  'BELUM_MASUK',
  'GOOGLE_TIDAK_AKTIF',
  'GOOGLE_GAGAL',
  'GOOGLE_EMAIL_BELUM_TERVERIFIKASI',
  'BODY_INVALID',
  'NOT_FOUND',
  'DOKUMEN_TERLALU_BESAR',
  'DOKUMEN_JENIS_DITOLAK',
  'DOKUMEN_KUOTA_PENUH',
  'PENYIMPANAN_PENUH',
  'PERLU_MASUK_ULANG',
  'GOOGLE_PERLU_SANDI',
  'GOOGLE_SUDAH_DIPAKAI',
  'TURNSTILE_WAJIB',
  'TURNSTILE_TIDAK_AKTIF',
  'TAMU_PENUH',
  'DEMO_BATAS_IP',
  'DEMO_PENUH',
  'HANYA_AKUN',
  'IZIN_TIDAK_VALID',
  'NILAI_SINTETIS_DITOLAK',
  'CSRF',
]);
export type KodeGalatAkun = z.infer<typeof KodeGalatAkunSchema>;

/** akun = terdaftar; tamu = "Coba tanpa daftar"; demo = salinan "Masuk sebagai juri" (data sintetis). */
export const JenisPenggunaSchema = z.enum(['akun', 'tamu', 'demo']);
export type JenisPengguna = z.infer<typeof JenisPenggunaSchema>;

export const AkunSchema = z.object({
  id: z.string().min(1),
  jenis: JenisPenggunaSchema.exclude(['tamu']),
  /** null untuk salinan demo. */
  email: z.string().nullable(),
  emailTerverifikasi: z.boolean(),
  /** false = akun hanya lewat Google (bisa membuat sandi di Ubah sandi tanpa sandi lama). */
  punyaSandi: z.boolean(),
  terhubungGoogle: z.boolean(),
  /** false → arahkan ke layar Lengkapi profil (nama lengkap belum ada di Data Diri). */
  profilLengkap: z.boolean(),
  /**
   * true = Data Diri + dompet ikut akun di semua perangkat (akun terverifikasi, atau demo). false = email
   * belum dipastikan: vault tetap satu perangkat seperti tamu (tampilkan "Pastikan email untuk sinkron").
   */
  sinkron: z.boolean(),
  dibuatPada: IsoWaktuSchema,
});
export type Akun = z.infer<typeof AkunSchema>;

export const PerangkatSchema = z.object({
  id: z.string(),
  /** Mis. "Chrome di Android"; user-agent mentah tidak disimpan. */
  ringkasan: z.string(),
  dibuatPada: IsoWaktuSchema,
  terakhirAktif: IsoWaktuSchema,
  perangkatIni: z.boolean(),
});
export type Perangkat = z.infer<typeof PerangkatSchema>;

export const MetodeMasukSchema = z.object({
  email: z.literal(true),
  google: z.boolean(),
  /** Tombol "Masuk sebagai juri" tersedia (Turnstile aktif atau mode dev). */
  juri: z.boolean(),
});

/**
 * Status email: `mode` = `resend` (sungguhan) atau `log` (dev/CI); `tertunda` = pengiriman terakhir gagal
 * (kuota habis/DNS belum siap): tampilkan "Email sedang tertunda, coba lagi nanti".
 */
export const StatusEmailSchema = z.object({ mode: z.enum(['resend', 'log']), tertunda: z.boolean() });

// --- GET /api/akun ---
export const SesiAkunResponseSchema = z.discriminatedUnion('masuk', [
  z.object({ masuk: z.literal(false), metode: MetodeMasukSchema, email: StatusEmailSchema }),
  z.object({
    masuk: z.literal(true),
    metode: MetodeMasukSchema,
    email: StatusEmailSchema,
    akun: AkunSchema,
    perangkat: z.array(PerangkatSchema),
  }),
]);
export type SesiAkunResponse = z.infer<typeof SesiAkunResponseSchema>;

/** Respons seragam untuk aksi yang tidak boleh membocorkan apakah email terdaftar. */
export const TerkirimResponseSchema = z.object({
  terkirim: z.literal(true),
  /** true = email gagal/terlambat terkirim (kuota habis, DNS belum siap); pesan jujur "tertunda". */
  tertunda: z.boolean(),
});

// --- POST /api/akun/daftar (202) ---
export const DaftarRequestSchema = z.object({ email: EmailAkunSchema, sandi: SandiSchema });

// --- POST /api/akun/verifikasi ---
/** `sandi` = kata sandi yang dibuat saat mendaftar (anti pra-pembajakan lewat tautan orang lain). */
export const VerifikasiEmailRequestSchema = z.object({ token: TokenEmailSchema, sandi: SandiSchema });
export const VerifikasiEmailResponseSchema = z.object({ terverifikasi: z.literal(true) });

// --- POST /api/akun/verifikasi/kirim-ulang (202) ---
export const KirimUlangVerifikasiRequestSchema = z.object({ email: EmailAkunSchema });

// --- POST /api/akun/masuk ---
export const MasukRequestSchema = z.object({
  email: EmailAkunSchema,
  sandi: SandiSchema,
  next: NextSchema.optional(),
  /** Token widget Turnstile; wajib bila galat sebelumnya TURNSTILE_WAJIB (>= 3 gagal). */
  turnstile: z.string().max(4096).optional(),
});
export const MasukResponseSchema = z.object({
  akun: AkunSchema,
  /** Path aman untuk dituju setelah masuk. */
  next: z.string(),
  /** Jumlah urusan tamu (cookie urusin_sid) yang dipindahkan ke akun. */
  urusanDipindahkan: z.number().int().nonnegative(),
  /** Data Diri + dompet tamu dienkripsi ulang ke akun. */
  vaultDipindahkan: z.boolean(),
  /** Identitas Google yang menunggu bukti sandi (cookie tautan) kini tertaut. */
  googleTertaut: z.boolean(),
});

// --- POST /api/akun/juri ("Masuk sebagai juri": salinan demo terisolasi, data sintetis, 24 jam) ---
export const JuriRequestSchema = z.object({ turnstile: z.string().max(4096).optional() });

// --- POST /api/akun/konfirmasi-sandi (re-auth <= 15 menit sebelum unduh berkas di perangkat baru) ---
export const KonfirmasiSandiRequestSchema = z.object({ sandi: SandiSchema });
export const KonfirmasiSandiResponseSchema = z.object({ berhasil: z.literal(true) });

// --- POST /api/akun/keluar, /api/akun/keluar-semua ---
export const KeluarResponseSchema = z.object({ keluar: z.literal(true), sesiDihapus: z.number().int() });

// --- POST /api/akun/lupa-sandi (202) ---
export const LupaSandiRequestSchema = z.object({ email: EmailAkunSchema });

// --- POST /api/akun/atur-ulang-sandi ---
export const AturUlangSandiRequestSchema = z.object({ token: TokenEmailSchema, sandi: SandiSchema });
export const AturUlangSandiResponseSchema = z.object({ berhasil: z.literal(true) });

// --- POST /api/akun/ubah-sandi ---
export const UbahSandiRequestSchema = z.object({
  /** Wajib bila `akun.punyaSandi`. */
  sandiLama: SandiSchema.optional(),
  sandiBaru: SandiSchema,
});
export const UbahSandiResponseSchema = z.object({ berhasil: z.literal(true) });

// --- POST /api/akun/hapus ---
export const HapusAkunRequestSchema = z.object({
  /** Warga mengetik HAPUS. */
  konfirmasi: z.string().max(20),
  /** Wajib bila `akun.punyaSandi`. */
  sandi: SandiSchema.optional(),
});
export const HapusAkunResponseSchema = z.object({ terhapus: z.literal(true) });

// --- GET/PUT /api/vault/data-diri ---
const teks = (max: number) => z.string().trim().max(max);
/** Data Diri warga. Disimpan terenkripsi per pemilik; tidak pernah dikirim ke model (placeholder tetap berlaku). */
export const DataDiriSchema = z.object({
  namaLengkap: teks(200).optional(),
  nik: z
    .string()
    .regex(/^\d{16}$/)
    .optional(),
  noKk: z
    .string()
    .regex(/^\d{16}$/)
    .optional(),
  tempatLahir: teks(100).optional(),
  tanggalLahir: z.iso.date().optional(),
  jenisKelamin: z.enum(['laki-laki', 'perempuan']).optional(),
  agama: teks(50).optional(),
  statusPerkawinan: teks(50).optional(),
  pekerjaan: teks(100).optional(),
  alamat: teks(300).optional(),
  rt: z
    .string()
    .regex(/^\d{1,3}$/)
    .optional(),
  rw: z
    .string()
    .regex(/^\d{1,3}$/)
    .optional(),
  kelurahan: teks(100).optional(),
  kecamatan: teks(100).optional(),
  kodeKabKota: KodeKabKotaSchema.optional(),
  kodePos: z
    .string()
    .regex(/^\d{5}$/)
    .optional(),
  hp: z
    .string()
    .regex(/^\+?\d{9,15}$/)
    .optional(),
  email: z.email().max(254).optional(),
});
export type DataDiri = z.infer<typeof DataDiriSchema>;
export const DataDiriResponseSchema = z.object({
  dataDiri: DataDiriSchema,
  diubahPada: IsoWaktuSchema.nullable(),
});

// --- POST /api/akun/profil (Lengkapi profil) ---
export const LengkapiProfilRequestSchema = z.object({
  namaLengkap: teks(200).min(1),
  hp: z
    .string()
    .regex(/^\+?\d{9,15}$/)
    .optional(),
});

// --- /api/vault (dompet dokumen) ---
export const JenisDokumenSchema = z.enum(['ktp', 'kk', 'akta', 'surat', 'foto', 'lainnya']);
export const MIME_DOKUMEN = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export const UKURAN_DOKUMEN_MAKS = 9 * 1024 * 1024;
export const BERKAS_PER_PEMILIK_MAKS = 10;
export const DokumenAkunSchema = z.object({
  id: z.string().min(1),
  jenis: JenisDokumenSchema,
  judul: z.string(),
  mime: z.enum(MIME_DOKUMEN),
  ukuran: z.number().int().nonnegative(),
  disimpanPada: IsoWaktuSchema,
});
export type DokumenAkun = z.infer<typeof DokumenAkunSchema>;
export const DaftarDokumenResponseSchema = z.object({ dokumen: z.array(DokumenAkunSchema) });

/** GET /api/vault: isi vault TANPA nilai (nilai hanya di respons detail yang diminta pemilik). */
export const VaultResponseSchema = z.object({
  pemilik: JenisPenggunaSchema,
  /** false = vault satu perangkat (tamu, atau akun yang emailnya belum dipastikan). */
  sinkron: z.boolean(),
  dataDiri: z.object({ ada: z.boolean(), diubahPada: IsoWaktuSchema.nullable() }),
  dokumen: z.array(DokumenAkunSchema),
  batas: z.object({ berkas: z.number().int(), ukuranBerkas: z.number().int() }),
});
export type VaultResponse = z.infer<typeof VaultResponseSchema>;
/** Field multipart POST /api/vault: `berkas` (File) + field teks berikut. */
export const UnggahDokumenFieldsSchema = z.object({
  jenis: JenisDokumenSchema,
  judul: z.string().trim().min(1).max(200),
});
export const HapusDokumenResponseSchema = z.object({ terhapus: z.literal(true) });

/**
 * Metadata endpoint akun + vault (pelengkap `ENDPOINT`). Rute halaman ada di docs/ui/auth.md. Endpoint vault
 * GET wajib `Sec-Fetch-Site: same-origin` (fetch biasa dari halaman) dan selalu `Cache-Control: no-store`.
 */
export const ENDPOINT_AKUN = {
  sesi: { method: 'GET', path: '/api/akun', sukses: 200 },
  daftar: { method: 'POST', path: '/api/akun/daftar', sukses: 202 },
  verifikasi: { method: 'POST', path: '/api/akun/verifikasi', sukses: 200 },
  kirimUlangVerifikasi: { method: 'POST', path: '/api/akun/verifikasi/kirim-ulang', sukses: 202 },
  masuk: { method: 'POST', path: '/api/akun/masuk', sukses: 200 },
  juri: { method: 'POST', path: '/api/akun/juri', sukses: 200 },
  konfirmasiSandi: { method: 'POST', path: '/api/akun/konfirmasi-sandi', sukses: 200 },
  keluar: { method: 'POST', path: '/api/akun/keluar', sukses: 200 },
  keluarSemua: { method: 'POST', path: '/api/akun/keluar-semua', sukses: 200 },
  lupaSandi: { method: 'POST', path: '/api/akun/lupa-sandi', sukses: 202 },
  aturUlangSandi: { method: 'POST', path: '/api/akun/atur-ulang-sandi', sukses: 200 },
  ubahSandi: { method: 'POST', path: '/api/akun/ubah-sandi', sukses: 200 },
  hapusAkun: { method: 'POST', path: '/api/akun/hapus', sukses: 200 },
  lengkapiProfil: { method: 'POST', path: '/api/akun/profil', sukses: 200 },
  urusanAkun: { method: 'GET', path: '/api/akun/urusan', sukses: 200 },
  vault: { method: 'GET', path: '/api/vault', sukses: 200 },
  unggahDokumen: { method: 'POST', path: '/api/vault', sukses: 201 },
  dataDiri: { method: 'GET', path: '/api/vault/data-diri', sukses: 200 },
  simpanDataDiri: { method: 'PUT', path: '/api/vault/data-diri', sukses: 200 },
  unduhDokumen: { method: 'GET', path: '/api/vault/[id]', sukses: 200 },
  hapusDokumen: { method: 'DELETE', path: '/api/vault/[id]', sukses: 200 },
  googleMulai: { method: 'GET', path: '/auth/google', sukses: 302 },
  googleCallback: { method: 'GET', path: '/auth/google/callback', sukses: 303 },
} as const;

export type DaftarRequest = z.infer<typeof DaftarRequestSchema>;
export type MasukRequest = z.infer<typeof MasukRequestSchema>;
export type MasukResponse = z.infer<typeof MasukResponseSchema>;
export type LupaSandiRequest = z.infer<typeof LupaSandiRequestSchema>;
export type AturUlangSandiRequest = z.infer<typeof AturUlangSandiRequestSchema>;
export type UbahSandiRequest = z.infer<typeof UbahSandiRequestSchema>;
export type HapusAkunRequest = z.infer<typeof HapusAkunRequestSchema>;
export type DataDiriResponse = z.infer<typeof DataDiriResponseSchema>;
export type LengkapiProfilRequest = z.infer<typeof LengkapiProfilRequestSchema>;
export type JuriRequest = z.infer<typeof JuriRequestSchema>;
export type KonfirmasiSandiRequest = z.infer<typeof KonfirmasiSandiRequestSchema>;
export type StatusEmail = z.infer<typeof StatusEmailSchema>;
export type DaftarDokumenResponse = z.infer<typeof DaftarDokumenResponseSchema>;
