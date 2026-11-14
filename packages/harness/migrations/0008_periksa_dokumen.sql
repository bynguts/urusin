-- Hasil periksa kejelasan foto dokumen brankas (jelas / perlu difoto ulang / belum diperiksa): satu dokumen JSON
-- terenkripsi per dokumen dengan DEK pemiliknya (AAD `v1|periksa|<pemilik>|<dokumen>`), ikut terhapus bersama
-- dokumennya. Dokumen lama tanpa baris di sini = belum pernah diperiksa (tidak ditampilkan). Aditif dan idempoten
-- (tabel anak, bukan ALTER) seperti 0004.
CREATE TABLE IF NOT EXISTS vault_periksa (
  doc_id TEXT PRIMARY KEY REFERENCES vault_documents(id) ON DELETE CASCADE,
  ciphertext BLOB NOT NULL,
  at TEXT NOT NULL
);
