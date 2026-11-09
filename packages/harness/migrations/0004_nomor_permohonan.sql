-- Nomor permohonan dari situs resmi (bukti Browser Pendamping setelah warga menekan tombol kirim), agar
-- Urusanku dan halaman urusan menampilkannya setelah sesi ditutup. Bukan data pribadi: nomor registrasi
-- instansi, lolos skema ketat bukti (huruf, angka, spasi, . / _ -, maks 64). Aditif dan idempoten (tabel
-- anak, bukan ALTER) agar aman dijalankan ulang pada DB lama tanpa user_version.
CREATE TABLE IF NOT EXISTS nomor_permohonan (
  urusan_id TEXT PRIMARY KEY REFERENCES urusan(id) ON DELETE CASCADE,
  nomor TEXT NOT NULL,
  at TEXT NOT NULL
);
