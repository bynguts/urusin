import type { CityEntry } from './schema.js';

/**
 * Seed dari recon read-only 2026-11-08 (recon/dukcapil-kota-*.md, rea-dukcapil-sby-smg.md).
 * `verifiedAt` null untuk semuanya: pengamatan recon belum diverifikasi tangan oleh pemilik data.
 * Hanya Wonogiri berstatus `kirim-asli` (akun warga ada di tim); kota lain tidak diuji kirim asli.
 */
type Seed = {
  kode: string;
  nama: string;
  tier: CityEntry['tier'];
  validasi: CityEntry['validasi'];
  origin?: string;
  portal?: string;
  adapterId?: string;
  instansi: string;
  catatan: string;
};

const DKI = 'Dinas Kependudukan dan Pencatatan Sipil Provinsi DKI Jakarta';
const DKI_CATATAN =
  'Satu portal untuk semua kode 31xx. Web menampilkan 503/pengembangan saat dicek; layanan lewat aplikasi. Cetak e-KTP dan pindah datang dari luar DKI lewat kantor.';
const dki = (kode: string, nama: string): Seed => ({
  kode,
  nama,
  tier: 'dipandu',
  validasi: 'pending-recon',
  origin: 'https://alpukat-dukcapil.jakarta.go.id',
  portal: 'Alpukat Betawi',
  instansi: DKI,
  catatan: DKI_CATATAN,
});
const dinas = (nama: string) => `Dinas Kependudukan dan Pencatatan Sipil ${nama}`;

const SEEDS: Seed[] = [
  {
    kode: '3312',
    nama: 'Kabupaten Wonogiri',
    tier: 'semi',
    validasi: 'kirim-asli',
    origin: 'https://telunjuksakti.wonogirikab.go.id',
    portal: 'Telunjuk Sakti',
    adapterId: 'telunjuk-sakti-wonogiri',
    instansi: dinas('Kabupaten Wonogiri'),
    catatan:
      'Layanan 42 jenis; login HP + sandi + CAPTCHA gambar oleh warga; unggah berkas satu per satu, warga menekan Selesai.',
  },
  {
    kode: '3578',
    nama: 'Kota Surabaya',
    tier: 'semi',
    validasi: 'read-only',
    origin: 'https://wargaklampid-dispendukcapil.surabaya.go.id',
    portal: 'Klampid New Generation',
    adapterId: 'klampid-surabaya',
    instansi: dinas('Kota Surabaya'),
    catatan:
      'Katalog layanan publik dan pelacakan publik (captcha oleh warga) tersedia tanpa login; pengajuan belum diuji kirim asli.',
  },
  {
    kode: '3374',
    nama: 'Kota Semarang',
    tier: 'semi',
    validasi: 'read-only',
    origin: 'https://sidnok.semarangkota.go.id',
    portal: "Si D'nOK",
    adapterId: 'sidnok-semarang',
    instansi: dinas('Kota Semarang'),
    catatan:
      'Daftar syarat publik (/data-dukung) dan cek status pengajuan; hanya warga Semarang; formulir di balik login belum dipetakan.',
  },
  {
    kode: '3573',
    nama: 'Kota Malang',
    tier: 'semi',
    validasi: 'pending-recon',
    origin: 'https://siapel.malangkota.go.id',
    portal: 'SIAPEL',
    instansi: dinas('Kota Malang'),
    catatan:
      'Server-rendered; login email + sandi + CAPTCHA gambar. Cek permohonan publik memuat tiket orang lain: hanya kueri tiket milik warga, jangan simpan daftar.',
  },
  {
    kode: '3404',
    nama: 'Kabupaten Sleman',
    tier: 'semi',
    validasi: 'pending-recon',
    origin: 'https://dukcapilonline.slemankab.go.id',
    portal: 'Dukcapil Online',
    instansi: dinas('Kabupaten Sleman'),
    catatan: 'Login dengan CAPTCHA slider oleh warga.',
  },
  {
    kode: '1271',
    nama: 'Kota Medan',
    tier: 'semi',
    validasi: 'pending-recon',
    origin: 'https://sibisa.medan.go.id',
    portal: 'SIBISA',
    instansi: dinas('Kota Medan'),
    catatan: 'Syarat per layanan terlihat setelah login; pendaftaran akun dengan verifikasi selfie-KTP.',
  },
  {
    kode: '3671',
    nama: 'Kota Tangerang',
    tier: 'semi',
    validasi: 'pending-recon',
    origin: 'https://sobatdukcapil.tangerangkota.go.id',
    portal: 'Sobat Dukcapil',
    instansi: dinas('Kota Tangerang'),
    catatan: 'Login memakai akun Tangerang LIVE, tanpa CAPTCHA terlihat; hanya warga.',
  },
  {
    kode: '7371',
    nama: 'Kota Makassar',
    tier: 'semi',
    validasi: 'pending-recon',
    origin: 'https://dukcapil.makassarkota.go.id',
    portal: 'Layanan Dukcapil Makassar',
    instansi: dinas('Kota Makassar'),
    catatan:
      'Portal aktif dukcapil.makassarkota.go.id (bukan dukcapil.makassar.go.id yang masih Coming Soon). Daftar dokumen dan cek progres publik; reCAPTCHA v3.',
  },
  {
    kode: '3276',
    nama: 'Kota Depok',
    tier: 'semi',
    validasi: 'pending-recon',
    origin: 'https://silondomaju.depok.go.id',
    portal: 'Silondo Maju',
    instansi: dinas('Kota Depok'),
    catatan:
      'Menggantikan Silondo Bermula sejak 1 Okt 2026; akun wajib; katalog layanan dan lacak status publik; CAPTCHA slider.',
  },
  {
    kode: '3275',
    nama: 'Kota Bekasi',
    tier: 'semi',
    validasi: 'pending-recon',
    origin: 'https://www.e-open.id',
    portal: 'e-Open',
    instansi: dinas('Kota Bekasi'),
    catatan:
      'Ditautkan resmi dari situs Disdukcapil Kota Bekasi, tetapi domain bukan .go.id. Akun diverifikasi petugas; CAPTCHA matematika.',
  },
  dki('3171', 'Kota Administrasi Jakarta Pusat'),
  dki('3172', 'Kota Administrasi Jakarta Utara'),
  dki('3173', 'Kota Administrasi Jakarta Barat'),
  dki('3174', 'Kota Administrasi Jakarta Selatan'),
  dki('3175', 'Kota Administrasi Jakarta Timur'),
  dki('3101', 'Kabupaten Administrasi Kepulauan Seribu'),
  {
    kode: '3273',
    nama: 'Kota Bandung',
    tier: 'dipandu',
    validasi: 'tidak-ada-portal',
    origin: 'https://disdukcapil.bandung.go.id',
    portal: 'Disdukcapil Kota Bandung',
    instansi: dinas('Kota Bandung'),
    catatan: 'Tidak ada web login; layanan online lewat aplikasi Salaman+, IKD, dan antrean e-SPASI.',
  },
  {
    kode: '3471',
    nama: 'Kota Yogyakarta',
    tier: 'dipandu',
    validasi: 'pending-recon',
    origin: 'https://dindukcapil.jogjakota.go.id',
    portal: 'Jogja Smart Service',
    instansi: dinas('Kota Yogyakarta'),
    catatan: 'App-first (JSS); syarat publik tidak ditemukan.',
  },
  {
    kode: '3372',
    nama: 'Kota Surakarta',
    tier: 'dipandu',
    validasi: 'pending-recon',
    origin: 'https://dispendukcapil.surakarta.go.id',
    portal: 'Dispendukcapil Surakarta',
    instansi: dinas('Kota Surakarta'),
    catatan: 'Tidak terjangkau dari jaringan recon (connection refused).',
  },
  {
    kode: '5171',
    nama: 'Kota Denpasar',
    tier: 'dipandu',
    validasi: 'pending-recon',
    origin: 'https://dukcapil.denpasarkota.go.id',
    portal: 'Dukcapil Denpasar',
    instansi: dinas('Kota Denpasar'),
    catatan: 'Dialihkan ke halaman pemeliharaan (akses dibatasi) saat dicek; tidak dilewati.',
  },
  {
    kode: '1671',
    nama: 'Kota Palembang',
    tier: 'dipandu',
    validasi: 'tidak-ada-portal',
    origin: 'https://disdukcapil.palembang.go.id',
    portal: 'Disdukcapil Palembang',
    instansi: dinas('Kota Palembang'),
    catatan: 'Situs tanpa aplikasi layanan; formulir di /informasi/formulir belum dibuka.',
  },
  {
    kode: '3515',
    nama: 'Kabupaten Sidoarjo',
    tier: 'dipandu',
    validasi: 'pending-recon',
    origin: 'https://disdukcapil.sidoarjokab.go.id',
    portal: 'Disdukcapil Sidoarjo',
    instansi: dinas('Kabupaten Sidoarjo'),
    catatan: 'Plavon Dukcapil memberi 503 saat dicek; naikkan bila pulih.',
  },
  {
    kode: '3311',
    nama: 'Kabupaten Sukoharjo',
    tier: 'dipandu',
    validasi: 'tidak-ada-portal',
    origin: 'https://dispendukcapil.sukoharjokab.go.id',
    portal: 'MELODI (WhatsApp)',
    instansi: dinas('Kabupaten Sukoharjo'),
    catatan: 'Layanan online hanya lewat WhatsApp per jenis layanan.',
  },
  {
    kode: '3310',
    nama: 'Kabupaten Klaten',
    tier: 'dipandu',
    validasi: 'pending-recon',
    origin: 'https://sakura.dukcapil.klaten.go.id',
    portal: 'SAKURA',
    instansi: dinas('Kabupaten Klaten'),
    catatan: 'Login NIK + sandi + captcha teks; pendaftaran lewat Google.',
  },
  {
    kode: '3313',
    nama: 'Kabupaten Karanganyar',
    tier: 'dipandu',
    validasi: 'pending-recon',
    origin: 'https://disdukcapil.karanganyarkab.go.id',
    portal: 'Paklay Komplit',
    instansi: dinas('Kabupaten Karanganyar'),
    catatan: 'Verifikasi slider memblokir akses saat recon; belum terpetakan.',
  },
  {
    kode: '3216',
    nama: 'Kabupaten Bekasi',
    tier: 'dipandu',
    validasi: 'pending-recon',
    origin: 'https://sitepak.bekasikab.go.id',
    portal: 'SITEPAK',
    instansi: dinas('Kabupaten Bekasi'),
    catatan: 'Tidak ada pendaftaran akun warga yang terlihat.',
  },
];

export const SEED_ENTRIES: readonly CityEntry[] = SEEDS.map((s) => ({
  kodeKabKota: s.kode,
  nama: s.nama,
  tier: s.tier,
  validasi: s.validasi,
  ...(s.origin && s.portal ? { portal: { origin: s.origin, nama: s.portal } } : {}),
  ...(s.adapterId ? { adapterId: s.adapterId } : {}),
  sourceRef: s.origin
    ? [{ url: `${s.origin}/`, judul: `Portal ${s.portal ?? s.nama}`, instansi: s.instansi }]
    : [],
  verifiedAt: null,
  catatan: s.catatan,
}));
