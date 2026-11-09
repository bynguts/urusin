import { rmSync } from 'node:fs';

/** Hapus folder DB run ini (lihat playwright.config.ts). Gagal di Windows bila SQLite masih terkunci. */
export default function bersihkan() {
  const dir = process.env.URUSIN_E2E_DIR;
  if (!dir) return;
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // berkas masih dipegang server: dibersihkan saat run berikutnya mulai
  }
}
