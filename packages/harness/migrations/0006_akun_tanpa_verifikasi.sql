-- Akun tanpa verifikasi email (ADR 0032): setiap akun adalah akun penuh. Akun sandi lama yang belum pernah
-- membuka tautan verifikasi (email_verified_at NULL) dijadikan aktif sejak dibuat, sehingga tidak ada lagi baris
-- "setengah jadi" (dan rollback ke kode lama tidak menyapu akun ini sebagai belum terverifikasi). Tautan
-- verifikasi yang masih menunggu dibatalkan: alurnya sudah tidak ada. Idempoten (hanya menyentuh baris NULL).
--
-- `email_terbukti.at` = kepemilikan kotak surat pernah DIBUKTIKAN (tautan verifikasi lama, Google dengan email
-- terverifikasi, atau tautan atur ulang sandi). Diisi dari email_verified_at SEBELUM aktivasi di bawah, supaya
-- akun yang belum pernah membuktikan email tetap tercatat belum terbukti (lihat aturUlangSandi, ADR 0032).
-- Tabel anak, bukan ALTER (seperti 0004), agar aman dijalankan ulang pada DB lama tanpa user_version.
CREATE TABLE IF NOT EXISTS email_terbukti (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  at TEXT NOT NULL
);
INSERT OR IGNORE INTO email_terbukti (user_id, at)
  SELECT id, email_verified_at FROM users WHERE jenis = 'akun' AND email_verified_at IS NOT NULL;
UPDATE users SET email_verified_at = created_at WHERE jenis = 'akun' AND email_verified_at IS NULL;
UPDATE email_tokens SET used_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE purpose = 'verify' AND used_at IS NULL;
