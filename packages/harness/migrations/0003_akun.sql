-- Akun warga (ADR 0028): login email + sandi dan Google, sesi server, token email, vault terenkripsi per pemilik
-- (akun, tamu, atau salinan demo). Aditif saja. Waktu disimpan ISO-8601 UTC (toISOString) sehingga perbandingan
-- string = perbandingan waktu.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  -- akun = warga terdaftar; tamu = "Coba tanpa daftar" (dibuat malas, terikat hash urusin_sid);
  -- demo = salinan terisolasi "Masuk sebagai juri" berisi data sintetis.
  jenis TEXT NOT NULL DEFAULT 'akun' CHECK (jenis IN ('akun', 'tamu', 'demo')),
  -- Ternormalisasi (trim, NFKC, huruf kecil). Hanya akun; satu-satunya PII polos di server (dibutuhkan login).
  email TEXT UNIQUE,
  email_verified_at TEXT,
  -- PHC argon2id; NULL untuk akun yang hanya masuk lewat Google, tamu, dan demo.
  password_hash TEXT,
  -- tamu: SHA-256 cookie urusin_sid (cookie mentah tidak disimpan).
  sid_hash TEXT UNIQUE,
  -- tamu/demo: SHA-256 IP pembuat, untuk batas pembuatan per IP per hari. Hilang bersama barisnya.
  asal_ip_hash TEXT,
  created_at TEXT NOT NULL,
  -- tamu: 24 jam sejak aktivitas terakhir; demo: 24 jam sejak dibuat; akun: NULL.
  expires_at TEXT,
  CHECK ((jenis = 'akun') = (email IS NOT NULL)),
  CHECK (jenis = 'tamu' OR sid_hash IS NULL)
);
CREATE INDEX IF NOT EXISTS users_jenis_idx ON users(jenis, created_at);
CREATE INDEX IF NOT EXISTS users_expires_idx ON users(expires_at);

CREATE TABLE IF NOT EXISTS oauth_identities (
  provider TEXT NOT NULL,
  sub TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  -- 'daftar' = identitas asal akun (akun dibuat/diambil alih lewat Google); 'tautan' = ditautkan kemudian
  -- (sesi atau bukti sandi). "Keluar dari semua perangkat" mencabut semua 'tautan'.
  asal TEXT NOT NULL DEFAULT 'daftar' CHECK (asal IN ('daftar', 'tautan')),
  PRIMARY KEY (provider, sub)
);
CREATE INDEX IF NOT EXISTS oauth_identities_user_idx ON oauth_identities(user_id);

-- Sesi login: hanya SHA-256 token yang disimpan; token mentah hanya ada di cookie __Host-.
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  -- Kedaluwarsa absolut; kedaluwarsa idle dihitung dari last_seen_at.
  expires_at TEXT NOT NULL,
  -- Bukti kredensial terakhir (login, konfirmasi sandi, Google). Unduh berkas di sesi yang belum pernah
  -- mengunduh mensyaratkan auth_at <= 15 menit.
  auth_at TEXT NOT NULL,
  pernah_unduh INTEGER NOT NULL DEFAULT 0,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id);

-- Token email sekali pakai (verifikasi 24 jam, atur ulang sandi 30 menit); hanya hash yang disimpan.
-- Verifikasi dari daftar (ulang) membawa hash sandi yang dipilih saat itu: sandi itu baru berlaku (dan sandi
-- lama batal) saat alamat terverifikasi.
CREATE TABLE IF NOT EXISTS email_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify', 'reset')),
  password_hash TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX IF NOT EXISTS email_tokens_user_idx ON email_tokens(user_id, purpose);

-- Keadaan OAuth sementara (state -> PKCE verifier, nonce, tujuan, akun yang sedang masuk bila menautkan),
-- sekali pakai, 10 menit.
CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  next TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

-- Identitas Google yang menunggu bukti sandi sebelum ditautkan ke akun terverifikasi ber-email sama.
CREATE TABLE IF NOT EXISTS oauth_link_pending (
  ticket_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  sub TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Kegagalan login per email dalam jendela 15 menit (kunci = hash email, juga untuk email tak terdaftar).
CREATE TABLE IF NOT EXISTS auth_lockout (
  key TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL,
  locked_until TEXT,
  updated_at TEXT NOT NULL
);

-- Envelope encryption: DEK per pemilik (AES-256-GCM) dibungkus KEK turunan URUSIN_PII_KEY.
-- Menghapus baris ini = crypto-shred seluruh vault pemilik.
CREATE TABLE IF NOT EXISTS user_keys (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  wrapped_dek BLOB NOT NULL,
  kek_version INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vault_data_diri (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  ciphertext BLOB NOT NULL,
  updated_at TEXT NOT NULL
);

-- Metadata dokumen; isi berkas terenkripsi di disk (URUSIN_VAULT_DIR/<user>/<id>.bin), judul ikut terenkripsi.
CREATE TABLE IF NOT EXISTS vault_documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  jenis TEXT NOT NULL,
  judul_ct BLOB NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS vault_documents_user_idx ON vault_documents(user_id, created_at);

-- Token persetujuan "Izinkan isi": terikat pemilik + hash daftar write + origin tujuan, sekali pakai, 5 menit.
CREATE TABLE IF NOT EXISTS pii_izin (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  write_list_hash TEXT NOT NULL,
  target_origin TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

-- Pemilik urusan: akun/demo (user_id), atau sesi tamu (hash urusin_sid) yang pindah ke akun saat masuk.
CREATE TABLE IF NOT EXISTS urusan_owner (
  urusan_id TEXT PRIMARY KEY REFERENCES urusan(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  guest_sid_hash TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS urusan_owner_user_idx ON urusan_owner(user_id);
CREATE INDEX IF NOT EXISTS urusan_owner_guest_idx ON urusan_owner(guest_sid_hash);
