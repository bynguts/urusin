// Satu-satunya daftar rute yang diperiksa anggaran performa:
//   - lighthouserc.cjs (Lighthouse CI) dan apps/web/scripts/bundle-budget.mjs membaca daftar ini.
// Rute baru cukup ditambahkan sebagai satu baris di ROUTES setelah halamannya ada di apps/web/src/routes.
//
// TODO rute terencana (tambahkan satu baris di ROUTES saat halamannya dibuat):
//   '/kelahiran'
//   '/chat'
//   '/berkas'
//   '/lacak'
const ROUTES = ['/', '/pair'];

module.exports = { ROUTES };
