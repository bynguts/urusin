-- Pemetaan nilai -> placeholder yang stabil antar turn dalam satu urusan.
-- Kunci = HMAC-SHA256 (kunci rahasia server) atas nilai ternormalisasi; nilai asli TIDAK PERNAH disimpan.
CREATE TABLE IF NOT EXISTS pii_placeholders (
  urusan_id TEXT NOT NULL REFERENCES urusan(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  kind TEXT NOT NULL,
  token TEXT NOT NULL,
  PRIMARY KEY (urusan_id, key)
);
