-- Ingatan warga (ADR 0031): satu dokumen JSON terenkripsi per pemilik vault (akun, tamu, atau salinan demo), dengan
-- DEK pemilik yang sama dengan Data Diri (envelope encryption ADR 0028; AAD `v1|ingatan|<pemilik>`). Isinya butir
-- terbatas yang warga nyatakan sendiri (wilayah, preferensi, catatan pendek), tanpa PII. Ikut crypto-shred, umur
-- tamu/demo, dan rotasi tamu -> akun bersama vault. Aditif dan idempoten (CREATE ... IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS vault_ingatan (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  ciphertext BLOB NOT NULL,
  updated_at TEXT NOT NULL
);
