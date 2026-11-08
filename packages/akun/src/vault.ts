import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '@urusin/harness';
import { newId } from './token.js';

/**
 * Vault per akun dengan envelope encryption (ADR 0028):
 * - KEK (key-encryption key) = HKDF-SHA256 atas URUSIN_PII_KEY, dipisah domainnya dari kunci HMAC placeholder.
 * - DEK (data-encryption key) acak 256-bit per akun, disimpan TERBUNGKUS (AES-256-GCM dengan KEK) di `user_keys`.
 * - Data Diri (JSON) dan berkas dokumen dienkripsi AES-256-GCM dengan DEK; AAD mengikat ciphertext ke
 *   akun dan objeknya, sehingga baris/berkas yang dipindah ke akun lain gagal didekripsi.
 * - Crypto-shred: hapus DEK terbungkus → semua ciphertext akun itu tidak bisa dibuka lagi.
 */

/** Versi KEK; naikkan saat rotasi URUSIN_PII_KEY (bungkus ulang DEK, data tidak perlu dienkripsi ulang). */
export const KEK_VERSION = 1;
const SEAL_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function deriveKek(piiKeyBase64: string): Buffer {
  const ikm = Buffer.from(piiKeyBase64, 'base64');
  if (ikm.length < 32) throw new Error('URUSIN_PII_KEY terlalu pendek: butuh base64 dari minimal 32 byte');
  return Buffer.from(hkdfSync('sha256', ikm, 'urusin/vault/kek', `v${KEK_VERSION}`, 32));
}

/** AES-256-GCM: [versi 1B][iv 12B][tag 16B][ciphertext]. */
export function seal(key: Buffer, plaintext: Buffer, aad: string): Buffer {
  const iv = randomBytes(IV_BYTES);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return Buffer.concat([Buffer.from([SEAL_VERSION]), iv, c.getAuthTag(), ct]);
}

export function open(key: Buffer, sealed: Buffer, aad: string): Buffer {
  if (sealed.length < 1 + IV_BYTES + TAG_BYTES || sealed[0] !== SEAL_VERSION)
    throw new VaultError('ciphertext rusak');
  const iv = sealed.subarray(1, 1 + IV_BYTES);
  const tag = sealed.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAAD(Buffer.from(aad, 'utf8'));
  d.setAuthTag(tag);
  try {
    return Buffer.concat([d.update(sealed.subarray(1 + IV_BYTES + TAG_BYTES)), d.final()]);
  } catch {
    throw new VaultError('ciphertext tidak bisa dibuka (kunci salah atau data diubah)');
  }
}

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultError';
  }
}

export type DokumenMeta = {
  id: string;
  jenis: string;
  judul: string;
  mime: string;
  size: number;
  createdAt: string;
};

const ID_RE = /^[a-z]+_[0-9a-f]{32}$/;

export class Vault {
  constructor(
    private readonly db: Db,
    private readonly kek: Buffer,
    /** Direktori berkas terenkripsi: `<dir>/<userId>/<docId>.bin`. */
    readonly dir: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (kek.length !== 32) throw new Error('KEK harus 32 byte');
  }

  /** DEK akun; `create` membuatnya bila belum ada. undefined = belum ada (atau sudah di-shred). */
  private dek(userId: string, create: boolean): Buffer | undefined {
    const row = this.db.prepare('SELECT wrapped_dek FROM user_keys WHERE user_id = ?').get(userId) as
      { wrapped_dek: Buffer } | undefined;
    if (row) return open(this.kek, row.wrapped_dek, `dek|${userId}`);
    if (!create) return undefined;
    const dek = randomBytes(32);
    this.db
      .prepare('INSERT INTO user_keys (user_id, wrapped_dek, kek_version, created_at) VALUES (?,?,?,?)')
      .run(userId, seal(this.kek, dek, `dek|${userId}`), KEK_VERSION, this.now().toISOString());
    return dek;
  }

  getDataDiri(userId: string): { data: Record<string, unknown>; updatedAt: string } | null {
    const row = this.db
      .prepare('SELECT ciphertext, updated_at FROM vault_data_diri WHERE user_id = ?')
      .get(userId) as { ciphertext: Buffer; updated_at: string } | undefined;
    if (!row) return null;
    const dek = this.dek(userId, false);
    if (!dek) return null;
    const json = open(dek, row.ciphertext, `data-diri|${userId}`).toString('utf8');
    return { data: JSON.parse(json) as Record<string, unknown>, updatedAt: row.updated_at };
  }

  setDataDiri(userId: string, data: Record<string, unknown>): string {
    const dek = this.dek(userId, true)!;
    const at = this.now().toISOString();
    const ct = seal(dek, Buffer.from(JSON.stringify(data), 'utf8'), `data-diri|${userId}`);
    this.db
      .prepare(
        `INSERT INTO vault_data_diri (user_id, ciphertext, updated_at) VALUES (?,?,?)
         ON CONFLICT(user_id) DO UPDATE SET ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`,
      )
      .run(userId, ct, at);
    return at;
  }

  private filePath(userId: string, docId: string): string {
    if (!ID_RE.test(userId) || !ID_RE.test(docId)) throw new VaultError('id tidak valid');
    return join(this.dir, userId, `${docId}.bin`);
  }

  putDocument(
    userId: string,
    doc: { jenis: string; judul: string; mime: string; bytes: Buffer },
  ): DokumenMeta {
    const dek = this.dek(userId, true)!;
    const id = newId('dok');
    const at = this.now().toISOString();
    const path = this.filePath(userId, id);
    mkdirSync(join(this.dir, userId), { recursive: true, mode: 0o700 });
    writeFileSync(path, seal(dek, doc.bytes, `dokumen|${userId}|${id}`), { mode: 0o600 });
    try {
      this.db
        .prepare(
          `INSERT INTO vault_documents (id, user_id, jenis, judul_ct, mime, size, created_at)
           VALUES (?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          userId,
          doc.jenis,
          seal(dek, Buffer.from(doc.judul, 'utf8'), `judul|${userId}|${id}`),
          doc.mime,
          doc.bytes.length,
          at,
        );
    } catch (e) {
      rmSync(path, { force: true });
      throw e;
    }
    return { id, jenis: doc.jenis, judul: doc.judul, mime: doc.mime, size: doc.bytes.length, createdAt: at };
  }

  listDocuments(userId: string): DokumenMeta[] {
    const rows = this.db
      .prepare(
        `SELECT id, jenis, judul_ct, mime, size, created_at FROM vault_documents
         WHERE user_id = ? ORDER BY created_at DESC, id`,
      )
      .all(userId) as {
      id: string;
      jenis: string;
      judul_ct: Buffer;
      mime: string;
      size: number;
      created_at: string;
    }[];
    if (rows.length === 0) return [];
    const dek = this.dek(userId, false);
    if (!dek) return [];
    return rows.map((r) => ({
      id: r.id,
      jenis: r.jenis,
      judul: open(dek, r.judul_ct, `judul|${userId}|${r.id}`).toString('utf8'),
      mime: r.mime,
      size: r.size,
      createdAt: r.created_at,
    }));
  }

  getDocument(userId: string, docId: string): { meta: DokumenMeta; bytes: Buffer } | null {
    if (!ID_RE.test(docId)) return null;
    const meta = this.listDocuments(userId).find((d) => d.id === docId);
    if (!meta) return null;
    const dek = this.dek(userId, false)!;
    const sealed = readFileSync(this.filePath(userId, docId));
    return { meta, bytes: open(dek, sealed, `dokumen|${userId}|${docId}`) };
  }

  deleteDocument(userId: string, docId: string): boolean {
    if (!ID_RE.test(docId)) return false;
    const r = this.db.prepare('DELETE FROM vault_documents WHERE id = ? AND user_id = ?').run(docId, userId);
    if (r.changes === 0) return false;
    rmSync(this.filePath(userId, docId), { force: true });
    return true;
  }

  /**
   * Crypto-shred: timpa lalu hapus DEK terbungkus, hapus baris vault dan seluruh berkas akun.
   * Ciphertext yang mungkin tersisa (cadangan, halaman WAL lama) tidak bisa dibuka tanpa DEK.
   */
  shred(userId: string): void {
    const tx = this.db.transaction(() => {
      this.db
        .prepare('UPDATE user_keys SET wrapped_dek = zeroblob(length(wrapped_dek)) WHERE user_id = ?')
        .run(userId);
      this.db.prepare('DELETE FROM user_keys WHERE user_id = ?').run(userId);
      this.db.prepare('DELETE FROM vault_data_diri WHERE user_id = ?').run(userId);
      this.db.prepare('DELETE FROM vault_documents WHERE user_id = ?').run(userId);
    });
    tx.immediate();
    if (ID_RE.test(userId)) rmSync(join(this.dir, userId), { recursive: true, force: true });
  }
}
