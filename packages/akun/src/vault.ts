import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, statfsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '@urusin/harness';
import { AkunError } from './errors.js';
import { newId } from './token.js';

/**
 * Vault per pemilik (akun, tamu, atau salinan demo) dengan envelope encryption (ADR 0028):
 * - KEK = HKDF-SHA256(URUSIN_PII_KEY, label `urusin/kek/v1`), terpisah dari kunci HMAC placeholder.
 * - DEK acak 256-bit per pemilik, disimpan TERBUNGKUS (AES-256-GCM dengan KEK) di `user_keys`.
 * - Data Diri (JSON) dan berkas dokumen dienkripsi AES-256-GCM dengan DEK; AAD = versi skema + jenis objek +
 *   pemilik (+ id dokumen), sehingga baris/berkas yang dipindah ke pemilik lain gagal didekripsi.
 * - Crypto-shred: hapus DEK terbungkus → semua ciphertext pemilik itu tidak bisa dibuka lagi.
 * - Rotasi KEK: `kekLama` (URUSIN_PII_KEY_PREV) membuka DEK lama lalu langsung dibungkus ulang dengan KEK baru;
 *   `bungkusUlangSemua()` melakukannya untuk semua pemilik sekaligus (`pnpm kek:rotate`).
 */

/** Versi KEK awal; tiap rotasi menaikkan `kek_version` baris yang dibungkus ulang. */
export const KEK_VERSION = 1;
/** Versi skema AAD (ikut di setiap AAD). */
export const AAD_VERSION = 'v1';
const SEAL_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MIB = 1024 * 1024;

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

export const aad = {
  dek: (u: string) => `${AAD_VERSION}|dek|${u}`,
  dataDiri: (u: string) => `${AAD_VERSION}|data-diri|${u}`,
  dokumen: (u: string, d: string) => `${AAD_VERSION}|dokumen|${u}|${d}`,
  judul: (u: string, d: string) => `${AAD_VERSION}|judul|${u}|${d}`,
};

export type DokumenMeta = {
  id: string;
  jenis: string;
  judul: string;
  mime: string;
  size: number;
  createdAt: string;
};

export type BatasVault = {
  /** Berkas per pemilik (default 10). */
  berkasPerPemilik: number;
  /** Ukuran maksimal satu berkas dalam byte (default 9 MB). */
  ukuranMaks: number;
  /** Total byte semua berkas vault di host (default 2 GiB). */
  totalMaks: number;
  /**
   * Persen pemakaian disk folder vault yang dianggap penuh (default 85, sama dengan THRESHOLD
   * deploy/disk-alert.sh). 0 = tidak diperiksa.
   */
  diskPersenMaks: number;
};

export const DEFAULT_BATAS_VAULT: BatasVault = Object.freeze({
  berkasPerPemilik: 10,
  ukuranMaks: 9 * MIB,
  totalMaks: 2048 * MIB,
  diskPersenMaks: 85,
});

export type VaultOptions = {
  now?: () => Date;
  /** KEK dari URUSIN_PII_KEY_PREV selama rotasi. */
  kekLama?: Buffer | undefined;
  batas?: Partial<BatasVault>;
  /** Persen pemakaian disk folder vault (tes menimpanya). */
  diskPersen?: (dir: string) => number;
  /** Dipanggil saat unggahan ditolak karena penyimpanan penuh (alert operator). */
  alert?: (pesan: string) => void;
};

/** Rencana pemindahan vault tamu → akun: berkas baru sudah ditulis; `terapkan` dijalankan di dalam transaksi. */
export type RencanaPindah = {
  terapkan(): void;
  batalkan(): void;
  selesai(): void;
};

const ID_RE = /^[a-z]+_[0-9a-f]{32}$/;

function diskPersenDefault(dir: string): number {
  try {
    const s = statfsSync(dir);
    return s.blocks > 0 ? Math.round((1 - s.bavail / s.blocks) * 100) : 0;
  } catch {
    return 0;
  }
}

export class Vault {
  private readonly now: () => Date;
  readonly batas: BatasVault;
  private readonly diskPersen: (dir: string) => number;

  constructor(
    private readonly db: Db,
    private readonly kek: Buffer,
    /** Direktori berkas terenkripsi: `<dir>/<userId>/<docId>.bin`. */
    readonly dir: string,
    private readonly opts: VaultOptions = {},
  ) {
    if (kek.length !== 32) throw new Error('KEK harus 32 byte');
    if (opts.kekLama && opts.kekLama.length !== 32) throw new Error('KEK lama harus 32 byte');
    this.now = opts.now ?? (() => new Date());
    this.batas = { ...DEFAULT_BATAS_VAULT, ...opts.batas };
    this.diskPersen = opts.diskPersen ?? diskPersenDefault;
  }

  /** Buka DEK terbungkus; DEK dari KEK lama langsung dibungkus ulang dengan KEK baru. */
  private bukaDek(userId: string, wrapped: Buffer, versi: number): Buffer {
    try {
      return open(this.kek, wrapped, aad.dek(userId));
    } catch (e) {
      if (!this.opts.kekLama) throw e;
      const dek = open(this.opts.kekLama, wrapped, aad.dek(userId));
      this.db
        .prepare('UPDATE user_keys SET wrapped_dek = ?, kek_version = ? WHERE user_id = ?')
        .run(seal(this.kek, dek, aad.dek(userId)), versi + 1, userId);
      return dek;
    }
  }

  /** DEK pemilik; `create` membuatnya bila belum ada. undefined = belum ada (atau sudah di-shred). */
  private dek(userId: string, create: boolean): Buffer | undefined {
    const row = this.db
      .prepare('SELECT wrapped_dek, kek_version FROM user_keys WHERE user_id = ?')
      .get(userId) as { wrapped_dek: Buffer; kek_version: number } | undefined;
    if (row) return this.bukaDek(userId, row.wrapped_dek, row.kek_version);
    if (!create) return undefined;
    const dek = randomBytes(32);
    this.db
      .prepare('INSERT INTO user_keys (user_id, wrapped_dek, kek_version, created_at) VALUES (?,?,?,?)')
      .run(userId, seal(this.kek, dek, aad.dek(userId)), KEK_VERSION, this.now().toISOString());
    return dek;
  }

  punyaIsi(userId: string): boolean {
    return (
      this.db
        .prepare(
          `SELECT 1 FROM vault_data_diri WHERE user_id = ?
           UNION ALL SELECT 1 FROM vault_documents WHERE user_id = ? LIMIT 1`,
        )
        .get(userId, userId) !== undefined
    );
  }

  getDataDiri(userId: string): { data: Record<string, unknown>; updatedAt: string } | null {
    const row = this.db
      .prepare('SELECT ciphertext, updated_at FROM vault_data_diri WHERE user_id = ?')
      .get(userId) as { ciphertext: Buffer; updated_at: string } | undefined;
    if (!row) return null;
    const dek = this.dek(userId, false);
    if (!dek) return null;
    const json = open(dek, row.ciphertext, aad.dataDiri(userId)).toString('utf8');
    return { data: JSON.parse(json) as Record<string, unknown>, updatedAt: row.updated_at };
  }

  setDataDiri(userId: string, data: Record<string, unknown>): string {
    const dek = this.dek(userId, true)!;
    const at = this.now().toISOString();
    const ct = seal(dek, Buffer.from(JSON.stringify(data), 'utf8'), aad.dataDiri(userId));
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

  /** Total byte berkas vault semua pemilik. */
  totalBytes(): number {
    return (this.db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM vault_documents').get() as { n: number })
      .n;
  }

  /** Lempar galat bila unggahan baru melanggar batas per pemilik atau batas global host. */
  periksaBatas(userId: string, ukuran: number): void {
    if (ukuran > this.batas.ukuranMaks) throw new AkunError('DOKUMEN_TERLALU_BESAR');
    const n = (
      this.db.prepare('SELECT COUNT(*) AS n FROM vault_documents WHERE user_id = ?').get(userId) as {
        n: number;
      }
    ).n;
    if (n >= this.batas.berkasPerPemilik) throw new AkunError('DOKUMEN_KUOTA_PENUH');
    const total = this.totalBytes();
    if (total + ukuran > this.batas.totalMaks) {
      this.opts.alert?.(`vault penuh: ${total} byte terpakai dari batas ${this.batas.totalMaks}`);
      throw new AkunError('PENYIMPANAN_PENUH');
    }
    if (this.batas.diskPersenMaks > 0) {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      const persen = this.diskPersen(this.dir);
      if (persen >= this.batas.diskPersenMaks) {
        this.opts.alert?.(`disk vault ${persen}% (ambang ${this.batas.diskPersenMaks}%): unggahan ditolak`);
        throw new AkunError('PENYIMPANAN_PENUH');
      }
    }
  }

  putDocument(
    userId: string,
    doc: { jenis: string; judul: string; mime: string; bytes: Buffer },
  ): DokumenMeta {
    this.periksaBatas(userId, doc.bytes.length);
    const dek = this.dek(userId, true)!;
    const id = newId('dok');
    const at = this.now().toISOString();
    const path = this.filePath(userId, id);
    mkdirSync(join(this.dir, userId), { recursive: true, mode: 0o700 });
    writeFileSync(path, seal(dek, doc.bytes, aad.dokumen(userId, id)), { mode: 0o600 });
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
          seal(dek, Buffer.from(doc.judul, 'utf8'), aad.judul(userId, id)),
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
      judul: open(dek, r.judul_ct, aad.judul(userId, r.id)).toString('utf8'),
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
    return { meta, bytes: open(dek, sealed, aad.dokumen(userId, docId)) };
  }

  deleteDocument(userId: string, docId: string): boolean {
    if (!ID_RE.test(docId)) return false;
    const r = this.db.prepare('DELETE FROM vault_documents WHERE id = ? AND user_id = ?').run(docId, userId);
    if (r.changes === 0) return false;
    rmSync(this.filePath(userId, docId), { force: true });
    return true;
  }

  /**
   * Siapkan pemindahan seluruh vault `dari` (tamu) ke `ke` (akun) dengan enkripsi ulang memakai DEK `ke`.
   * Berkas baru ditulis sekarang; baris DB diganti oleh `terapkan()` (di dalam transaksi pemanggil), yang juga
   * menghancurkan DEK `dari`. `batalkan()` menghapus berkas baru bila transaksi gagal; `selesai()` menghapus
   * berkas lama setelah commit. Data Diri digabung: nilai akun yang sudah ada menang, isian tamu melengkapi.
   */
  siapkanPindah(dari: string, ke: string): RencanaPindah {
    const tulisBaru: string[] = [];
    const lama = this.getDataDiri(dari);
    const docs = this.listDocuments(dari);
    if (!lama && docs.length === 0) {
      return {
        terapkan: () => this.shredDb(dari),
        batalkan: () => undefined,
        selesai: () => this.hapusBerkas(dari),
      };
    }
    const dekKe = this.dek(ke, true)!;
    const dekDari = this.dek(dari, false)!;
    const baris: { id: string; jenis: string; judulCt: Buffer; mime: string; size: number; at: string }[] =
      [];
    try {
      for (const d of docs) {
        const id = newId('dok');
        const bytes = open(dekDari, readFileSync(this.filePath(dari, d.id)), aad.dokumen(dari, d.id));
        mkdirSync(join(this.dir, ke), { recursive: true, mode: 0o700 });
        const path = this.filePath(ke, id);
        writeFileSync(path, seal(dekKe, bytes, aad.dokumen(ke, id)), { mode: 0o600 });
        tulisBaru.push(path);
        baris.push({
          id,
          jenis: d.jenis,
          judulCt: seal(dekKe, Buffer.from(d.judul, 'utf8'), aad.judul(ke, id)),
          mime: d.mime,
          size: d.size,
          at: d.createdAt,
        });
      }
    } catch (e) {
      for (const p of tulisBaru) rmSync(p, { force: true });
      throw e;
    }
    return {
      terapkan: () => {
        if (lama) {
          const sekarang = this.getDataDiri(ke)?.data ?? {};
          const gabung: Record<string, unknown> = { ...lama.data };
          for (const [k, v] of Object.entries(sekarang)) if (v !== undefined && v !== '') gabung[k] = v;
          this.setDataDiri(ke, gabung);
        }
        const ins = this.db.prepare(
          `INSERT INTO vault_documents (id, user_id, jenis, judul_ct, mime, size, created_at)
           VALUES (?,?,?,?,?,?,?)`,
        );
        for (const b of baris) ins.run(b.id, ke, b.jenis, b.judulCt, b.mime, b.size, b.at);
        this.shredDb(dari);
      },
      batalkan: () => {
        for (const p of tulisBaru) rmSync(p, { force: true });
      },
      selesai: () => this.hapusBerkas(dari),
    };
  }

  /** Bagian DB crypto-shred (boleh di dalam transaksi pemanggil): timpa nol lalu hapus DEK dan baris vault. */
  shredDb(userId: string): void {
    this.db
      .prepare('UPDATE user_keys SET wrapped_dek = zeroblob(length(wrapped_dek)) WHERE user_id = ?')
      .run(userId);
    this.db.prepare('DELETE FROM user_keys WHERE user_id = ?').run(userId);
    this.db.prepare('DELETE FROM vault_data_diri WHERE user_id = ?').run(userId);
    this.db.prepare('DELETE FROM vault_documents WHERE user_id = ?').run(userId);
  }

  hapusBerkas(userId: string): void {
    if (ID_RE.test(userId)) rmSync(join(this.dir, userId), { recursive: true, force: true });
  }

  /**
   * Crypto-shred: timpa lalu hapus DEK terbungkus, hapus baris vault dan seluruh berkas pemilik.
   * Ciphertext yang mungkin tersisa (cadangan, halaman WAL lama) tidak bisa dibuka tanpa DEK.
   */
  shred(userId: string): void {
    this.db.transaction(() => this.shredDb(userId)).immediate();
    this.hapusBerkas(userId);
  }

  /**
   * Rotasi KEK (`pnpm kek:rotate`): bungkus ulang SEMUA DEK dengan KEK baru dalam satu transaksi. DEK yang
   * sudah terbungkus KEK baru dilewati. Gagal membuka satu DEK pun = seluruh rotasi dibatalkan.
   */
  bungkusUlangSemua(): { dibungkusUlang: number; sudahBaru: number } {
    const rows = this.db.prepare('SELECT user_id, wrapped_dek, kek_version FROM user_keys').all() as {
      user_id: string;
      wrapped_dek: Buffer;
      kek_version: number;
    }[];
    let dibungkusUlang = 0;
    let sudahBaru = 0;
    this.db
      .transaction(() => {
        for (const r of rows) {
          try {
            open(this.kek, r.wrapped_dek, aad.dek(r.user_id));
            sudahBaru++;
            continue;
          } catch {
            // terbungkus KEK lama
          }
          if (!this.opts.kekLama)
            throw new VaultError('DEK tidak terbuka dan URUSIN_PII_KEY_PREV tidak diisi');
          this.bukaDek(r.user_id, r.wrapped_dek, r.kek_version);
          dibungkusUlang++;
        }
      })
      .immediate();
    return { dibungkusUlang, sudahBaru };
  }
}
