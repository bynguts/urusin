import type { IntentJenis } from './intent.js';

/**
 * Prototipe jalur cepat embedding (`klasifikasiEmbedding`): kalimat contoh per jenis urusan yang divektorkan sekali
 * per proses. Kalimat ini SENGAJA berbeda dari set eval (packages/embedding/eval/intent.json) agar akurasi yang
 * dilaporkan di HASIL.md tidak bocor dari prototipe. `lainnya` tidak punya prototipe: jenis terbuka, ditangani
 * ambang (tidak yakin -> tetap ke LLM).
 */
export const PROTOTIPE_INTENT: Readonly<Partial<Record<IntentJenis, readonly string[]>>> = {
  kelahiran: [
    'mengurus akta kelahiran untuk bayi yang baru dilahirkan',
    'pencatatan kelahiran anak dan penambahan anak ke kartu keluarga',
    'istri saya baru melahirkan, perlu daftar akta lahir anak',
    'buat akte kelahiran anak',
    'anak saya lahir minggu lalu di rumah sakit, surat apa yang harus diurus',
  ],
  kematian: [
    'mengurus akta kematian anggota keluarga yang meninggal dunia',
    'melaporkan kematian orang tua ke dukcapil',
    'nenek saya sudah tiada, bagaimana mencoret namanya dari kartu keluarga',
    'surat keterangan kematian untuk klaim asuransi dan warisan',
  ],
  perkawinan: [
    'mencatatkan pernikahan di catatan sipil untuk mendapat akta perkawinan',
    'baru menikah, mau ubah status kawin di KTP dan gabung KK dengan pasangan',
    'pencatatan perkawinan non muslim di disdukcapil',
    'syarat daftar nikah dan buku nikah',
  ],
  pindah: [
    'pindah domisili ke kota lain dan mengurus surat keterangan pindah (SKPWNI)',
    'pindah datang, mendaftarkan alamat baru setelah pindah dari kabupaten lain',
    'mutasi penduduk keluar daerah karena pindah kerja',
    'ganti alamat KTP karena sudah pindah rumah ke kecamatan lain',
  ],
  ktp: [
    'membuat KTP elektronik pertama kali setelah berumur 17 tahun',
    'mengganti KTP-el yang hilang atau rusak',
    'perekaman data e-KTP dan cetak KTP',
    'KTP saya patah, perlu cetak ulang',
    'ubah data di KTP elektronik',
  ],
  kk: [
    'membuat kartu keluarga baru atau memisahkan diri dari kartu keluarga orang tua',
    'perubahan data kartu keluarga, menambah atau mengurangi anggota keluarga',
    'cetak ulang kartu keluarga yang hilang atau rusak',
    'pecah KK setelah berkeluarga sendiri',
  ],
  kia: [
    'membuat Kartu Identitas Anak (KIA) untuk anak di bawah 17 tahun',
    'kartu identitas untuk anak usia sekolah, semacam KTP anak',
    'KIA anak hilang, ingin cetak ulang kartu identitas anak',
  ],
  akta: [
    'mengurus akta perceraian di catatan sipil',
    'membetulkan kesalahan nama atau tanggal pada akta catatan sipil',
    'akta pengakuan atau pengesahan anak',
    'cetak ulang kutipan akta yang hilang',
    'akta pengangkatan anak (adopsi)',
  ],
  skck: [
    'membuat Surat Keterangan Catatan Kepolisian (SKCK) untuk melamar kerja',
    'perpanjang SKCK di polsek atau polres',
    'surat kelakuan baik dari kepolisian',
  ],
  pajak_kendaraan: [
    'membayar pajak tahunan kendaraan bermotor di Samsat',
    'cek dan bayar pajak motor atau mobil yang sudah jatuh tempo',
    'perpanjang STNK lima tahunan dan ganti plat nomor',
    'denda pajak kendaraan telat bayar',
  ],
  cek_dpt: [
    'mengecek apakah saya terdaftar sebagai pemilih tetap untuk pemilu',
    'cek DPT dan lokasi TPS untuk pemilihan umum',
    'nama saya tidak ada di daftar pemilih pilkada',
  ],
  bansos: [
    'mendaftar bantuan sosial dari pemerintah untuk keluarga tidak mampu',
    'cek penerima bansos PKH, BPNT, atau BLT',
    'bantuan sembako dari kemensos belum diterima',
  ],
  pengaduan: [
    'mengadukan pelayanan publik yang buruk atau pungutan liar',
    'melapor ke pemerintah karena keluhan layanan tidak ditanggapi',
    'menyampaikan aduan lewat LAPOR atau kanal pengaduan resmi',
  ],
};

/**
 * Instruksi kueri untuk model berinstruksi (Qwen3/Harrier). Bahasa Inggris sesuai rekomendasi kartu model; teks
 * warga tetap Bahasa Indonesia apa adanya (setelah redaksi PII).
 */
export const INSTRUKSI_INTENT =
  "Given an Indonesian citizen's message, retrieve the public administration service they need";
