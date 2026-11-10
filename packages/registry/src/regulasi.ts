import type { SourceRef } from './schema.js';

/**
 * Dasar hukum nasional yang dikutip registry, dengan URL teks resminya. Setiap fakta di `FAKTA_HUKUM` sudah
 * dicocokkan dengan teks pasalnya pada 2026-11-10 (unduhan peraturan.go.id / peraturan.bpk.go.id).
 */
const RI = 'Pemerintah Republik Indonesia';
const KEMENDAGRI = 'Kementerian Dalam Negeri';

export const REF_PERPRES: SourceRef = {
  url: 'https://peraturan.go.id/id/perpres-no-96-tahun-2018',
  judul:
    'Perpres No. 96 Tahun 2018 tentang Persyaratan dan Tata Cara Pendaftaran Penduduk dan Pencatatan Sipil',
  instansi: RI,
};
/** Teks lengkap Perpres 96/2018 (PDF), untuk fakta yang menyebut pasal. */
export const REF_PERPRES_TEKS: SourceRef = {
  url: 'https://peraturan.go.id/files/ps96-2018.pdf',
  judul: 'Perpres No. 96 Tahun 2018 (teks lengkap)',
  instansi: RI,
};
export const REF_PMD108: SourceRef = {
  url: 'https://peraturan.bpk.go.id/Download/129847/Permendagri%20108%20Tahun%202019.pdf',
  judul: 'Permendagri No. 108 Tahun 2019 tentang Peraturan Pelaksanaan Perpres No. 96 Tahun 2018',
  instansi: KEMENDAGRI,
};
/** Status Permendagri 108/2019 di JDIH BPK: "Mencabut: Permendagri 9/2016" (dasar SPTJM lama). */
export const REF_PMD108_STATUS: SourceRef = {
  url: 'https://peraturan.bpk.go.id/Details/138582/permendagri-no-108-tahun-2019',
  judul: 'Permendagri No. 108 Tahun 2019 (status: mencabut Permendagri No. 9 Tahun 2016)',
  instansi: 'Badan Pemeriksa Keuangan Republik Indonesia (JDIH)',
};
export const REF_PMD7_2026: SourceRef = {
  url: 'https://peraturan.bpk.go.id/Download/423299/permendagri-no-7-tahun-2026.pdf',
  judul: 'Permendagri No. 7 Tahun 2026 tentang Penerbitan Kartu Identitas Anak',
  instansi: KEMENDAGRI,
};
/** Status Permendagri 2/2016 di JDIH BPK: "Dicabut dengan Permendagri 7/2026". */
export const REF_PMD2_2016_STATUS: SourceRef = {
  url: 'https://peraturan.bpk.go.id/Details/248391',
  judul: 'Permendagri No. 2 Tahun 2016 tentang Kartu Identitas Anak (status: dicabut)',
  instansi: 'Badan Pemeriksa Keuangan Republik Indonesia (JDIH)',
};
export const REF_UU24: SourceRef = {
  url: 'https://peraturan.go.id/files/uu24-2013bt.pdf',
  judul: 'UU No. 24 Tahun 2013 tentang Perubahan atas UU No. 23 Tahun 2006 tentang Administrasi Kependudukan',
  instansi: RI,
};
export const REF_UU23: SourceRef = {
  url: 'https://peraturan.go.id/files/uu23-2006.pdf',
  judul: 'UU No. 23 Tahun 2006 tentang Administrasi Kependudukan',
  instansi: RI,
};
/** Panduan Ditjen Dukcapil 2023 (masih merujuk Permendagri 2/2016 untuk KIA; untuk KIA pakai Permendagri 7/2026). */
export const REF_DUKCAPIL_2023: SourceRef = {
  url: 'https://dukcapil.kemendagri.go.id/files/2023/1680205930Syarat%20dan%20Prosedur%20Layanan%20Pendaftaran%20Penduduk.pdf',
  judul: 'Syarat dan Prosedur Layanan Pendaftaran Penduduk (Ditjen Dukcapil, 2023)',
  instansi: KEMENDAGRI,
};

/** Permendagri 109/2019 (status Berlaku di peraturan.go.id): kode dan kegunaan formulir adminduk, Ps. 4 dan 5. */
export const REF_PMD109: SourceRef = {
  url: 'https://peraturan.go.id/files/bn1790-2019.pdf',
  judul:
    'Permendagri No. 109 Tahun 2019 tentang Formulir dan Buku yang Digunakan dalam Administrasi Kependudukan',
  instansi: KEMENDAGRI,
};
/** Peraturan Polri 1/2026 (berlaku 20 Mei 2026; mencabut Perpol 6/2023). */
export const REF_PERPOL1_2026: SourceRef = {
  url: 'https://peraturan.go.id/files/peraturan-polri-no-1-tahun-2026.pdf',
  judul: 'Peraturan Polri No. 1 Tahun 2026 tentang Penerbitan Surat Keterangan Catatan Kepolisian',
  instansi: 'Kepolisian Negara Republik Indonesia',
};

export type FaktaHukum = {
  id: string;
  /** Kalimat siap tampil, Bahasa Indonesia sederhana. */
  teks: string;
  /** Pasal yang dirujuk, mis. "UU 24/2013 Ps. 27 ayat (1)". */
  pasal: string;
  sourceRef: readonly SourceRef[];
};

/**
 * Fakta hukum yang sering salah dijawab (aturan lama, dokumen yang tidak ada di tingkat nasional). Dipakai untuk
 * sistem prompt dan dikunci tes; sumber setiap fakta = teks resmi peraturannya.
 */
export const FAKTA_HUKUM: readonly FaktaHukum[] = [
  {
    id: 'kia-aturan-berlaku',
    teks: 'Aturan KIA yang berlaku adalah Permendagri 7/2026 (berlaku 2 Maret 2026). Permendagri 2/2016 sudah dicabut.',
    pasal: 'Permendagri 7/2026 Ps. 34 dan 35',
    sourceRef: [REF_PMD7_2026, REF_PMD2_2016_STATUS],
  },
  {
    id: 'kia-balita-bersama-akta',
    teks: 'KIA anak di bawah 5 tahun yang terbit bersama akta kelahiran: cukup fotokopi KK (atau wali).',
    pasal: 'Permendagri 7/2026 Ps. 4 huruf a dan Ps. 6 ayat (1)',
    sourceRef: [REF_PMD7_2026],
  },
  {
    id: 'kia-balita-sudah-akta',
    teks: 'KIA anak di bawah 5 tahun yang sudah punya akta: fotokopi kutipan akta kelahiran dan fotokopi KK (atau wali), tanpa pas foto.',
    pasal: 'Permendagri 7/2026 Ps. 6 ayat (2)',
    sourceRef: [REF_PMD7_2026],
  },
  {
    id: 'kia-5-17',
    teks: 'KIA anak 5 sampai 17 tahun kurang sehari: fotokopi kutipan akta kelahiran, fotokopi KK (atau wali), dan 1 lembar pas foto berwarna 2x3 cm. KTP-el asli orang tua tidak lagi disyaratkan.',
    pasal: 'Permendagri 7/2026 Ps. 6 ayat (3)',
    sourceRef: [REF_PMD7_2026],
  },
  {
    id: 'kia-daring',
    teks: 'KIA bisa diurus tatap muka (formulir F-1.02) atau online lewat aplikasi IKD; anak 5 tahun ke atas cukup mengunggah pas foto atau swafoto. KIA bisa dicetak di Anjungan Dukcapil Mandiri.',
    pasal: 'Permendagri 7/2026 Ps. 24 sampai 26',
    sourceRef: [REF_PMD7_2026],
  },
  {
    id: 'kia-hilang-rusak-pindah',
    teks: 'KIA hilang: surat keterangan kehilangan dari kepolisian. KIA rusak: serahkan KIA yang rusak. Pindah antar kab/kota: surat keterangan pindah dari daerah asal.',
    pasal: 'Permendagri 7/2026 Ps. 11, 12, dan 14',
    sourceRef: [REF_PMD7_2026],
  },
  {
    id: 'ktp-hilang',
    teks: 'KTP-el hilang tetap wajib surat keterangan hilang dari kepolisian, ditambah KK.',
    pasal: 'Perpres 96/2018 Ps. 21 huruf a dan c',
    sourceRef: [REF_PERPRES_TEKS],
  },
  {
    id: 'ktp-rusak',
    teks: 'KTP-el rusak: serahkan KTP-el yang rusak dan KK; tidak perlu surat kehilangan dari kepolisian.',
    pasal: 'Perpres 96/2018 Ps. 21 huruf b dan c',
    sourceRef: [REF_PERPRES_TEKS],
  },
  {
    id: 'ktp-luar-domisili',
    teks: 'Cetak KTP-el di Disdukcapil luar domisili adalah layanan resmi, asalkan tidak ada perubahan data; bawa KK.',
    pasal:
      'Perpres 96/2018 Ps. 14 huruf f dan Ps. 22; Permendagri 108/2019 Ps. 18 ayat (1) huruf f dan Ps. 24',
    sourceRef: [REF_PERPRES_TEKS],
  },
  {
    id: 'pindah-skp',
    teks: 'Dokumen pindah tingkat nasional hanya Surat Keterangan Pindah (SKP/SKPWNI) yang diterbitkan Disdukcapil daerah asal. SKDWNI bukan dokumen nasional; nama itu hanya dipakai sebagian daerah (mis. Wonogiri) untuk layanan pindah datang.',
    pasal: 'Perpres 96/2018 Ps. 25 ayat (3); Permendagri 108/2019 Ps. 28 dan 30',
    sourceRef: [REF_PERPRES_TEKS],
  },
  {
    id: 'pindah-tujuan',
    teks: 'Di daerah tujuan, Disdukcapil menerima SKPWNI lalu menerbitkan KK dan KTP-el alamat baru. KTP-el lama ditarik di daerah tujuan, bukan di asal.',
    pasal:
      'Perpres 96/2018 Ps. 17 ayat (1) dan Ps. 25 ayat (5); panduan Ditjen Dukcapil 2023 (penarikan KTP-el)',
    sourceRef: [REF_PERPRES_TEKS, REF_DUKCAPIL_2023],
  },
  {
    id: 'pindah-masa-berlaku',
    teks: 'SKP berlaku 100 hari kerja sejak terbit. Bila lewat dan belum dilaporkan di tujuan, SKP tidak berlaku dan pindah dibatalkan.',
    pasal: 'Permendagri 108/2019 Ps. 30 ayat (2) sampai (4)',
    sourceRef: [REF_PMD108],
  },
  {
    id: 'pindah-bantu-tujuan',
    teks: 'Warga yang sudah tinggal di daerah tujuan tidak harus pulang: Disdukcapil tujuan membantu meminta SKP ke Disdukcapil asal lewat surat atau media elektronik.',
    pasal: 'Permendagri 108/2019 Ps. 31',
    sourceRef: [REF_PMD108],
  },
  {
    id: 'pindah-satu-kabkota',
    teks: 'Pindah dalam satu kab/kota cukup satu langkah: Disdukcapil langsung menerbitkan KK, KTP-el, dan/atau KIA alamat baru.',
    pasal: 'Permendagri 108/2019 Ps. 29',
    sourceRef: [REF_PMD108],
  },
  {
    id: 'lahir-syarat',
    teks: 'Akta kelahiran: surat keterangan kelahiran, buku nikah/kutipan akta perkawinan atau bukti lain yang sah, KK tempat bayi didaftarkan, dan KTP-el. KTP-el tidak disyaratkan bagi ibu kandung di bawah 17 tahun yang belum kawin. Pemohon mengisi formulir pelaporan pencatatan sipil F-2.01.',
    pasal:
      'Perpres 96/2018 Ps. 33 ayat (1); Permendagri 108/2019 Ps. 43 ayat (1) sampai (3); Permendagri 109/2019 Ps. 4 ayat (2) huruf d',
    sourceRef: [REF_PERPRES_TEKS, REF_PMD108, REF_PMD109],
  },
  {
    id: 'lahir-60-hari',
    teks: 'Kelahiran wajib dilaporkan ke Disdukcapil paling lambat 60 hari sejak kelahiran.',
    pasal: 'UU 24/2013 Ps. 27 ayat (1)',
    sourceRef: [REF_UU24],
  },
  {
    id: 'lahir-terlambat',
    teks: 'Lewat 60 hari, akta kelahiran tetap diterbitkan setelah keputusan Kepala Disdukcapil setempat; tidak perlu penetapan pengadilan.',
    pasal: 'UU 24/2013 Ps. 32 ayat (1), ayat (2) dihapus',
    sourceRef: [REF_UU24],
  },
  {
    id: 'mati-30-hari',
    teks: 'Kematian wajib dilaporkan ketua RT (atau sebutan lain) ke Disdukcapil paling lambat 30 hari sejak tanggal kematian. Penetapan pengadilan hanya diperlukan bila jenazah tidak ditemukan.',
    pasal: 'UU 24/2013 Ps. 44 ayat (1) dan (4)',
    sourceRef: [REF_UU24],
  },
  {
    id: 'gratis',
    teks: 'Pengurusan dan penerbitan dokumen kependudukan tidak dipungut biaya. Petugas yang memungut biaya diancam penjara paling lama 6 tahun dan/atau denda paling banyak Rp75 juta (Ps. 95B).',
    pasal: 'UU 24/2013 Ps. 79A',
    sourceRef: [REF_UU24],
  },
  {
    id: 'pemalsuan-pidana',
    teks: 'Memalsukan surat atau dokumen saat melapor ke Disdukcapil diancam penjara paling lama 6 tahun dan/atau denda paling banyak Rp50 juta (UU 23/2006 Ps. 93). Memerintahkan, memfasilitasi, atau melakukan manipulasi data kependudukan diancam penjara paling lama 6 tahun dan/atau denda paling banyak Rp75 juta (UU 24/2013 Ps. 94). Jalur sah bila dokumen tidak ada adalah SPTJM.',
    pasal: 'UU 23/2006 Ps. 93; UU 24/2013 Ps. 94',
    sourceRef: [REF_UU23, REF_UU24],
  },
  {
    id: 'formulir-f102',
    teks: 'Formulir F-1.02 (pendaftaran peristiwa kependudukan) dipakai untuk KK, KTP-el, dan KIA baru serta karena perubahan data. Panduan Ditjen Dukcapil juga meminta F-1.02 untuk KTP-el atau KK yang hilang atau rusak.',
    pasal:
      'Permendagri 109/2019 Ps. 4 ayat (2) huruf b dan Ps. 5 ayat (1) huruf b; panduan Ditjen Dukcapil 2023',
    sourceRef: [REF_PMD109, REF_DUKCAPIL_2023],
  },
  {
    id: 'formulir-f103',
    teks: 'Surat keterangan pindah diajukan dengan formulir F-1.03 (pendaftaran perpindahan penduduk) dan fotokopi KK di Disdukcapil daerah asal.',
    pasal:
      'Permendagri 109/2019 Ps. 4 ayat (2) huruf c dan Ps. 5 ayat (1) huruf c; panduan Ditjen Dukcapil 2023',
    sourceRef: [REF_PMD109, REF_DUKCAPIL_2023],
  },
  {
    id: 'formulir-f201',
    teks: 'Pencatatan kelahiran, kematian, perkawinan, dan peristiwa penting lain di Indonesia memakai formulir pelaporan pencatatan sipil F-2.01.',
    pasal: 'Permendagri 109/2019 Ps. 4 ayat (2) huruf d dan Ps. 5 ayat (1) huruf d',
    sourceRef: [REF_PMD109],
  },
  {
    id: 'pindah-pemilik-rumah',
    teks: 'Bila menempati rumah bukan milik sendiri (menumpang, sewa, kontrak, kos), surat keterangan pindah juga butuh surat pernyataan bermeterai dari pemilik rumah bahwa ia tidak keberatan alamatnya dipakai.',
    pasal: 'Permendagri 108/2019 Ps. 28 ayat (1)',
    sourceRef: [REF_PMD108],
  },
  {
    id: 'kk-keluarga-baru',
    teks: 'KK baru karena menikah (membentuk keluarga baru): buku nikah/kutipan akta perkawinan; bila datang dari kab/kota lain, juga surat keterangan pindah. Perkawinan belum tercatat: SPTJM perkawinan belum tercatat (F-1.05). Isi formulir F-1.02.',
    pasal:
      'Perpres 96/2018 Ps. 11 ayat (1) huruf a dan b; Permendagri 109/2019 Ps. 4 ayat (3) huruf b dan Ps. 5 ayat (2) huruf b; panduan Ditjen Dukcapil 2023',
    sourceRef: [REF_PERPRES_TEKS, REF_PMD109, REF_DUKCAPIL_2023],
  },
  {
    id: 'kk-perubahan-data',
    teks: 'KK karena perubahan data (mis. status kawin atau tambah anggota keluarga): KK lama dan surat keterangan/bukti perubahan peristiwa (mis. buku nikah, akta kelahiran). Isi F-1.02 dan surat pernyataan perubahan elemen data F-1.06.',
    pasal:
      'Perpres 96/2018 Ps. 12; Permendagri 109/2019 Ps. 4 ayat (3) huruf c; panduan Ditjen Dukcapil 2023',
    sourceRef: [REF_PERPRES_TEKS, REF_PMD109, REF_DUKCAPIL_2023],
  },
  {
    id: 'skck-polri',
    teks: 'SKCK diterbitkan Polri (Baintelkam), bukan Disdukcapil. Pengajuan lewat fitur SKCK di aplikasi layanan digital Polri (perlu akun): isi lokasi domisili, data diri, pasfoto latar merah, keperluan, lalu pilih lokasi dan tanggal; bayar sesuai tarif resmi; SKCK dicetak dari aplikasi atau diambil di kantor polisi terdekat. Pemohon harus peserta aktif JKN (BPJS Kesehatan), kecuali WNI yang berada di luar negeri. SKCK berlaku 6 bulan untuk 1 keperluan. Perpol 6/2023 sudah dicabut.',
    pasal: 'Perpol 1/2026 Ps. 2 sampai 5, Ps. 9, Ps. 10, dan Ps. 20',
    sourceRef: [REF_PERPOL1_2026],
  },
  {
    id: 'skck-manual',
    teks: 'Bila aplikasi Polri tidak berfungsi (diumumkan resmi), SKCK diurus manual di loket SKCK kantor polisi setempat: isi formulir permohonan dan bawa KTP, KK, akta kelahiran, ijazah terakhir, pasfoto, bukti peserta aktif JKN, dan paspor berlaku minimal 6 bulan untuk keperluan ke luar negeri.',
    pasal: 'Perpol 1/2026 Ps. 12 sampai 14',
    sourceRef: [REF_PERPOL1_2026],
  },
  {
    id: 'kawin-kua',
    teks: 'Perkawinan Muslim dicatat KUA kecamatan dan Dukcapil tidak menerbitkan kutipan akta perkawinan untuknya; buktinya buku nikah. Perkawinan non-Muslim dilaporkan ke Disdukcapil paling lambat 60 hari.',
    pasal: 'UU 23/2006 Ps. 34 ayat (1), (4), dan (6)',
    sourceRef: [REF_UU23],
  },
  {
    id: 'sptjm',
    teks: 'Tanpa surat keterangan kelahiran dari dokter/bidan/penolong kelahiran: SPTJM kebenaran data kelahiran (formulir F-2.03). Tanpa buku nikah/kutipan akta perkawinan tetapi KK menunjukkan orang tua suami istri: SPTJM kebenaran sebagai pasangan suami istri (F-2.04). Keduanya diketahui 2 orang saksi. Dasarnya Perpres 96/2018 Ps. 34; Permendagri 9/2016 sudah dicabut.',
    pasal: 'Perpres 96/2018 Ps. 34',
    sourceRef: [REF_PERPRES_TEKS, REF_PMD109, REF_PMD108_STATUS],
  },
  {
    id: 'dki-pkb-pemutihan',
    teks: 'DKI Jakarta membebaskan sanksi administratif PKB dan BBNKB untuk pembayaran 2 November sampai 31 Desember 2026, otomatis tanpa permohonan.',
    pasal: 'Keputusan Kepala Bapenda DKI Jakarta No. e-0022 Tahun 2026',
    sourceRef: [
      {
        url: 'https://bapenda.jakarta.go.id/berita/jakarta-memahami-jakarta-memberi-kesempatan-pemprov-dki-jakarta-bebaskan-sanksi-administratif-pkb-dan-bbnkb-hingga-31-desember-2026',
        judul: 'Pemprov DKI Jakarta bebaskan sanksi administratif PKB dan BBNKB hingga 31 Desember 2026',
        instansi: 'Badan Pendapatan Daerah Provinsi DKI Jakarta',
      },
    ],
  },
  {
    id: 'signal-stnk',
    teks: 'Aplikasi SIGNAL hanya untuk pengesahan STNK tahunan; perpanjangan STNK 5 tahunan wajib cek fisik kendaraan di Samsat.',
    pasal: 'Panduan Korlantas Polri',
    sourceRef: [
      {
        url: 'https://korlantas.polri.go.id/2026-05-07-lewat-aplikasi-signal-bayar-pajak-kendaraan-kini-lebih-mudah/',
        judul: 'Lewat aplikasi SIGNAL, bayar pajak kendaraan kini lebih mudah',
        instansi: 'Korlantas Polri',
      },
      {
        url: 'https://korlantas.polri.go.id/2026-08-31-catat-ini-syarat-dan-cara-perpanjang-stnk-5-tahunan-di-samsat/',
        judul: 'Syarat dan cara perpanjang STNK 5 tahunan di Samsat',
        instansi: 'Korlantas Polri',
      },
    ],
  },
  {
    id: 'cikarang',
    teks: 'Kecamatan Cikarang Barat, Utara, Timur, Selatan, dan Pusat termasuk Kabupaten Bekasi (kode 3216), bukan Kota Bekasi; ibu kotanya di Cikarang Pusat.',
    pasal: 'UU 101/2024 tentang Kabupaten Bekasi',
    sourceRef: [
      {
        url: 'https://peraturan.go.id/files/uu-no-101-tahun-2024.pdf',
        judul: 'UU No. 101 Tahun 2024 tentang Kabupaten Bekasi di Provinsi Jawa Barat',
        instansi: RI,
      },
    ],
  },
];
