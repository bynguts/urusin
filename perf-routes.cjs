// Satu-satunya daftar rute yang diperiksa anggaran performa:
//   - lighthouserc.cjs (Lighthouse CI) dan apps/web/scripts/bundle-budget.mjs membaca daftar ini.
// Rute baru cukup ditambahkan sebagai satu baris di ROUTES setelah halamannya ada di apps/web/src/routes.
// Rute yang butuh data (urusan/[id], jejak/[id]) dan layar akun yang bergantung pada server akun belum didaftarkan.
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
  '/cara-kerja',
  '/urusan',
  '/tanya-jawab',
];

module.exports = { ROUTES };
