/**
 * Anggaran Navigator (ADR 0030): batas panggilan LLM, aksi, halaman, dan waktu AI per eksekusi. Waktu warga
 * memegang kendali (login, CAPTCHA, persetujuan) tidak dihitung. Anggaran habis, halaman yang sama berulang
 * tanpa kemajuan, atau kegagalan beruntun berarti kendali diserahkan ke warga dengan pesan TEMPLAT (tidak
 * pernah teks dari model).
 */

export const BATAS_ANGGARAN = {
  panggilanLlm: 24,
  aksi: 60,
  halaman: 10,
  waktuAiMs: 8 * 60_000,
  /** Sidik halaman sama sekian kali berturut-turut tanpa kemajuan = putaran. */
  sidikSama: 3,
  gagalBeruntun: 3,
} as const;
export type BatasAnggaran = { [K in keyof typeof BATAS_ANGGARAN]: number };

export type AlasanAmbilAlih =
  | 'anggaran_llm'
  | 'anggaran_aksi'
  | 'anggaran_halaman'
  | 'anggaran_waktu'
  | 'putaran'
  | 'gagal_beruntun'
  | 'masuk_akun'
  | 'otp'
  | 'captcha'
  | 'final'
  | 'isi_sendiri'
  | 'ketuk_tautan'
  | 'tidak_yakin'
  | 'host_luar'
  | 'diblokir_situs'
  /** Kuota AI runtime (per urusan / harian) habis: sama dengan kuota agen percakapan. */
  | 'kuota';

/** Pesan untuk warga per alasan: templat tetap, tanpa teks dari model atau halaman. */
export const PESAN_AMBIL_ALIH: Readonly<Record<AlasanAmbilAlih, string>> = {
  anggaran_llm:
    'AI sudah mencoba cukup lama di situs ini. Silakan lanjutkan sendiri dari layar ini; data yang sudah terisi tetap ada.',
  anggaran_aksi:
    'AI sudah mencapai batas langkah otomatis. Silakan lanjutkan sendiri dari layar ini; data yang sudah terisi tetap ada.',
  anggaran_halaman:
    'Formulir ini lebih panjang dari batas bantuan otomatis. Silakan lanjutkan sendiri dari layar ini.',
  anggaran_waktu: 'Waktu bantuan otomatis untuk situs ini habis. Silakan lanjutkan sendiri dari layar ini.',
  putaran:
    'Halaman ini tidak berubah setelah beberapa percobaan. Silakan periksa pesan di layar dan lanjutkan sendiri.',
  gagal_beruntun: 'AI beberapa kali gagal memahami halaman ini. Silakan lanjutkan sendiri dari layar ini.',
  masuk_akun: 'Giliran Anda: masuk ke akun Anda di situs ini, lalu tekan Lanjutkan.',
  otp: 'Giliran Anda: masukkan kode OTP yang dikirim situs, lalu tekan Lanjutkan.',
  captcha: 'Giliran Anda: selesaikan verifikasi situs (CAPTCHA), lalu tekan Lanjutkan.',
  final: 'Giliran Anda: periksa isian di layar. Tombol kirim/simpan selalu Anda yang menekan, bukan AI.',
  isi_sendiri: 'Giliran Anda: isi kolom yang disorot sendiri, lalu tekan Lanjutkan.',
  ketuk_tautan: 'Giliran Anda: ketuk tautan yang disorot untuk membuka formulir, lalu tekan Lanjutkan.',
  tidak_yakin: 'AI tidak yakin dengan langkah berikutnya. Silakan lanjutkan sendiri dari layar ini.',
  host_luar:
    'Situs membuka alamat di luar daftar resmi wilayah Anda. AI berhenti; periksa alamatnya sebelum melanjutkan sendiri.',
  diblokir_situs: 'Situs menahan langkah otomatis. Silakan periksa layar dan lanjutkan sendiri.',
  kuota:
    'Batas bantuan AI untuk urusan ini sudah tercapai. Silakan lanjutkan sendiri dari layar ini; data yang sudah terisi tetap ada.',
};

export type SisaAnggaran = {
  panggilanLlm: number;
  aksi: number;
  halaman: number;
  waktuAiMs: number;
};

export class Anggaran {
  private llm = 0;
  private aksiN = 0;
  private readonly halamanTerlihat = new Set<string>();
  private sidikTerakhir: string | null = null;
  private samaBeruntun = 0;
  private gagalN = 0;
  private aiMs = 0;
  private aiMulai: number | null = null;

  constructor(
    readonly batas: BatasAnggaran = BATAS_ANGGARAN,
    private readonly jam: () => number = Date.now,
  ) {}

  /** Mulai menghitung waktu AI (idempoten). */
  mulaiAi(): void {
    this.aiMulai ??= this.jam();
  }

  /** Jeda hitungan waktu AI (warga memegang kendali / menunggu persetujuan). */
  jedaAi(): void {
    if (this.aiMulai !== null) this.aiMs += this.jam() - this.aiMulai;
    this.aiMulai = null;
  }

  waktuAiMs(): number {
    return this.aiMs + (this.aiMulai === null ? 0 : this.jam() - this.aiMulai);
  }

  catatLlm(n = 1): void {
    this.llm += n;
  }

  catatAksi(n: number): void {
    this.aksiN += n;
  }

  /** Satu pengamatan perencanaan. Sidik baru = kemajuan; sidik yang sama berturut-turut = calon putaran. */
  catatHalaman(sidik: string): void {
    if (sidik === this.sidikTerakhir) this.samaBeruntun++;
    else {
      this.sidikTerakhir = sidik;
      this.samaBeruntun = 1;
    }
    this.halamanTerlihat.add(sidik);
  }

  gagal(): void {
    this.gagalN++;
  }

  berhasil(): void {
    this.gagalN = 0;
  }

  /** Alasan ambil alih bila anggaran habis; null bila masih boleh lanjut. */
  habis(): AlasanAmbilAlih | null {
    if (this.llm >= this.batas.panggilanLlm) return 'anggaran_llm';
    if (this.aksiN >= this.batas.aksi) return 'anggaran_aksi';
    if (this.halamanTerlihat.size > this.batas.halaman) return 'anggaran_halaman';
    if (this.waktuAiMs() >= this.batas.waktuAiMs) return 'anggaran_waktu';
    if (this.samaBeruntun >= this.batas.sidikSama) return 'putaran';
    if (this.gagalN >= this.batas.gagalBeruntun) return 'gagal_beruntun';
    return null;
  }

  sisa(): SisaAnggaran {
    return {
      panggilanLlm: Math.max(0, this.batas.panggilanLlm - this.llm),
      aksi: Math.max(0, this.batas.aksi - this.aksiN),
      halaman: Math.max(0, this.batas.halaman - this.halamanTerlihat.size),
      waktuAiMs: Math.max(0, this.batas.waktuAiMs - this.waktuAiMs()),
    };
  }

  ringkas(): { panggilanLlm: number; aksi: number; halaman: number; waktuAiMs: number } {
    return {
      panggilanLlm: this.llm,
      aksi: this.aksiN,
      halaman: this.halamanTerlihat.size,
      waktuAiMs: this.waktuAiMs(),
    };
  }
}
