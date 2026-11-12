-- Akun tanpa verifikasi email (ADR 0032): setiap akun adalah akun penuh. Akun sandi lama yang belum pernah
-- membuka tautan verifikasi (email_verified_at NULL) dijadikan aktif sejak dibuat, sehingga tidak ada lagi baris
-- "setengah jadi" (dan rollback ke kode lama tidak menyapu akun ini sebagai belum terverifikasi). Tautan
-- verifikasi yang masih menunggu dibatalkan: alurnya sudah tidak ada. Idempoten (hanya menyentuh baris NULL).
UPDATE users SET email_verified_at = created_at WHERE jenis = 'akun' AND email_verified_at IS NULL;
UPDATE email_tokens SET used_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE purpose = 'verify' AND used_at IS NULL;
