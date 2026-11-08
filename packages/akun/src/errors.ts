/** Kode galat akun (juga di @urusin/contracts `KodeGalatAkunSchema`). */
export type KodeGalatAkun =
  | 'EMAIL_TIDAK_VALID'
  | 'SANDI_TERLALU_PENDEK'
  | 'SANDI_TERLALU_PANJANG'
  | 'SANDI_TERLALU_UMUM'
  | 'KREDENSIAL_SALAH'
  | 'EMAIL_BELUM_TERVERIFIKASI'
  | 'TERKUNCI'
  | 'RATE_LIMITED'
  | 'TOKEN_TIDAK_VALID'
  | 'SANDI_LAMA_SALAH'
  | 'KONFIRMASI_SALAH'
  | 'BELUM_MASUK'
  | 'GOOGLE_TIDAK_AKTIF'
  | 'GOOGLE_GAGAL'
  | 'GOOGLE_EMAIL_BELUM_TERVERIFIKASI';

const PESAN: Record<KodeGalatAkun, [number, string]> = {
  EMAIL_TIDAK_VALID: [422, 'Alamat email belum benar. Periksa lagi.'],
  SANDI_TERLALU_PENDEK: [422, 'Kata sandi minimal 8 karakter.'],
  SANDI_TERLALU_PANJANG: [422, 'Kata sandi terlalu panjang. Maksimal 128 karakter.'],
  SANDI_TERLALU_UMUM: [422, 'Kata sandi ini terlalu mudah ditebak. Pilih yang lain.'],
  KREDENSIAL_SALAH: [401, 'Email atau kata sandi salah.'],
  EMAIL_BELUM_TERVERIFIKASI: [
    403,
    'Email belum dipastikan. Buka tautan di email dari kami, atau minta dikirim ulang.',
  ],
  TERKUNCI: [429, 'Terlalu banyak percobaan masuk. Tunggu sebentar lalu coba lagi.'],
  RATE_LIMITED: [429, 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.'],
  TOKEN_TIDAK_VALID: [400, 'Tautan sudah tidak berlaku atau sudah dipakai. Minta tautan baru.'],
  SANDI_LAMA_SALAH: [401, 'Kata sandi saat ini salah.'],
  KONFIRMASI_SALAH: [422, 'Konfirmasi belum sesuai. Ketik HAPUS untuk menghapus akun.'],
  BELUM_MASUK: [401, 'Silakan masuk dulu.'],
  GOOGLE_TIDAK_AKTIF: [404, 'Masuk dengan Google belum tersedia. Pakai email dan kata sandi.'],
  GOOGLE_GAGAL: [400, 'Masuk dengan Google gagal. Coba lagi.'],
  GOOGLE_EMAIL_BELUM_TERVERIFIKASI: [403, 'Email akun Google Anda belum dipastikan oleh Google.'],
};

/** Galat domain akun; `pesanWarga` aman ditampilkan apa adanya (tidak membocorkan apakah email terdaftar). */
export class AkunError extends Error {
  readonly status: number;
  readonly pesanWarga: string;
  constructor(
    readonly kode: KodeGalatAkun,
    readonly retryAfterSec?: number,
  ) {
    const [status, pesan] = PESAN[kode];
    super(pesan);
    this.name = 'AkunError';
    this.status = status;
    this.pesanWarga = pesan;
  }
}
