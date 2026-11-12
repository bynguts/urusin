// Satu-satunya daftar rute yang diperiksa anggaran performa:
//   - lighthouserc.cjs (Lighthouse CI) dan apps/web/scripts/bundle-budget.mjs membaca daftar ini.
// Rute baru cukup ditambahkan sebagai satu baris di ROUTES setelah halamannya ada di apps/web/src/routes.
// Rute yang butuh data (urusan/[id], jejak/[id]) belum didaftarkan.
const ROUTES = [
  '/',
  '/beranda',
  '/peristiwa/kelahiran',
  '/urusanku',
  '/dokumen',
  '/data-diri',
  '/bantuan',
  '/pengaturan',
  '/masuk',
  '/daftar',
  '/lupa-sandi',
  '/privasi',
  '/syarat',
  '/cara-kerja',
  '/urusan',
  '/tanya-jawab',
];

// Rute dasbor diukur sebagai warga yang SUDAH masuk (akun demo juri, Data Diri sintetis): /beranda wajib
// login, dan layar lain di sini adalah tampilan akun yang dipakai warga setelah masuk. Masuk/keluar per URL
// dikerjakan scripts/lhci-masuk.cjs (puppeteerScript Lighthouse CI). Rute lain diukur sebagai tamu.
const RUTE_MASUK = ['/beranda', '/urusanku', '/dokumen', '/data-diri', '/pengaturan'];

module.exports = { ROUTES, RUTE_MASUK };
