// Akun demo untuk juri (guidebook: tanpa akses khusus). Kredensial HANYA dari env, tidak pernah di repo:
//   URUSIN_DEMO_EMAIL=... URUSIN_DEMO_PASSWORD=... URUSIN_DB_PATH=.data/urusin.sqlite \
//   URUSIN_PII_KEY=... pnpm akun:demo
// Idempoten: akun yang sudah ada diperbarui sandinya dan ditandai terverifikasi.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { openHarnessDb } from '@urusin/harness';
import { normalizeEmail } from './email.js';
import { hashPassword, periksaSandi } from './password.js';
import { newId } from './token.js';

async function main(): Promise<number> {
  const env = process.env;
  const email = normalizeEmail(env.URUSIN_DEMO_EMAIL ?? '');
  const sandi = env.URUSIN_DEMO_PASSWORD ?? '';
  if (!email) {
    console.error('URUSIN_DEMO_EMAIL kosong atau tidak valid');
    return 1;
  }
  const masalah = periksaSandi(sandi, email);
  if (masalah) {
    console.error(`URUSIN_DEMO_PASSWORD ditolak: ${masalah}`);
    return 1;
  }
  const dbPath = env.URUSIN_DB_PATH ?? env.DATABASE_URL?.replace(/^file:/, '') ?? '.data/urusin.sqlite';
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = openHarnessDb(dbPath);
  const now = new Date().toISOString();
  const hash = await hashPassword(sandi);
  const ada = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string } | undefined;
  if (ada) {
    db.prepare(
      'UPDATE users SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?',
    ).run(hash, now, ada.id);
  } else {
    db.prepare(
      'INSERT INTO users (id, email, email_verified_at, password_hash, created_at) VALUES (?,?,?,?,?)',
    ).run(newId('akun'), email, now, hash, now);
  }
  db.close();
  console.log(`akun demo ${ada ? 'diperbarui' : 'dibuat'} (email dari URUSIN_DEMO_EMAIL)`);
  return 0;
}

process.exit(await main());
