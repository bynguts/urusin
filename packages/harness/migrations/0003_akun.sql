-- Akun warga (ADR 0028): login email + sandi dan Google, sesi server, token email, vault terenkripsi per akun.
-- Aditif saja. Waktu disimpan ISO-8601 UTC (toISOString) sehingga perbandingan string = perbandingan waktu.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  -- Ternormalisasi (trim, NFKC, huruf kecil). Satu-satunya PII polos di server: dibutuhkan untuk login.
  email TEXT NOT NULL UNIQUE,
  email_verified_at TEXT,
  -- PHC argon2id; NULL untuk akun yang hanya masuk lewat Google.
  password_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_identities (
  provider TEXT NOT NULL,
  sub TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
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
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id);

-- Token email sekali pakai (verifikasi 24 jam, atur ulang sandi 30 menit); hanya hash yang disimpan.
CREATE TABLE IF NOT EXISTS email_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify', 'reset')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX IF NOT EXISTS email_tokens_user_idx ON email_tokens(user_id, purpose);

-- Keadaan OAuth sementara (state -> PKCE verifier, nonce, tujuan), sekali pakai, 10 menit.
CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  next TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Penguncian login per email (kunci = hash email, juga untuk email yang tidak terdaftar).
CREATE TABLE IF NOT EXISTS auth_lockout (
  key TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  updated_at TEXT NOT NULL
);

-- Envelope encryption: DEK per akun (AES-256-GCM) dibungkus KEK turunan URUSIN_PII_KEY.
-- Menghapus baris ini = crypto-shred seluruh vault akun.
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

-- Pemilik urusan: akun, atau sesi tamu (urusin_sid) yang dipindahkan ke akun saat daftar/masuk.
CREATE TABLE IF NOT EXISTS urusan_owner (
  urusan_id TEXT PRIMARY KEY REFERENCES urusan(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  guest_sid TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS urusan_owner_user_idx ON urusan_owner(user_id);
CREATE INDEX IF NOT EXISTS urusan_owner_guest_idx ON urusan_owner(guest_sid);
