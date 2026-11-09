import { openHarnessDb } from '@urusin/harness';
import { deriveKek } from './keys.js';
import { Vault } from './vault.js';

type Env = Record<string, string | undefined>;

/**
 * Rotasi KEK vault (`pnpm kek:rotate`): buka setiap DEK dengan KEK dari `URUSIN_PII_KEY_PREV` (kunci lama),
 * bungkus ulang dengan KEK dari `URUSIN_PII_KEY` (kunci baru) dalam satu transaksi. Data vault tidak
 * dienkripsi ulang. Setelah sukses, hapus URUSIN_PII_KEY_PREV dari .env (lihat deploy/README.md, bagian Kunci vault).
 * Mengembalikan ringkasan tanpa nilai kunci.
 */
export function rotasiKek(env: Env): { dibungkusUlang: number; sudahBaru: number } {
  const baru = env.URUSIN_PII_KEY?.trim();
  const lama = env.URUSIN_PII_KEY_PREV?.trim();
  if (!baru) throw new Error('URUSIN_PII_KEY (kunci baru) wajib');
  if (!lama) throw new Error('URUSIN_PII_KEY_PREV (kunci lama) wajib');
  if (baru === lama)
    throw new Error('URUSIN_PII_KEY_PREV sama dengan URUSIN_PII_KEY: tidak ada yang dirotasi');
  const dbPath = env.URUSIN_DB_PATH ?? env.DATABASE_URL?.replace(/^file:/, '') ?? '.data/urusin.sqlite';
  const db = openHarnessDb(dbPath);
  try {
    // Folder berkas tidak disentuh rotasi (berkas dienkripsi DEK, bukan KEK).
    return new Vault(db, deriveKek(baru), '', { kekLama: deriveKek(lama) }).bungkusUlangSemua();
  } finally {
    db.close();
  }
}
