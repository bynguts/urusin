-- Judul urusan untuk daftar (sidebar Urusan aktif, Urusanku, header): dibuat AI sekali setelah turn pertama
-- warga (sumber 'ai'), atau diganti warga sendiri (sumber 'warga', tidak pernah ditimpa AI). Judul sudah
-- divalidasi bebas PII sebelum disimpan. Aditif dan idempoten (tabel anak, bukan ALTER) seperti 0004.
CREATE TABLE IF NOT EXISTS judul_urusan (
  urusan_id TEXT PRIMARY KEY REFERENCES urusan(id) ON DELETE CASCADE,
  judul TEXT NOT NULL,
  sumber TEXT NOT NULL CHECK (sumber IN ('ai', 'warga')),
  at TEXT NOT NULL
);
