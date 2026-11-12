/** Kode galat akun (juga di @urusin/contracts `KodeGalatAkunSchema`). */
export type KodeGalatAkun =
  | 'EMAIL_TIDAK_VALID'
  | 'SANDI_TERLALU_PENDEK'
  | 'SANDI_TERLALU_PANJANG'
  | 'SANDI_TERLALU_UMUM'
  | 'KREDENSIAL_SALAH'
  | 'EMAIL_SUDAH_TERDAFTAR'
  | 'TERKUNCI'
  | 'RATE_LIMITED'
  | 'TOKEN_TIDAK_VALID'
  | 'SANDI_LAMA_SALAH'
  | 'KONFIRMASI_SALAH'
  | 'BELUM_MASUK'
  | 'GOOGLE_TIDAK_AKTIF'
  | 'GOOGLE_GAGAL'
  | 'GOOGLE_EMAIL_BELUM_TERVERIFIKASI'
  | 'GOOGLE_PERLU_SANDI'
  | 'GOOGLE_SUDAH_DIPAKAI'
  | 'TURNSTILE_WAJIB'
  | 'TURNSTILE_TIDAK_AKTIF'
  | 'GOOGLE_SATU_SATUNYA'
  | 'TAMU_PENUH'
  | 'DEMO_BATAS_IP'
  | 'DEMO_PENUH'
  | 'HANYA_AKUN'
  | 'DOKUMEN_TERLALU_BESAR'
  | 'DOKUMEN_JENIS_DITOLAK'
  | 'DOKUMEN_KUOTA_PENUH'
  | 'PENYIMPANAN_PENUH'
  | 'PERLU_MASUK_ULANG'
  | 'IZIN_TIDAK_VALID'
  | 'NILAI_SINTETIS_DITOLAK'
  | 'ATUR_ULANG_NONAKTIF';

const PESAN: Record<KodeGalatAkun, [number, string]> = {
  EMAIL_TIDAK_VALID: [422, 'Alamat email belum benar. Periksa lagi.'],
  SANDI_TERLALU_PENDEK: [422, 'Kata sandi minimal 10 karakter.'],
  SANDI_TERLALU_PANJANG: [422, 'Kata sandi terlalu panjang. Maksimal 128 karakter.'],
  SANDI_TERLALU_UMUM: [422, 'Kata sandi ini terlalu mudah ditebak. Pilih yang lain.'],
  KREDENSIAL_SALAH: [401, 'Email atau kata sandi salah.'],
  EMAIL_SUDAH_TERDAFTAR: [409, 'Email ini sudah terdaftar. Silakan masuk.'],
  TERKUNCI: [429, 'Terlalu banyak percobaan masuk. Tunggu sebentar lalu coba lagi.'],
  RATE_LIMITED: [429, 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.'],
  TOKEN_TIDAK_VALID: [400, 'Tautan sudah tidak berlaku atau sudah dipakai. Minta tautan baru.'],
  SANDI_LAMA_SALAH: [401, 'Kata sandi saat ini salah.'],
  KONFIRMASI_SALAH: [422, 'Konfirmasi belum sesuai. Ketik HAPUS untuk menghapus akun.'],
  BELUM_MASUK: [401, 'Silakan masuk dulu.'],
  GOOGLE_TIDAK_AKTIF: [404, 'Masuk dengan Google belum tersedia. Pakai email dan kata sandi.'],
  GOOGLE_GAGAL: [400, 'Masuk dengan Google gagal. Coba lagi.'],
  GOOGLE_EMAIL_BELUM_TERVERIFIKASI: [403, 'Email akun Google Anda belum dipastikan oleh Google.'],
  GOOGLE_PERLU_SANDI: [
    409,
    'Email ini sudah punya akun Urusin. Masukkan kata sandinya sekali untuk menautkan Google.',
  ],
  GOOGLE_SUDAH_DIPAKAI: [409, 'Akun Google ini sudah tertaut ke akun Urusin lain.'],
  TURNSTILE_WAJIB: [403, 'Selesaikan pemeriksaan keamanan dulu, lalu coba lagi.'],
  TURNSTILE_TIDAK_AKTIF: [503, 'Pemeriksaan keamanan belum tersedia. Coba lagi nanti.'],
  GOOGLE_SATU_SATUNYA: [409, 'Buat kata sandi dulu sebelum melepas Google, supaya Anda tetap bisa masuk.'],
  TAMU_PENUH: [
    429,
    'Terlalu banyak sesi tamu dari jaringan ini hari ini. Coba lagi besok, atau daftar akun gratis.',
  ],
  DEMO_BATAS_IP: [429, 'Akun juri dari jaringan ini sudah dibuat 3 kali hari ini. Coba lagi besok.'],
  DEMO_PENUH: [503, 'Akun juri sedang penuh. Coba lagi nanti atau daftar gratis dengan email.'],
  HANYA_AKUN: [403, 'Fitur ini hanya untuk akun terdaftar.'],
  DOKUMEN_TERLALU_BESAR: [413, 'Berkas terlalu besar. Maksimal 9 MB.'],
  DOKUMEN_JENIS_DITOLAK: [415, 'Jenis berkas tidak didukung. Pakai JPG, PNG, WebP, atau PDF.'],
  DOKUMEN_KUOTA_PENUH: [409, 'Maksimal 10 berkas. Hapus berkas lama dulu.'],
  PENYIMPANAN_PENUH: [507, 'Penyimpanan sedang penuh, coba lagi nanti.'],
  PERLU_MASUK_ULANG: [
    401,
    'Demi keamanan, masukkan kata sandi lagi sebelum mengunduh berkas di perangkat ini.',
  ],
  IZIN_TIDAK_VALID: [403, 'Persetujuan isi sudah tidak berlaku. Tekan "Izinkan isi" lagi.'],
  NILAI_SINTETIS_DITOLAK: [403, 'Data contoh akun juri tidak boleh dikirim ke situs resmi.'],
  ATUR_ULANG_NONAKTIF: [
    503,
    'Atur ulang kata sandi lewat email belum tersedia. Bila akun Anda tertaut Google, masuk dengan Google.',
  ],
};

/**
 * Galat domain akun; `pesanWarga` aman ditampilkan apa adanya. Hanya `EMAIL_SUDAH_TERDAFTAR` (daftar) yang
 * menyatakan email terdaftar (ADR 0032); masuk dan lupa sandi tetap tidak membocorkannya.
 */
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
