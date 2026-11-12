/**
 * Peta portal Disdukcapil di daerah Browser Pendamping aktif (ADR 0033, ADR 0034): untuk tiap layanan, apakah bisa
 * diajukan online di portal itu, jalur menu/rute ke formulirnya, prasyarat akun yang harus dikerjakan warga sendiri,
 * jebakan UI untuk Navigator, kolom dan berkas yang diketahui, serta aset berat yang boleh diblokir worker.
 *
 * Sumber: pemetaan baca-saja 2026-11-12 (HTML publik, bundle/aset JS, manual PDF resmi; tanpa login, tanpa kirim).
 * Data ini TEPERCAYA (registry Urusin), berbeda dengan teks halaman portal yang selalu tak tepercaya. Tidak ada
 * data pribadi di sini.
 *
 * Daerah tanpa entri = belum dipetakan: perilaku rute tetap seperti sebelumnya (tanpa petunjuk, tanpa sel offline).
 */

/** Lima layanan adminduk yang dipetakan di setiap portal. */
export type LayananPeta = 'akta_lahir' | 'kk' | 'pindah' | 'kia' | 'ktp_el';
export const LAYANAN_PETA: readonly LayananPeta[] = Object.freeze([
  'akta_lahir',
  'kk',
  'pindah',
  'kia',
  'ktp_el',
]);

/** Jenis urusan harness → layanan peta. `akta` (akta pencatatan sipil umum) dan jenis lain tidak dipetakan. */
const JENIS_KE_LAYANAN: Readonly<Record<string, LayananPeta>> = Object.freeze({
  kelahiran: 'akta_lahir',
  kk: 'kk',
  pindah: 'pindah',
  kia: 'kia',
  ktp: 'ktp_el',
});

export function layananPeta(jenis: string | null | undefined): LayananPeta | undefined {
  return jenis && Object.hasOwn(JENIS_KE_LAYANAN, jenis) ? JENIS_KE_LAYANAN[jenis] : undefined;
}

export type KolomPeta = {
  label: string;
  /** Atribut `name` di formulir asli (bila terlihat). */
  nama?: string;
  tipe: 'teks' | 'angka' | 'select' | 'tanggal' | 'file' | 'radio' | 'checkbox';
  wajib?: boolean;
};

/** Ke mana warga diarahkan bila layanan ini tidak bisa diajukan online di portal. */
export type AlternatifOffline = {
  /** kantor = datang langsung; aplikasi = aplikasi resmi lain; kanal_lain = kanal web/antrean lain. */
  jenis: 'kantor' | 'aplikasi' | 'kanal_lain';
  /** Instruksi konkret untuk warga (kalimat lengkap). */
  teks: string;
  /** Tempat utama bila `kantor` (lokasi langkah rencana). */
  lokasi?: 'kecamatan' | 'disdukcapil';
};

/**
 * Penimpa per varian layanan (id varian = `VARIAN_LAYANAN` di @urusin/registry, mis. `baru`, `hilang`, `datang`).
 * Varian yang tidak disebut warga = nilai sel.
 */
export type VarianSel = {
  online: boolean;
  namaDiPortal?: string;
  rute?: string;
  jalurMenu?: readonly string[];
  /** Jalur awal sesi untuk varian ini (mis. antrean perekaman tanpa akun). */
  jalurMasuk?: string;
  butuhLogin?: boolean;
};

export type SelPeta = {
  /** Bisa diajukan online di portal ini (untuk varian yang tidak disebut / tidak ditimpa). */
  online: boolean;
  namaDiPortal?: string;
  /** Rute formulir di portal (setelah masuk). Untuk petunjuk; AI tidak menavigasi lewat URL. */
  rute?: string;
  jalurMenu?: readonly string[];
  /** Jalur awal sesi Browser Pendamping untuk layanan ini (bawaan: `jalurMasuk` portal). */
  jalurMasuk?: string;
  butuhLogin: boolean;
  varian?: Readonly<Record<string, VarianSel>>;
  /** Wajib bila sel atau salah satu variannya offline. */
  offline?: { alasan: string; alternatif: AlternatifOffline };
  /** Jebakan khusus layanan ini (di samping jebakan portal). */
  jebakan?: readonly string[];
  field?: readonly KolomPeta[];
  berkas?: readonly string[];
  tombolAkhir?: string;
  jam?: string;
  keyakinan: 'tinggi' | 'sedang' | 'rendah';
};

/** Akun yang harus dibuat warga SENDIRI sebelum Browser Pendamping bisa dipakai. */
export type PrasyaratAkun = {
  judul: string;
  /** ponsel = hanya bisa dari ponsel warga (kamera langsung, aplikasi); bebas = peramban mana pun. */
  perangkat: 'ponsel' | 'bebas';
  langkah: readonly string[];
  /** Halaman daftar resmi (host portal). */
  url?: string;
};

/** Aset berat yang dibatalkan worker (hanya jenis gambar/fon/media). Pencocokan host persis. */
export type PolaBlokirAset = {
  host: string;
  jenis: readonly ('image' | 'font' | 'media')[];
  jalurMengandung?: string;
  akhiran?: string;
};

export type PetaPortal = {
  kode: string;
  namaPortal: string;
  host: string;
  /** Jalur awal sesi (bawaan semua layanan). */
  jalurMasuk: string;
  /** Portal menolak Chromium headless (WAF): worker wajib headed. */
  butuhHeaded?: boolean;
  login: string;
  prasyaratAkun?: PrasyaratAkun;
  jebakan: readonly string[];
  blokirAset?: readonly PolaBlokirAset[];
  layanan: Readonly<Record<LayananPeta, SelPeta>>;
  buktiTanggal: string;
  sumber: string;
};

const k = (label: string, nama: string, tipe: KolomPeta['tipe'], wajib?: boolean): KolomPeta => ({
  label,
  ...(nama ? { nama } : {}),
  tipe,
  ...(wajib ? { wajib } : {}),
});

const berkasKolom = (label: string): KolomPeta => k(label, '', 'file', true);

// --- Kota Tangerang: kolom bersama tiap formulir (fragmen /pelayanan/form, keyakinan tinggi) ---
const TNG_PEMOHON: readonly KolomPeta[] = [
  k('Nomor Induk Kependudukan', 'nik_pemohon', 'teks', true),
  k('Nama Lengkap', 'nama_pemohon', 'teks', true),
  k('Nomor Kartu Keluarga', 'nkk_pemohon', 'teks', true),
  k('Nomor Handphone - WA', 'nomor_hp_pemohon', 'teks', true),
  k('Alamat Email', 'email_pemohon', 'teks'),
];
const TNG_SELFIE: readonly KolomPeta[] = [
  k('Upload Foto Selfie (centang: unggah berkas, bukan kamera)', 'is_upload_foto_selfie', 'checkbox'),
  k('Upload Foto Selfie', 'file_foto_selfie', 'file', true),
];
const TNG_AMBIL: readonly KolomPeta[] = [
  k('Lokasi Pengambilan', 'lokasi_pengambilan', 'radio', true),
  k('Lokasi Pengambilan (Kecamatan)', 'lokasi_pengambilan_kecamatan', 'select', true),
  k('Booth Layanan', 'lokasi_pengambilan_booth_layanan', 'select', true),
];
const tngBerkas = (...label: string[]) => label.map((l) => k(l, 'file_persyaratan[]', 'file'));
const TNG_TOMBOL = 'Submit Pengajuan (2 SweetAlert: syarat & ketentuan lalu Konfirmasi; dikerjakan warga)';

const PADANG_KANTOR = 'Disdukcapil Kota Padang (Jl. Khatib Sulaiman No. 1)';

export const PETA_PORTAL: Readonly<Record<string, PetaPortal>> = Object.freeze({
  '3374': {
    kode: '3374',
    namaPortal: "Si D'nOK",
    host: 'sidnok.semarangkota.go.id',
    jalurMasuk: '/pelapor/login',
    butuhHeaded: true,
    login:
      'NIK + sandi + CAPTCHA soal matematika (dijawab warga); kirim memunculkan SweetAlert "Ya, Lanjutkan"',
    prasyaratAkun: {
      judul: "Daftar akun Si D'nOK dan lengkapi profil",
      perangkat: 'bebas',
      url: 'https://sidnok.semarangkota.go.id/pelapor/daftar',
      langkah: [
        'Buka sidnok.semarangkota.go.id/pelapor/daftar, isi NIK, nomor KK, nama lengkap, nomor HP, email, dan jawaban soal keamanan, lalu tekan Daftar Sekarang (khusus warga Kota Semarang usia 17 tahun ke atas).',
        'Tunggu kata sandi yang dikirim lewat WhatsApp atau email; sandi tidak dibuat sendiri.',
        'Masuk sekali, buka Profil lalu Edit Profil, dan lengkapi sampai tersimpan. Pengajuan baru bisa dibuat setelah profil lengkap.',
      ],
    },
    jebakan: [
      'Modal gambar pengumuman di Beranda dan /pelayanan menutupi kartu layanan: tunggu tertutup sendiri (~7 detik) atau klik "Tutup Sekarang".',
      'SweetAlert konfirmasi: tombol "Ya, Lanjutkan"/"Ya, ..." di dialog .swal2.',
      'Tanggal (Litepicker, DD-MM-YYYY): ketik digitnya saja, tanda "-" disisipkan otomatis.',
      'Select2 menyembunyikan <select> asli; Dropify membungkus kolom unggah; kolom .upper otomatis kapital.',
      'Sesi/CSRF habis (401/419) memaksa kembali ke halaman masuk: jangan biarkan formulir terbuka terlalu lama.',
      'Draf "Pengajuan Belum Dikirim" dilanjutkan dari /pengajuan → Detail → Lanjutkan sampai Kirim.',
    ],
    layanan: {
      akta_lahir: {
        online: true,
        namaDiPortal: 'AKTA KELAHIRAN',
        rute: '/pelayanan/akta-lahir',
        jalurMenu: ['Beranda', 'Pelayanan', 'AKTA KELAHIRAN'],
        butuhLogin: true,
        jebakan: [
          'Ada varian WNI dan Orang Asing; SPTJM + 2 saksi bila surat lahir atau buku nikah tidak ada.',
        ],
        berkas: [
          'Surat keterangan kelahiran (RS/puskesmas/dokter/bidan/kepala desa/lurah)',
          'Buku nikah/kutipan akta perkawinan',
          'Kartu Keluarga',
          'SPTJM kebenaran data kelahiran + 2 saksi (bila tanpa surat keterangan lahir)',
          'SPTJM pasangan suami istri + 2 saksi (bila tanpa buku nikah)',
        ],
        keyakinan: 'sedang',
      },
      kk: {
        online: true,
        namaDiPortal: 'PERUBAHAN BIODATA KARTU KELUARGA',
        rute: '/pelayanan/biodata',
        jalurMenu: ['Beranda', 'Pelayanan', 'PERUBAHAN BIODATA KARTU KELUARGA'],
        butuhLogin: true,
        jebakan: [
          'Satu menu untuk KK baru, pisah KK, ganti kepala keluarga, perubahan data, dan hilang/rusak; jenisnya dipilih di dalam formulir.',
        ],
        berkas: [
          'KK lama',
          'Buku nikah/akta perkawinan atau perceraian (KK baru)',
          'Akta kematian (ganti kepala keluarga)',
          'Surat kehilangan kepolisian atau KK rusak (hilang/rusak)',
        ],
        keyakinan: 'sedang',
      },
      pindah: {
        online: true,
        namaDiPortal: 'PERPINDAHAN KELUAR',
        rute: '/pelayanan/pindah',
        jalurMenu: ['Beranda', 'Pelayanan', 'PERPINDAHAN KELUAR'],
        butuhLogin: true,
        varian: {
          datang: {
            online: true,
            namaDiPortal: 'KEDATANGAN',
            rute: '/pelayanan/datang',
            jalurMenu: ['Beranda', 'Pelayanan', 'KEDATANGAN'],
          },
        },
        berkas: [
          'Kartu Keluarga',
          'SKPWNI + KTP-el/KIA lama (kedatangan)',
          'Surat pernyataan perubahan elemen data / alamat / tidak keberatan numpang KK (bila perlu)',
        ],
        keyakinan: 'sedang',
      },
      kia: {
        online: true,
        namaDiPortal: 'KARTU IDENTITAS ANAK',
        rute: '/pelayanan/kia',
        jalurMenu: ['Beranda', 'Pelayanan', 'KARTU IDENTITAS ANAK'],
        butuhLogin: true,
        jebakan: ['Baru, hilang, rusak, dan pindah datang ada dalam satu menu.'],
        berkas: [
          'Kutipan akta kelahiran',
          'KK orang tua/wali',
          'KTP-el kedua orang tua/wali',
          'Pas foto berwarna (anak 5-17 tahun)',
        ],
        keyakinan: 'sedang',
      },
      ktp_el: {
        online: false,
        butuhLogin: true,
        offline: {
          alasan: "Si D'nOK tidak punya menu pengajuan KTP-el.",
          alternatif: {
            jenis: 'kantor',
            lokasi: 'kecamatan',
            teks: 'KTP-el baru (perekaman pertama): datang ke TPDK (Tempat Perekaman Data Kependudukan) di kantor kecamatan domisili Anda dengan membawa KK. KTP-el rusak, hilang, atau perubahan data: datang ke loket Dispendukcapil Kota Semarang atau kecamatan dengan KK dan KTP-el lama atau surat kehilangan dari kepolisian.',
          },
        },
        keyakinan: 'sedang',
      },
    },
    buktiTanggal: '2026-11-12',
    sumber: 'HTML publik, JS publik, Data Dukung, APK Android (pemetaan baca-saja)',
  },

  '3573': {
    kode: '3573',
    namaPortal: 'SIAPEL',
    host: 'siapel.malangkota.go.id',
    jalurMasuk: '/login',
    login: 'EMAIL (bukan NIK) + sandi + CAPTCHA gambar soal penjumlahan (dijawab warga)',
    prasyaratAkun: {
      judul: 'Daftar dan aktifkan akun SIAPEL lewat email',
      perangkat: 'bebas',
      url: 'https://siapel.malangkota.go.id/register',
      langkah: [
        'Buka siapel.malangkota.go.id/register, isi nama, NIK, email, nomor HP (WhatsApp aktif), kecamatan, kelurahan, dan kata sandi, lalu tekan Daftar.',
        'Buka email Anda dan klik tautan aktivasi dari SIAPEL. Akun belum bisa dipakai masuk sebelum diaktifkan.',
        'Catat email dan sandinya: SIAPEL masuk memakai EMAIL, bukan NIK.',
      ],
    },
    jebakan: [
      'Kelurahan (#kelurahane) hanya terisi setelah Kecamatan (#kecamatane) dipilih dengan event change sungguhan; nilai opsi kelurahan = NAMA kelurahan.',
      'NIK dan nomor HP memakai input type=number: ketik apa adanya (perhatikan nol di depan nomor HP).',
      'CSRF Laravel: halaman yang terlalu lama dibuka menghasilkan 419 saat dikirim.',
      'Dialog SweetAlert "Kamu yakin ingin mengeluarkan item ini?" adalah hapus: jangan dikonfirmasi.',
    ],
    layanan: {
      akta_lahir: {
        online: true,
        namaDiPortal: 'Akta Kelahiran (Pelayanan Paket Akta Kelahiran)',
        rute: '/backoffice/masyarakat_kelahiran/create',
        jalurMasuk: '/backoffice/masyarakat_kelahiran/create',
        jalurMenu: ['Beranda', 'PELAYANAN', 'Akta Kelahiran'],
        butuhLogin: true,
        keyakinan: 'sedang',
      },
      kk: {
        online: true,
        namaDiPortal: 'Kartu Keluarga: Perubahan, Kehilangan/Kerusakan',
        rute: '/backoffice/masyarakat_kk/create',
        jalurMasuk: '/backoffice/masyarakat_kk/create',
        jalurMenu: ['Beranda', 'PELAYANAN', 'Kartu Keluarga'],
        butuhLogin: true,
        keyakinan: 'sedang',
      },
      pindah: {
        online: false,
        butuhLogin: true,
        offline: {
          alasan: 'SIAPEL tidak punya layanan pindah.',
          alternatif: {
            jenis: 'kantor',
            teks: 'Ajukan pindah keluar (SKPWNI) atau pindah datang langsung di kantor Dispendukcapil Kota Malang dengan membawa KK dan KTP-el; cek jam layanan dan kanal resminya di dispendukcapil.malangkota.go.id.',
          },
        },
        keyakinan: 'tinggi',
      },
      kia: {
        online: true,
        namaDiPortal: 'Kartu Identitas Anak: Cetak Baru/Hilang/Rusak',
        rute: '/backoffice/masyarakat_identitasanak/create',
        jalurMasuk: '/backoffice/masyarakat_identitasanak/create',
        jalurMenu: ['Beranda', 'PELAYANAN', 'Kartu Identitas Anak'],
        butuhLogin: true,
        keyakinan: 'sedang',
      },
      ktp_el: {
        online: true,
        namaDiPortal: 'KTP Elektronik: Perekaman Biometrik, Cetak KTP-el Hilang/Rusak',
        rute: '/backoffice/masyarakat_ktp/create',
        jalurMasuk: '/backoffice/masyarakat_ktp/create',
        jalurMenu: ['Beranda', 'PELAYANAN', 'KTP Elektronik'],
        butuhLogin: true,
        jebakan: [
          'Penduduk rentan/disabilitas memakai kartu D-CARDs (/backoffice/masyarakat_pendudukrentan/create).',
        ],
        keyakinan: 'sedang',
      },
    },
    buktiTanggal: '2026-11-12',
    sumber: 'HTML publik beranda, redirect /backoffice → /login, /cek_permohonan (pemetaan baca-saja)',
  },

  '1371': {
    kode: '1371',
    namaPortal: 'SIRANCAK',
    host: 'sirancak.disdukcapil.padang.go.id',
    jalurMasuk: '/masuk',
    login: 'NIK 16 digit + sandi, tanpa CAPTCHA',
    prasyaratAkun: {
      judul: 'Daftar akun SIRANCAK sendiri lewat ponsel Anda (perlu verifikasi admin)',
      perangkat: 'ponsel',
      url: 'https://sirancak.disdukcapil.padang.go.id/daftar',
      langkah: [
        'Di ponsel, buka sirancak.disdukcapil.padang.go.id/daftar. Isi NIK, nomor KK, nama lengkap, email @gmail.com (wajib Gmail), nomor HP/WhatsApp, dan kata sandi (huruf besar, angka, dan simbol).',
        'Tekan "Verifikasi lewat WhatsApp": kirim pesan "OTP" dari nomor Anda ke bot WhatsApp yang terbuka, lalu ketik kode 4 digit balasannya.',
        'Unggah foto KK dan foto KTP asli, lalu ambil swafoto memegang KTP langsung dengan kamera ponsel (tidak bisa unggah berkas).',
        'Tunggu akun diverifikasi admin (kabar lewat WhatsApp, bisa beberapa hari kerja). Setelah aktif, kembali ke Urusin untuk mengajukan.',
      ],
    },
    jebakan: [
      'Setelah masuk, portal tidak kembali ke layanan tujuan: buka Layanan → kategori → layanan → "Ajukan Sekarang" sendiri.',
      'Formulir berisi slot unggah per dokumen persyaratan, diakhiri tombol "Simpan".',
      'Tombol "Ajukan Sekarang" abu-abu di luar jam layanan formulir itu.',
      'Kolom NIK/KK membuang karakter non-angka dan memotong ke 16 digit.',
      'Tombol "Cari layanan… Ctrl+K" di header bukan tombol kirim formulir.',
      'Sesi diam terlalu lama dikeluarkan ke /masuk?reason=idle.',
    ],
    layanan: {
      akta_lahir: {
        online: true,
        namaDiPortal: 'Pencatatan Kelahiran WNI dalam wilayah NKRI',
        rute: '/layanan/0005',
        jalurMenu: ['Layanan', 'KELAHIRAN', 'Pencatatan Kelahiran WNI dalam wilayah NKRI', 'Ajukan Sekarang'],
        butuhLogin: true,
        field: [
          berkasKolom('KARTU KELUARGA'),
          berkasKolom('BUKU NIKAH HALAMAN 1 ATAU AKTA PERKAWINAN'),
          berkasKolom('BUKU NIKAH HALAMAN 2'),
          berkasKolom('BUKU NIKAH HALAMAN 3'),
          berkasKolom('SURAT TANDA LAHIR DARI BIDAN/RUMAH SAKIT'),
          berkasKolom('KTPEL ORANG TUA'),
          berkasKolom('FORMULIR F-2.01'),
        ],
        berkas: [
          'KK',
          'Buku nikah hal. 1-3 atau akta perkawinan',
          'Surat lahir RS/bidan',
          'KTP-el orang tua',
          'F-2.01',
        ],
        tombolAkhir: 'Simpan',
        keyakinan: 'sedang',
      },
      kk: {
        online: true,
        namaDiPortal: 'KARTU KELUARGA: perubahan data',
        rute: '/layanan/0003',
        jalurMenu: ['Layanan', 'KARTU KELUARGA', '(pilih varian)', 'Ajukan Sekarang'],
        butuhLogin: true,
        varian: {
          hilang: { online: true, namaDiPortal: 'KK hilang/rusak', rute: '/layanan/0004' },
          rusak: { online: true, namaDiPortal: 'KK hilang/rusak', rute: '/layanan/0004' },
          baru: { online: true, namaDiPortal: 'KK keluarga baru', rute: '/layanan/0044' },
        },
        jebakan: [
          'Varian KK: 0003 perubahan data, 0004 hilang/rusak, 0044 keluarga baru, 0001 ganti kepala keluarga (meninggal), 0002 pisah KK satu alamat.',
        ],
        field: [berkasKolom('FORMULIR F-1.02'), berkasKolom('DOKUMEN PENDUKUNG PERUBAHAN DATA 1')],
        tombolAkhir: 'Simpan',
        keyakinan: 'sedang',
      },
      pindah: {
        online: true,
        namaDiPortal: 'Pindah keluar antarkota/kabupaten/provinsi (SKPWNI)',
        rute: '/layanan/0019',
        jalurMenu: ['Layanan', 'PINDAH UNTUK WNI DALAM WILAYAH NKRI', '(pilih varian)', 'Ajukan Sekarang'],
        butuhLogin: true,
        varian: {
          datang: {
            online: true,
            namaDiPortal: 'Pindah datang',
            rute: '/layanan/0020',
            jalurMenu: ['Layanan', 'DATANG UNTUK WNI DALAM WILAYAH NKRI', 'Ajukan Sekarang'],
          },
        },
        jebakan: ['Pindah di dalam Kota Padang memakai /layanan/0018.'],
        field: [berkasKolom('KARTU KELUARGA TERBARU'), berkasKolom('FORMULIR F-1.03')],
        tombolAkhir: 'Simpan',
        keyakinan: 'sedang',
      },
      kia: {
        online: true,
        namaDiPortal: 'Penerbitan KIA Khusus Pemula / yang belum pernah memiliki',
        rute: '/layanan/0037',
        jalurMenu: [
          'Layanan',
          'KARTU IDENTITAS ANAK (WNI)',
          'Penerbitan KIA Khusus Pemula',
          'Ajukan Sekarang',
        ],
        butuhLogin: true,
        varian: {
          hilang: { online: false },
          rusak: { online: false },
          'perubahan-data': { online: false },
        },
        offline: {
          alasan: 'SIRANCAK hanya melayani KIA pemula (anak yang belum pernah punya KIA).',
          alternatif: {
            jenis: 'kantor',
            teks: `KIA hilang, rusak, atau perubahan data: datang ke ${PADANG_KANTOR} dengan membawa KK dan akta kelahiran anak.`,
          },
        },
        field: [
          berkasKolom('AKTA KELAHIRAN'),
          berkasKolom('FORMULIR F-1.02'),
          berkasKolom('KARTU KELUARGA TERBARU'),
          berkasKolom('KTP AYAH / WALI'),
          berkasKolom('KTP IBU / WALI'),
          berkasKolom('PAS FOTO 2 X 3'),
        ],
        tombolAkhir: 'Simpan',
        keyakinan: 'sedang',
      },
      ktp_el: {
        online: false,
        butuhLogin: true,
        varian: {
          hilang: {
            online: true,
            namaDiPortal: 'KTP Hilang',
            rute: '/layanan/0045',
            jalurMenu: ['Layanan', 'KTP-ELEKTRONIK', 'KTP Hilang', 'Ajukan Sekarang'],
          },
        },
        offline: {
          alasan:
            'Di SIRANCAK hanya KTP-el hilang yang bisa diajukan online (08.00-15.29 WIB); KTP-el baru, rusak, atau perubahan data tidak tersedia online.',
          alternatif: {
            jenis: 'kantor',
            teks: `KTP-el baru (perekaman), rusak, atau perubahan data: datang ke ${PADANG_KANTOR} atau loket kecamatan dengan membawa KK, dan KTP-el lama bila rusak.`,
          },
        },
        field: [
          berkasKolom('FORMULIR F-1.02'),
          berkasKolom('KARTU KELUARGA TERBARU'),
          berkasKolom('SURAT HILANG DARI KEPOLISIAN'),
        ],
        tombolAkhir: 'Simpan',
        jam: '08.00-15.29 WIB',
        keyakinan: 'sedang',
      },
    },
    buktiTanggal: '2026-11-12',
    sumber: 'Payload RSC /informasi-layanan, petunjuk PDF resmi per layanan (pemetaan baca-saja)',
  },

  '1871': {
    kode: '1871',
    namaPortal: 'Permen Manis 2.0',
    host: 'disdukcapil.bandarlampungkota.go.id',
    jalurMasuk: '/pelayanan/auth',
    login: 'email + sandi; terkunci 15 menit setelah 5 kali gagal (jangan dicoba ulang otomatis)',
    prasyaratAkun: {
      judul: 'Daftar akun Permen Manis 2.0 dengan email',
      perangkat: 'bebas',
      url: 'https://disdukcapil.bandarlampungkota.go.id/pelayanan/auth/register_akun',
      langkah: [
        'Buka disdukcapil.bandarlampungkota.go.id/pelayanan/auth/register_akun, isi nama lengkap, email, nomor WhatsApp, dan kata sandi (8-20 karakter: huruf besar, huruf kecil, angka, simbol).',
        'Tekan "Kirim OTP melalui Email", ketik kode 6 digit dari email Anda, lalu tekan Daftar.',
        'Setelah muncul "Register akun berhasil", akun langsung bisa dipakai masuk (tanpa verifikasi admin).',
      ],
    },
    jebakan: [
      'JANGAN pakai COKELAT (/pendaftaran): formulirnya tidak bisa dikirim warga ("Hanya petugas yang dapat membuat antrian!").',
      'Kode Keamanan berupa soal penjumlahan ("16 + 17 =") ada di setiap formulir dan berganti tiap muat halaman: dijawab warga.',
      'Tampilan bergaya aplikasi: tab bawah Home/Permohonan/Notifikasi/Profil; sub-layanan berupa kartu dengan ">".',
      'Label sub-layanan mirip satu sama lain (akta umum vs terlambat, KIA per usia): pilih berdasarkan umur atau tanggal.',
      'Kecamatan → Kelurahan bertingkat; datepicker dd-mm-yyyy (Sabtu/Minggu dan hari ini nonaktif).',
      'SweetAlert2 dan confirm() bawaan peramban muncul saat kirim; setelah terkirim warga menekan "Download Bukti Permohonan".',
    ],
    layanan: {
      akta_lahir: {
        online: true,
        namaDiPortal: 'Akta Kelahiran Umum (1 hari s/d 60 hari) / Akta Kelahiran Terlambat (di atas 60 hari)',
        rute: '/pelayanan',
        jalurMenu: ['Home', 'Akta Kelahiran', 'Akta Kelahiran Umum (1 hari s/d 60 hari)'],
        butuhLogin: true,
        jebakan: [
          'Bayi baru lahir: "Baru Melahirkan" > "Penerbitan Dokumen 3 in 1 karena anak baru lahir" sekaligus KK + akta + KIA.',
        ],
        berkas: [
          'Formulir F-2.01',
          'KK',
          'KTP-el orang tua',
          'Buku nikah/akta perkawinan/SPTJM suami istri',
          'Surat keterangan lahir atau SPTJM kelahiran',
        ],
        tombolAkhir: 'Ajukan Permohonan',
        keyakinan: 'sedang',
      },
      kk: {
        online: true,
        namaDiPortal:
          'Kartu Keluarga: Perubahan Data / karena hilang-rusak / Baru karena Pindah Alamat / KK QRCode / Pemecahan-Penggabungan',
        rute: '/pelayanan',
        jalurMenu: ['Home', 'Kartu Keluarga', '(pilih sub-layanan)'],
        butuhLogin: true,
        berkas: ['KK asli', 'Buku nikah', 'KTP-el orang tua', 'Formulir F-1.01/F-1.06 sesuai peruntukan'],
        tombolAkhir: 'Ajukan Permohonan',
        keyakinan: 'sedang',
      },
      pindah: {
        online: true,
        namaDiPortal: 'Perpindahan Penduduk WNI Keluar Kota Bandar Lampung',
        rute: '/pelayanan',
        jalurMenu: ['Home', 'Pindah', 'Perpindahan Penduduk WNI Keluar Kota Bandar Lampung'],
        butuhLogin: true,
        varian: {
          datang: {
            online: true,
            namaDiPortal: 'Kedatangan Penduduk WNI dari luar Bandar Lampung',
            jalurMenu: ['Home', 'Pindah', 'Kedatangan Penduduk WNI dari luar Bandar Lampung'],
          },
        },
        berkas: ['KK asli', 'KTP-el/KIA asli', 'Formulir F-1.03'],
        tombolAkhir: 'Ajukan Permohonan',
        keyakinan: 'sedang',
      },
      kia: {
        online: true,
        namaDiPortal:
          'Kartu Identitas Anak (1 hr s.d. 5 th) / (>5 th s.d. 17 th) / Perubahan-Hilang-Rusak-Pindah',
        rute: '/pelayanan',
        jalurMenu: ['Home', 'Kartu Identitas Anak', '(sesuai usia anak)'],
        butuhLogin: true,
        berkas: ['KK', 'Akta kelahiran', 'Pas foto (anak 5 tahun ke atas)'],
        tombolAkhir: 'Ajukan Permohonan',
        keyakinan: 'sedang',
      },
      ktp_el: {
        online: true,
        namaDiPortal: 'KTP Elektronik Rusak/Hilang',
        rute: '/pelayanan',
        jalurMenu: ['Home', 'KTP-El', 'KTP Elektronik Rusak/Hilang'],
        butuhLogin: true,
        varian: {
          'perubahan-data': {
            online: true,
            namaDiPortal: 'KTP-el Perubahan Data',
            jalurMenu: ['Home', 'KTP-El', 'KTP-el Perubahan Data'],
          },
          baru: {
            online: true,
            namaDiPortal: 'Antrean perekaman KTP-el (tanpa akun), tombol "Daftar Antrian"',
            rute: '/perekaman',
            jalurMenu: ['Perekaman', 'Daftar Antrian'],
            jalurMasuk: '/perekaman',
            butuhLogin: false,
          },
        },
        jebakan: [
          'Hanya untuk domisili Kota Bandar Lampung dan tidak untuk ganti foto; pengambilan wajib menunjukkan IKD.',
        ],
        field: [
          k('Nama Lengkap Pemohon sesuai KTP', '', 'teks', true),
          k('Nomor NIK', '', 'teks', true),
          k('Nomor KK', '', 'teks', true),
          k('Kecamatan', '', 'select', true),
          k('Kelurahan', '', 'select', true),
          k('Tanggal Antrian', '', 'tanggal'),
          k('Kode Keamanan (dijawab warga)', '', 'teks', true),
        ],
        tombolAkhir: 'Ajukan Permohonan',
        keyakinan: 'sedang',
      },
    },
    buktiTanggal: '2026-11-12',
    sumber: 'HTML publik dan manual resmi PDF Permen Manis 2026 (pemetaan baca-saja)',
  },

  '3276': {
    kode: '3276',
    namaPortal: 'Silondo Maju',
    host: 'silondomaju.depok.go.id',
    jalurMasuk: '/',
    login: 'email + sandi; modal Turnstile lalu puzzle geser diselesaikan warga',
    prasyaratAkun: {
      judul: 'Daftar akun Silondo Maju',
      perangkat: 'bebas',
      url: 'https://silondomaju.depok.go.id/register',
      langkah: [
        'Buka silondomaju.depok.go.id/register, isi NIK, nama lengkap sesuai KTP, email, dan kata sandi (minimal 8 karakter: huruf besar, huruf kecil, angka).',
        'Tekan Daftar, lalu selesaikan verifikasinya sendiri (kotak Cloudflare bila muncul, lalu geser puzzle ke kanan).',
        'Catat email dan sandinya untuk masuk saat Browser Pendamping dibuka.',
      ],
    },
    jebakan: [
      'Tautan langsung /public/layanan/* = 404: mulai dari beranda, gulir ke "Layanan Unggulan" (#layanan), klik kartu kategori lalu kartu layanan ("Pilih Layanan").',
      'Overlay page-loader menutupi layar saat berpindah halaman: tunggu hilang. Kartu layanan baru tampil setelah digulir.',
      'Halaman layanan memunculkan modal "Akses Dibatasi" bila belum masuk: masuk dulu, lalu kembali ke layanan.',
      'Formulir ada di tab "Pendaftaran", bukan tab bawaan "Persyaratan".',
      'Turnstile + puzzle geser sebelum masuk, lacak, dan kirim: dikerjakan warga.',
      'Select domisili asal bertingkat (provinsi → kab/kota → kecamatan → kelurahan) dimuat AJAX satu per satu; select2 menyembunyikan <select> asli.',
      'Pertanyaan dinamis (mis. Jenis Kelahiran: 1 = tunggal, 2+ = kembar) menggandakan blok unggahan.',
      '"Unduh Template" adalah form POST, bukan tautan: jangan diklik.',
    ],
    blokirAset: [
      { host: 'cms.depok.go.id', jenis: ['image', 'font', 'media'] },
      {
        host: 'silondomaju.depok.go.id',
        jenis: ['image'],
        jalurMengandung: '/icon-submission/',
        akhiran: '.svg',
      },
      { host: 'silondomaju.depok.go.id', jenis: ['image', 'media'], akhiran: '/404-animasi.gif' },
    ],
    layanan: {
      akta_lahir: {
        online: true,
        namaDiPortal: 'Akta Kelahiran Usia 0 Tahun',
        jalurMenu: [
          'Beranda',
          'Layanan Unggulan',
          'Akta Kelahiran',
          'Akta Kelahiran Usia 0 Tahun',
          'tab Pendaftaran',
        ],
        butuhLogin: true,
        jebakan: ['Anak usia 1-18 tahun, di atas 18 tahun, dan orang asing punya kartu layanan sendiri.'],
        field: [k('Jenis Kelahiran (tunggal 1; kembar 2, 3, 4 dst)', '', 'teks', true)],
        berkas: [
          'Formulir F-2.01 A',
          'Kartu Keluarga',
          'Surat keterangan lahir atau F-2.03 SPTJM kelahiran',
          'Buku nikah/akta perkawinan atau F-2.04 SPTJM suami istri',
        ],
        keyakinan: 'sedang',
      },
      kk: {
        online: true,
        namaDiPortal: 'Penerbitan Kartu Keluarga (perubahan elemen data)',
        jalurMenu: [
          'Beranda',
          'Layanan Unggulan',
          'Kartu Keluarga',
          'Penerbitan Kartu Keluarga (perubahan elemen data)',
        ],
        butuhLogin: true,
        varian: {
          baru: {
            online: true,
            namaDiPortal: 'KK Baru membentuk Keluarga Baru (Perkawinan/Cerai Hidup) atau Pisah KK',
          },
        },
        keyakinan: 'rendah',
      },
      pindah: {
        online: true,
        namaDiPortal: 'Pindah Keluar (SKPWNI) Antar Kab/Kota/Prov',
        jalurMenu: [
          'Beranda',
          'Layanan Unggulan',
          'Perpindahan & Kedatangan',
          'Pindah Keluar (SKPWNI) Antar Kab/Kota/Prov',
        ],
        butuhLogin: true,
        varian: {
          datang: { online: true, namaDiPortal: 'Pindah Datang (SKDWNI) Antar Kab/Kota/Prov' },
        },
        jebakan: ['Pindah antar kecamatan dan antar kelurahan punya kartu sendiri.'],
        keyakinan: 'rendah',
      },
      kia: {
        online: true,
        namaDiPortal: 'Penerbitan Kartu Identitas Anak (KIA) Baru',
        jalurMenu: ['Beranda', 'Layanan Unggulan', 'Kartu Identitas Anak (KIA)', 'Penerbitan KIA Baru'],
        butuhLogin: true,
        varian: {
          hilang: { online: true, namaDiPortal: 'KIA karena Hilang atau Rusak' },
          rusak: { online: true, namaDiPortal: 'KIA karena Hilang atau Rusak' },
        },
        keyakinan: 'rendah',
      },
      ktp_el: {
        online: true,
        namaDiPortal: 'Penerbitan KTPel Baru',
        jalurMenu: ['Beranda', 'Layanan Unggulan', 'Kartu Tanda Penduduk (KTP)', 'Penerbitan KTPel Baru'],
        butuhLogin: true,
        varian: {
          hilang: { online: true, namaDiPortal: 'Penerbitan KTPel karena hilang' },
          rusak: { online: true, namaDiPortal: 'Penerbitan KTPel karena rusak' },
        },
        keyakinan: 'rendah',
      },
    },
    buktiTanggal: '2026-11-12',
    sumber: 'HTML publik beranda dan halaman layanan, skrip halaman (pemetaan baca-saja)',
  },

  '3671': {
    kode: '3671',
    namaPortal: 'Sobat Dukcapil',
    host: 'sobatdukcapil.tangerangkota.go.id',
    jalurMasuk: '/',
    login:
      'akun Tangerang LIVE (NIK/email + sandi), tanpa CAPTCHA/OTP; /login selalu dialihkan ke URL bertanda tangan',
    prasyaratAkun: {
      judul: 'Buat akun Tangerang LIVE lewat aplikasinya di ponsel Anda',
      perangkat: 'ponsel',
      langkah: [
        'Pasang aplikasi Tangerang LIVE dari Play Store atau App Store di ponsel Anda.',
        'Daftar akun di aplikasi itu dengan data Anda sendiri sampai akun aktif (pendaftaran lewat situs tlive menolak peramban otomatis).',
        'Catat NIK/email dan sandinya: akun yang sama dipakai untuk masuk ke Sobat Dukcapil.',
      ],
    },
    jebakan: [
      'Modal pengumuman "versi lama/baru" di beranda: tutup dengan tombol .close-btn.',
      'Alur: pilih Kependudukan/Pencatatan Sipil → pilih pelayanan → Cari → pilih "Apa Jenis Pengajuan Anda?" → Daftar Pengajuan → masuk → formulir tampil di #form-content.',
      'nice-select menyembunyikan <select> asli: klik div.nice-select lalu opsinya.',
      'Kategori dan formulir dimuat AJAX: tunggu #form-content terisi.',
      'Select wilayah bertingkat (provinsi → kab → kec → kel) dimuat AJAX: isi berurutan, tunggu tiap tingkat.',
      'Kolom bersyarat: kecamatan/booth sesuai radio lokasi pengambilan; blok perubahan hanya bila "Ada"; isian *_lainnya bila "Lainnya".',
      'Blok berulang (anak/keluarga/KTP) dibangun JS; tombol "Tambah ..." maksimal 10.',
      'Kolom angka menolak karakter non-digit (berat bayi tanpa desimal).',
      'Foto selfie: centang "Upload Foto Selfie" lalu unggah berkas foto (kamera tidak tersedia di peramban ini).',
      'Tanda tangan digital (canvas) WAJIB digambar warga sendiri; AI tidak boleh membuatnya.',
      'Submit memunculkan 2 SweetAlert berurutan (syarat & ketentuan dengan centang, lalu Konfirmasi): dikerjakan warga.',
      'Smooth-scroll Lenis/GSAP bisa membuat gulir meleset: tunggu animasinya.',
    ],
    layanan: {
      akta_lahir: {
        online: true,
        namaDiPortal: 'Akta Kelahiran: Kurang dari 1 Tahun Belum Memiliki NIK',
        rute: '/pelayanan?id_jenis_pelayanan=2&id_pelayanan=6',
        jalurMenu: [
          'Beranda',
          'Pencatatan Sipil',
          'Akta Kelahiran',
          'Cari',
          'Kurang dari 1 Tahun Belum Memiliki NIK',
          'Daftar Pengajuan',
        ],
        butuhLogin: true,
        jebakan: ['Anak yang sudah punya NIK memakai jenis pengajuan "Sudah Memiliki NIK".'],
        field: [
          ...TNG_PEMOHON,
          k('Nama Lengkap (saksi)', 'nama_saksi', 'teks', true),
          k('Nomor Induk Kependudukan (saksi)', 'nik_saksi', 'teks', true),
          k('Nama Ayah', 'nama_ayah', 'teks', true),
          k('NIK Ayah (Jika Ada)', 'nik_ayah', 'teks'),
          k('Nama Ibu', 'nama_ibu', 'teks', true),
          k('NIK Ibu (Jika Ada)', 'nik_ibu', 'teks'),
          k('Buku Nikah Orang Tua', 'is_buku_nikah_ortu', 'radio', true),
          k('Nama Lengkap (anak)', 'nama_lahir[]', 'teks', true),
          k('Jenis Kelamin', 'jenis_kelamin_lahir[]', 'radio', true),
          k('Tempat Dilahirkan', 'tempat_dilahirkan_lahir[]', 'radio', true),
          k('Tempat Kelahiran', 'tempat_kelahiran_lahir[]', 'teks', true),
          k('Tanggal Kelahiran', 'tanggal_kelahiran_lahir[]', 'tanggal', true),
          k('Pukul Kelahiran', 'pukul_kelahiran_lahir[]', 'teks'),
          k('Jenis Kelahiran', 'jenis_kelahiran_lahir[]', 'radio', true),
          k('Kelahiran ke', 'kelahiran_ke_lahir[]', 'teks', true),
          k('Penolong Kelahiran', 'penolong_kelahiran_lahir[]', 'radio', true),
          k('Berat Bayi (Kg)', 'berat_bayi_lahir[]', 'teks'),
          k('Panjang Bayi (Cm)', 'panjang_bayi_lahir[]', 'teks'),
          ...tngBerkas(
            'f-201 Akta kelahiran',
            'KTP-el Orang Tua',
            'Kartu Keluarga',
            'Surat Keterangan Kelahiran dari Rumah Sakit / Klinik / Bidan / Puskesmas',
            'Buku Nikah / Akta Perkawinan (halaman 1)',
            'KTP-el saksi',
            'f1-02 (Form Update Kartu Keluarga)',
            'Buku Nikah (halaman 2)',
            'Buku Nikah (halaman 3)',
          ),
          ...TNG_SELFIE,
        ],
        tombolAkhir: TNG_TOMBOL,
        keyakinan: 'tinggi',
      },
      kk: {
        online: true,
        namaDiPortal: 'Kartu Keluarga: Pembaharuan Data',
        rute: '/pelayanan?id_jenis_pelayanan=1&id_pelayanan=3',
        jalurMenu: [
          'Beranda',
          'Kependudukan',
          'Kartu Keluarga',
          'Cari',
          'Pembaharuan Data',
          'Daftar Pengajuan',
        ],
        butuhLogin: true,
        varian: {
          baru: { online: true, namaDiPortal: 'Kartu Keluarga: Membentuk Keluarga Baru' },
          hilang: { online: true, namaDiPortal: 'Kartu Keluarga: Rusak/Hilang' },
          rusak: { online: true, namaDiPortal: 'Kartu Keluarga: Rusak/Hilang' },
        },
        field: [
          ...TNG_PEMOHON,
          k('Perubahan Data (Ada/Tidak)', 'is_perubahan_data', 'radio', true),
          ...TNG_AMBIL,
          k('Nama Lengkap (anggota yang berubah)', 'perubahan_nama[]', 'teks', true),
          k('Nomor Induk Kependudukan (anggota yang berubah)', 'perubahan_nik[]', 'teks', true),
          k(
            'Pendidikan Terakhir / Pekerjaan / Agama / Golongan Darah / Lainnya (centang lalu semula → menjadi)',
            '',
            'checkbox',
          ),
          ...tngBerkas(
            'Kartu Keluarga',
            'KTP-el',
            'F-1.06 (Formulir Perubahan Data)',
            'Surat Kuasa (Jika Dikuasakan)',
            'f1-02 (Formulir Pendaftaran Penduduk)',
          ),
          ...TNG_SELFIE,
        ],
        tombolAkhir: TNG_TOMBOL,
        keyakinan: 'tinggi',
      },
      pindah: {
        online: true,
        namaDiPortal: 'Pindah Datang: Pindah Keluar Kota',
        rute: '/pelayanan?id_jenis_pelayanan=1&id_pelayanan=4',
        jalurMenu: [
          'Beranda',
          'Kependudukan',
          'Pindah Datang',
          'Cari',
          'Pindah Keluar Kota',
          'Daftar Pengajuan',
        ],
        butuhLogin: true,
        varian: {
          datang: { online: true, namaDiPortal: 'Pindah Datang: Datang Ke Kota' },
        },
        jebakan: ['Pindah antar kelurahan/kecamatan di dalam kota punya jenis pengajuan sendiri.'],
        field: [
          ...TNG_PEMOHON,
          k('Alamat Asal', 'alamat_asal', 'teks', true),
          k('RT Asal', 'rt_asal', 'teks', true),
          k('RW Asal', 'rw_asal', 'teks', true),
          k('Propinsi / Kabupaten/Kota / Kecamatan / Kelurahan Asal', 'propinsi_asal', 'select', true),
          k('Kode Pos Asal', 'kode_pos_asal', 'teks'),
          k('Alamat Tujuan', 'alamat_tujuan', 'teks', true),
          k('RT Tujuan', 'rt_tujuan', 'teks', true),
          k('RW Tujuan', 'rw_tujuan', 'teks', true),
          k('Propinsi / Kabupaten/Kota / Kecamatan / Kelurahan Tujuan', 'propinsi_tujuan', 'select', true),
          k('Kode Pos Tujuan', 'kode_pos_tujuan', 'teks'),
          k('Alasan Pindah', 'alasan_pindah', 'radio', true),
          k('Jenis Kepindahan', 'jenis_kepindahan', 'radio', true),
          k('Nomor Induk Kependudukan (anggota yang ikut pindah)', 'keluarga_pindah_nik[]', 'teks', true),
          k('Nama Lengkap (anggota yang ikut pindah)', 'keluarga_pindah_nama[]', 'teks', true),
          ...tngBerkas(
            'Kartu Keluarga',
            'KTP-el Orang Tua/Kepala Keluarga',
            'Surat Kuasa (Jika Dikuasakan)',
            'F-1.03 (Formulir Perpindahan Penduduk)',
            'Surat Pernyataan',
          ),
          ...TNG_SELFIE,
        ],
        tombolAkhir: TNG_TOMBOL,
        keyakinan: 'tinggi',
      },
      kia: {
        online: true,
        namaDiPortal: 'Kartu Identitas Anak (KIA): Pembuatan Baru',
        rute: '/pelayanan?id_jenis_pelayanan=1&id_pelayanan=1',
        jalurMenu: [
          'Beranda',
          'Kependudukan',
          'Kartu Identitas Anak (KIA)',
          'Cari',
          'Pembuatan Baru',
          'Daftar Pengajuan',
        ],
        butuhLogin: true,
        varian: {
          hilang: { online: true, namaDiPortal: 'KIA: Rusak/Hilang' },
          rusak: { online: true, namaDiPortal: 'KIA: Rusak/Hilang' },
          'perubahan-data': { online: true, namaDiPortal: 'KIA: Pembaharuan Data' },
        },
        field: [
          ...TNG_PEMOHON,
          ...TNG_AMBIL,
          k('Nama Lengkap Anak', 'nama_anak_kia[]', 'teks', true),
          k('Nomor Induk Kependudukan (anak)', 'nik_anak_kia[]', 'teks', true),
          k('Nomor Akta Kelahiran', 'nak_anak_kia[]', 'teks', true),
          ...tngBerkas(
            'Kartu Keluarga',
            'KTP-el Orang Tua/Kepala Keluarga',
            'Akta Lahir',
            'Surat Kuasa (Jika Dikuasakan)',
            'f1-02 (Formulir Pendaftaran Penduduk)',
            'Foto Anak',
          ),
          ...TNG_SELFIE,
        ],
        tombolAkhir: TNG_TOMBOL,
        keyakinan: 'tinggi',
      },
      ktp_el: {
        online: true,
        namaDiPortal: 'Kartu Tanda Penduduk (KTP-EL): Rusak/Hilang',
        rute: '/pelayanan?id_jenis_pelayanan=1&id_pelayanan=2',
        jalurMenu: [
          'Beranda',
          'Kependudukan',
          'Kartu Tanda Penduduk (KTP-EL)',
          'Cari',
          'Rusak/Hilang',
          'Daftar Pengajuan',
        ],
        butuhLogin: true,
        varian: {
          baru: { online: false },
          'perubahan-data': { online: true, namaDiPortal: 'Kartu Tanda Penduduk (KTP-EL): Pembaharuan Data' },
        },
        offline: {
          alasan:
            'Sobat Dukcapil tidak melayani KTP-el baru; yang online hanya KTP-el rusak/hilang dan pembaharuan data.',
          alternatif: {
            jenis: 'kantor',
            teks: 'KTP-el baru (perekaman pertama): datang ke Disdukcapil Kota Tangerang atau kantor kecamatan untuk perekaman (foto, sidik jari, iris mata) dengan membawa KK.',
          },
        },
        field: [
          ...TNG_PEMOHON,
          ...TNG_AMBIL,
          k('Nama Lengkap (KTP)', 'nama_ktp[]', 'teks', true),
          k('Nomor Induk Kependudukan (KTP)', 'nik_ktp[]', 'teks', true),
          k('Nomor Kartu Keluarga (KTP)', 'nkk_ktp[]', 'teks', true),
          ...tngBerkas(
            'KTP-el (Jika Rusak (Lama)/Hilang)',
            'Surat Kehilangan Kepolisian (Jika Hilang)',
            'Surat Kuasa (Jika Dikuasakan)',
            'f1-02 (Formulir Pendaftaran Penduduk)',
            'Kartu Keluarga',
          ),
          ...TNG_SELFIE,
        ],
        tombolAkhir: TNG_TOMBOL,
        keyakinan: 'tinggi',
      },
    },
    buktiTanggal: '2026-11-12',
    sumber: 'Fragmen formulir publik GET /pelayanan/form (HTML asli), beranda (pemetaan baca-saja)',
  },
} satisfies Record<string, PetaPortal>);

export function petaPortal(kode: string | null | undefined): PetaPortal | undefined {
  return kode && Object.hasOwn(PETA_PORTAL, kode) ? PETA_PORTAL[kode] : undefined;
}

/** Keputusan satu sel (wilayah × layanan × varian) setelah penimpa varian diterapkan. */
export type Ketersediaan =
  | { dipetakan: false }
  | {
      dipetakan: true;
      online: true;
      peta: PetaPortal;
      layanan: LayananPeta;
      sel: SelPeta;
      varian?: string;
      namaDiPortal?: string;
      rute?: string;
      jalurMenu?: readonly string[];
      jalurMasuk: string;
      butuhLogin: boolean;
      /** Akun yang harus dibuat warga sendiri sebelum Pendamping (hanya bila layanan ini butuh masuk). */
      prasyarat?: PrasyaratAkun;
    }
  | {
      dipetakan: true;
      online: false;
      peta: PetaPortal;
      layanan: LayananPeta;
      sel: SelPeta;
      varian?: string;
      alasan: string;
      alternatif: AlternatifOffline;
    };

/** Sel peta untuk wilayah `kode` × jenis urusan `jenis` (mis. `ktp`), dengan varian yang disebut warga bila ada. */
export function ketersediaanLayanan(
  kode: string | null | undefined,
  jenis: string | null | undefined,
  varian?: string | null,
): Ketersediaan {
  const peta = petaPortal(kode);
  const layanan = layananPeta(jenis);
  if (!peta || !layanan) return { dipetakan: false };
  const sel = peta.layanan[layanan];
  const v = varian && sel.varian && Object.hasOwn(sel.varian, varian) ? sel.varian[varian] : undefined;
  const online = v ? v.online : sel.online;
  const vid = v ? { varian: varian! } : {};
  if (!online) {
    // Data dijaga tes: setiap sel/varian offline punya alasan + alternatif.
    const off = sel.offline!;
    return {
      dipetakan: true,
      online: false,
      peta,
      layanan,
      sel,
      ...vid,
      alasan: off.alasan,
      alternatif: off.alternatif,
    };
  }
  const butuhLogin = v?.butuhLogin ?? sel.butuhLogin;
  const namaDiPortal = v?.namaDiPortal ?? sel.namaDiPortal;
  const rute = v?.rute ?? sel.rute;
  const jalurMenu = v?.jalurMenu ?? sel.jalurMenu;
  return {
    dipetakan: true,
    online: true,
    peta,
    layanan,
    sel,
    ...vid,
    ...(namaDiPortal ? { namaDiPortal } : {}),
    ...(rute ? { rute } : {}),
    ...(jalurMenu ? { jalurMenu } : {}),
    jalurMasuk: v?.jalurMasuk ?? sel.jalurMasuk ?? peta.jalurMasuk,
    butuhLogin,
    ...(butuhLogin && peta.prasyaratAkun ? { prasyarat: peta.prasyaratAkun } : {}),
  };
}

const BATAS_KOLOM = 40;
export const BATAS_PETUNJUK = 3000;

/**
 * Petunjuk Navigator (TEPERCAYA, dari registry ini) untuk satu sesi: portal, jalan ke formulir layanan tujuan,
 * jebakan UI, kolom dan berkas yang diketahui. undefined bila wilayah/layanan belum dipetakan atau offline.
 */
export function petunjukPortal(
  kode: string | null | undefined,
  jenis: string | null | undefined,
  varian?: string | null,
): string | undefined {
  const s = ketersediaanLayanan(kode, jenis, varian);
  if (!s.dipetakan || !s.online) return undefined;
  const { peta, sel } = s;
  const baris: string[] = [
    `Portal: ${peta.namaPortal} (${peta.host}). Masuk: ${peta.login}${s.butuhLogin ? '' : ' (layanan ini tanpa akun)'}.`,
    `Layanan tujuan: ${s.namaDiPortal ?? s.layanan}${s.rute ? `; rute formulir ${s.rute}` : ''}.`,
  ];
  if (s.jalurMenu?.length) baris.push(`Jalur menu: ${s.jalurMenu.join(' > ')}.`);
  const lain = Object.entries(sel.varian ?? {})
    .filter(([id, v]) => id !== s.varian && v.namaDiPortal)
    .map(([id, v]) => `${id}: ${v.namaDiPortal}`);
  const lainUnik = [...new Set(lain)];
  if (lainUnik.length) baris.push(`Varian lain di portal ini: ${lainUnik.join('; ')}.`);
  if (sel.offline)
    baris.push(
      `Tidak online di portal ini: ${sel.offline.alasan} Bila warga ternyata butuh varian itu, jawab tidak_bisa.`,
    );
  if (sel.jam) baris.push(`Jam layanan formulir: ${sel.jam}.`);
  const jebakan = [...(sel.jebakan ?? []), ...peta.jebakan];
  if (jebakan.length) baris.push('Jebakan UI:', ...jebakan.map((j) => `- ${j}`));
  if (sel.field?.length) {
    const label = sel.field.slice(0, BATAS_KOLOM).map((f) => `${f.label}${f.wajib ? '*' : ''} [${f.tipe}]`);
    baris.push(`Kolom yang diketahui (* wajib): ${label.join('; ')}.`);
  }
  if (sel.berkas?.length) baris.push(`Berkas persyaratan: ${sel.berkas.join('; ')}.`);
  if (sel.tombolAkhir) baris.push(`Tombol akhir: ${sel.tombolAkhir} (selalu ditekan warga).`);
  const teks = baris.join('\n');
  return teks.length > BATAS_PETUNJUK ? `${teks.slice(0, BATAS_PETUNJUK - 1)}…` : teks;
}

/** Aturan blokir aset berat untuk host sesi (pola dari portal yang host-nya ada di sesi). */
export function aturanBlokirAset(hostsSesi: readonly string[]): readonly PolaBlokirAset[] {
  const ada = new Set(hostsSesi.map((h) => h.toLowerCase()));
  return Object.values(PETA_PORTAL).flatMap((p) => (ada.has(p.host) ? (p.blokirAset ?? []) : []));
}

/**
 * Apakah permintaan ini aset berat yang boleh dibatalkan worker: HANYA jenis gambar/fon/media yang cocok pola
 * (host persis, potongan jalur, akhiran). Dokumen, skrip, gaya, XHR tidak pernah diblokir di sini.
 */
export function asetDiblokir(aturan: readonly PolaBlokirAset[], url: string, resourceType: string): boolean {
  if (
    aturan.length === 0 ||
    (resourceType !== 'image' && resourceType !== 'font' && resourceType !== 'media')
  )
    return false;
  const u = URL.parse(url);
  if (!u || (u.protocol !== 'https:' && u.protocol !== 'http:')) return false;
  const host = u.hostname.toLowerCase();
  const jalur = u.pathname.toLowerCase();
  return aturan.some(
    (a) =>
      a.host === host &&
      (a.jenis as readonly string[]).includes(resourceType) &&
      (!a.jalurMengandung || jalur.includes(a.jalurMengandung.toLowerCase())) &&
      (!a.akhiran || jalur.endsWith(a.akhiran.toLowerCase())),
  );
}
