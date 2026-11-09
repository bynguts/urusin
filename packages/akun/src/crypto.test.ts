import { mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openHarnessDb } from '@urusin/harness';
import { describe, expect, it } from 'vitest';
import { maskEmail, normalizeEmail } from './email.js';
import { ARGON2_PARAMS, hashPassword, needsRehash, periksaSandi, verifyPassword } from './password.js';
import { newId, randomToken, safeEqual, sha256Hex, TOKEN_RE } from './token.js';
import type { AkunError } from './errors.js';
import { rotasiKek } from './kek-rotate.js';
import { deriveKek, kunciPlaceholderHmac, LABEL_KEK, LABEL_PLACEHOLDER_HMAC, turunkanKunci } from './keys.js';
import { aad, open, seal, Vault, VaultError } from './vault.js';

const KEY_B64 = Buffer.alloc(32, 7).toString('base64');

describe('hash sandi argon2id', () => {
  it('format PHC dengan parameter OWASP, salt acak, verifikasi benar/salah', async () => {
    const a = await hashPassword('kuda-lari-cepat-9');
    const b = await hashPassword('kuda-lari-cepat-9');
    expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, 'kuda-lari-cepat-9')).toBe(true);
    expect(await verifyPassword(a, 'kuda-lari-cepat-8')).toBe(false);
    expect(needsRehash(a)).toBe(false);
  });

  it('normalisasi NFKC: bentuk Unicode berbeda dari sandi yang sama tetap cocok', async () => {
    const h = await hashPassword('café-sandi-ok');
    expect(await verifyPassword(h, 'café-sandi-ok')).toBe(true);
  });

  it('hash rusak atau parameter berbahaya → false, dan perlu di-hash ulang', async () => {
    expect(await verifyPassword('bukan-phc', 'x')).toBe(false);
    const besar = `$argon2id$v=19$m=99999999,t=2,p=1$${'A'.repeat(22)}$${'A'.repeat(43)}`;
    expect(await verifyPassword(besar, 'x')).toBe(false);
    expect(needsRehash('bukan-phc')).toBe(true);
    const lama = (await hashPassword('kuda-lari-cepat-9')).replace(
      `m=${ARGON2_PARAMS.memory},t=2`,
      'm=8192,t=2',
    );
    expect(needsRehash(lama)).toBe(true);
    // tag tidak cocok dengan parameter baru: verifikasi gagal tanpa melempar
    expect(await verifyPassword(lama, 'kuda-lari-cepat-9')).toBe(false);
  });

  it('kebijakan sandi: panjang, batas atas, daftar umum, pengulangan, sama dengan email', () => {
    expect(periksaSandi('pendek1')).toBe('SANDI_TERLALU_PENDEK');
    expect(periksaSandi('sembilan9')).toBe('SANDI_TERLALU_PENDEK'); // 9 < 10
    expect(periksaSandi('x'.repeat(129) + 'y')).toBe('SANDI_TERLALU_PANJANG');
    expect(periksaSandi('Password123')).toBe('SANDI_TERLALU_UMUM');
    expect(periksaSandi('bismillah123')).toBe('SANDI_TERLALU_UMUM');
    // daftar 10k: sama persis, dan kata dasar + angka/simbol di belakang
    expect(periksaSandi('qwertyuiop')).toBe('SANDI_TERLALU_UMUM');
    expect(periksaSandi('Sunshine2026!')).toBe('SANDI_TERLALU_UMUM');
    expect(periksaSandi('password123')).toBe('SANDI_TERLALU_UMUM');
    expect(periksaSandi('aaaaaaaaaa')).toBe('SANDI_TERLALU_UMUM');
    expect(periksaSandi('wargabaikku@example.com', 'wargabaikku@example.com')).toBe('SANDI_TERLALU_UMUM');
    expect(periksaSandi('wargabaikku', 'wargabaikku@example.com')).toBe('SANDI_TERLALU_UMUM');
    expect(periksaSandi('kuda-lari-cepat-9', 'wargabaikku@example.com')).toBeNull();
    // 10 karakter emoji (code point, bukan unit UTF-16) dihitung 10
    expect(periksaSandi('🐱🐶🐭🐹🐰🦊🐻🐼🐨🐯')).toBeNull();
  });
});

describe('token dan email', () => {
  it('token 256-bit base64url, unik; hash hex; perbandingan waktu-konstan', () => {
    const t = randomToken();
    expect(t).toMatch(TOKEN_RE);
    expect(randomToken()).not.toBe(t);
    expect(sha256Hex(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(newId('akun')).toMatch(/^akun_[0-9a-f]{32}$/);
  });

  it('normalisasi email: trim, huruf kecil, NFKC; bentuk aneh ditolak; masker untuk log', () => {
    expect(normalizeEmail('  Warga.Baik+urusin@Example.COM ')).toBe('warga.baik+urusin@example.com');
    expect(normalizeEmail('ｗａｒｇａ@example.com')).toBe('warga@example.com');
    for (const bad of [
      '',
      'tanpa-at',
      'a@b',
      'a b@example.com',
      'a@@example.com',
      `${'a'.repeat(250)}@example.com`,
    ])
      expect(normalizeEmail(bad)).toBeNull();
    expect(maskEmail('warga@example.com')).toBe('w***@example.com');
  });
});

describe('envelope encryption', () => {
  it('seal/open round-trip; AAD, kunci, dan byte yang diubah semuanya ditolak', () => {
    const k = deriveKek(KEY_B64);
    expect(k).toHaveLength(32);
    const s = seal(k, Buffer.from('rahasia'), 'aad-1');
    expect(open(k, s, 'aad-1').toString()).toBe('rahasia');
    expect(() => open(k, s, 'aad-2')).toThrow(VaultError);
    expect(() => open(deriveKek(Buffer.alloc(32, 8).toString('base64')), s, 'aad-1')).toThrow(VaultError);
    const rusak = Buffer.from(s);
    rusak[rusak.length - 1]! ^= 1;
    expect(() => open(k, rusak, 'aad-1')).toThrow(VaultError);
    expect(() => open(k, Buffer.from([9, 1, 2]), 'aad-1')).toThrow(VaultError);
    expect(() => deriveKek(Buffer.alloc(16).toString('base64'))).toThrow(/terlalu pendek/);
  });

  it('KEK dan kunci HMAC placeholder: label HKDF terpisah, deterministik, bukan kunci mentah', () => {
    expect([LABEL_KEK, LABEL_PLACEHOLDER_HMAC]).toEqual(['urusin/kek/v1', 'urusin/placeholder-hmac/v1']);
    expect(deriveKek(KEY_B64).equals(deriveKek(KEY_B64))).toBe(true);
    expect(deriveKek(KEY_B64).equals(Buffer.from(KEY_B64, 'base64'))).toBe(false);
    expect(deriveKek(KEY_B64).equals(turunkanKunci(KEY_B64, LABEL_KEK))).toBe(true);
    expect(kunciPlaceholderHmac(KEY_B64)).toMatch(/^[0-9a-f]{64}$/);
    expect(kunciPlaceholderHmac(KEY_B64)).not.toBe(deriveKek(KEY_B64).toString('hex'));
  });
});

function vaultUji(opts: ConstructorParameters<typeof Vault>[3] = {}) {
  const db = openHarnessDb();
  const dir = mkdtempSync(join(tmpdir(), 'vault-'));
  const vault = new Vault(db, deriveKek(KEY_B64), dir, { diskPersen: () => 10, ...opts });
  const user = (id: string) =>
    db
      .prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, '2026-11-09T00:00:00.000Z')")
      .run(id, `${id}@example.com`);
  return { db, dir, vault, user };
}

describe('Vault per akun', () => {
  const A = `akun_${'a'.repeat(32)}`;
  const B = `akun_${'b'.repeat(32)}`;

  it('Data Diri dan dokumen terenkripsi at rest, round-trip, terisolasi antar akun', () => {
    const { db, dir, vault, user } = vaultUji();
    user(A);
    user(B);
    expect(vault.getDataDiri(A)).toBeNull();
    vault.setDataDiri(A, { namaLengkap: 'Warga Uji', alamat: 'Jalan Melati 3' });
    vault.setDataDiri(A, { namaLengkap: 'Warga Uji Dua' });
    expect(vault.getDataDiri(A)?.data).toEqual({ namaLengkap: 'Warga Uji Dua' });
    const ct = db.prepare('SELECT ciphertext FROM vault_data_diri WHERE user_id = ?').get(A) as {
      ciphertext: Buffer;
    };
    expect(ct.ciphertext.toString('latin1')).not.toContain('Warga');

    const isi = Buffer.from('%PDF-1.7 berkas KK palsu untuk uji');
    const doc = vault.putDocument(A, {
      jenis: 'kk',
      judul: 'KK keluarga',
      mime: 'application/pdf',
      bytes: isi,
    });
    expect(vault.listDocuments(A).map((d) => d.judul)).toEqual(['KK keluarga']);
    expect(vault.getDocument(A, doc.id)?.bytes.equals(isi)).toBe(true);
    const disk = readFileSync(join(dir, A, `${doc.id}.bin`));
    expect(disk.includes(Buffer.from('berkas KK'))).toBe(false);
    const meta = db.prepare('SELECT judul_ct FROM vault_documents WHERE id = ?').get(doc.id) as {
      judul_ct: Buffer;
    };
    expect(meta.judul_ct.toString('latin1')).not.toContain('KK keluarga');

    // akun lain tidak bisa membaca/menghapus dokumen A; id aneh ditolak
    expect(vault.getDocument(B, doc.id)).toBeNull();
    expect(vault.deleteDocument(B, doc.id)).toBe(false);
    expect(vault.getDocument(A, '../../etc/passwd')).toBeNull();
    expect(vault.deleteDocument(A, 'x')).toBe(false);
    expect(vault.listDocuments(B)).toEqual([]);

    // berkas A yang disalin ke folder B tetap tidak bisa dibuka dengan DEK B (AAD + DEK berbeda)
    const docB = vault.putDocument(B, {
      jenis: 'ktp',
      judul: 'x',
      mime: 'image/png',
      bytes: Buffer.from('b'),
    });
    writeFileSync(join(dir, B, `${docB.id}.bin`), disk);
    expect(() => vault.getDocument(B, docB.id)).toThrow(VaultError);

    expect(vault.deleteDocument(A, doc.id)).toBe(true);
    expect(existsSync(join(dir, A, `${doc.id}.bin`))).toBe(false);
  });

  it('crypto-shred: DEK hilang, ciphertext yang tersisa tidak bisa dibuka, berkas dan baris terhapus', () => {
    const { db, dir, vault, user } = vaultUji();
    user(A);
    vault.setDataDiri(A, { namaLengkap: 'Warga Uji' });
    const doc = vault.putDocument(A, {
      jenis: 'ktp',
      judul: 'KTP',
      mime: 'image/jpeg',
      bytes: Buffer.from('jpg'),
    });
    const sisaCt = (
      db.prepare('SELECT ciphertext FROM vault_data_diri WHERE user_id = ?').get(A) as { ciphertext: Buffer }
    ).ciphertext;
    const sisaBerkas = readFileSync(join(dir, A, `${doc.id}.bin`));
    const wrapped = (
      db.prepare('SELECT wrapped_dek FROM user_keys WHERE user_id = ?').get(A) as { wrapped_dek: Buffer }
    ).wrapped_dek;

    vault.shred(A);
    expect(db.prepare('SELECT COUNT(*) n FROM user_keys').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) n FROM vault_data_diri').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) n FROM vault_documents').get()).toEqual({ n: 0 });
    expect(existsSync(join(dir, A))).toBe(false);
    expect(vault.getDataDiri(A)).toBeNull();

    // Salinan ciphertext (mis. cadangan) tanpa DEK: DEK baru akun yang sama pun tidak bisa membukanya.
    vault.setDataDiri(A, { x: 'baru' });
    const dekBaru = open(
      deriveKek(KEY_B64),
      (db.prepare('SELECT wrapped_dek FROM user_keys WHERE user_id = ?').get(A) as { wrapped_dek: Buffer })
        .wrapped_dek,
      aad.dek(A),
    );
    expect(() => open(dekBaru, sisaCt, aad.dataDiri(A))).toThrow(VaultError);
    expect(() => open(dekBaru, sisaBerkas, aad.dokumen(A, doc.id))).toThrow(VaultError);
    expect(wrapped.equals(open(deriveKek(KEY_B64), wrapped, aad.dek(A)))).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('KEK salah (URUSIN_PII_KEY berganti tanpa rotasi) gagal tertutup', () => {
    const { db, dir, vault, user } = vaultUji();
    user(A);
    vault.setDataDiri(A, { a: '1' });
    const lain = new Vault(db, deriveKek(Buffer.alloc(32, 9).toString('base64')), dir);
    expect(() => lain.getDataDiri(A)).toThrow(VaultError);
    expect(() => new Vault(db, Buffer.alloc(16), dir)).toThrow(/32 byte/);
    expect(() => new Vault(db, deriveKek(KEY_B64), dir, { kekLama: Buffer.alloc(8) })).toThrow(/32 byte/);
  });

  it('AAD memuat versi skema', () => {
    expect(aad.dataDiri(A)).toBe(`v1|data-diri|${A}`);
    expect(aad.dokumen(A, 'dok_1')).toBe(`v1|dokumen|${A}|dok_1`);
  });

  it('PoC DoS batas vault: tamu 3 berkas / 20 MB, dan porsi tamu 25% dari batas global', () => {
    const alert: string[] = [];
    const { db, vault, user } = vaultUji({
      batas: { totalMaks: 100, ukuranMaks: 50, berkasPerTamu: 3, bytePerTamu: 20, porsiTamu: 0.25 },
      alert: (p) => alert.push(p),
    });
    const tamu = (id: string) =>
      db
        .prepare("INSERT INTO users (id, jenis, created_at) VALUES (?, 'tamu', '2026-11-09T00:00:00.000Z')")
        .run(id);
    const [T1, T2, T3] = ['a', 'b', 'c'].map((c) => `tamu_${c.repeat(32)}`) as [string, string, string];
    [T1, T2, T3].forEach(tamu);
    user(A);
    const doc = (u: string, n: number) =>
      vault.putDocument(u, { jenis: 'ktp', judul: 'x', mime: 'image/png', bytes: Buffer.alloc(n) });
    const kode = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return (e as AkunError).kode;
      }
      return null;
    };
    doc(T1, 10);
    doc(T1, 10);
    expect(kode(() => doc(T1, 1))).toBe('DOKUMEN_KUOTA_PENUH'); // 20 byte per tamu
    doc(T2, 1);
    doc(T2, 1);
    doc(T2, 1);
    expect(kode(() => doc(T2, 1))).toBe('DOKUMEN_KUOTA_PENUH'); // 3 berkas per tamu
    expect(kode(() => doc(T3, 5))).toBe('PENYIMPANAN_PENUH'); // 23 + 5 > 25% dari 100
    expect(alert.at(-1)).toMatch(/porsi tamu/);
    doc(A, 40); // akun tidak terpengaruh porsi tamu
    expect(new Vault(openHarnessDb(), deriveKek(KEY_B64), '/').batas).toMatchObject({
      berkasPerTamu: 3,
      bytePerTamu: 20 * 1024 * 1024,
      porsiTamu: 0.25,
    });
  });

  it('batas: berkas per pemilik, ukuran, total global, dan ambang disk (alert)', () => {
    const alert: string[] = [];
    let persen = 10;
    const { vault, user } = vaultUji({
      batas: { berkasPerPemilik: 2, ukuranMaks: 10, totalMaks: 25 },
      diskPersen: () => persen,
      alert: (p) => alert.push(p),
    });
    user(A);
    user(B);
    const doc = (v: Vault, u: string, n: number) =>
      v.putDocument(u, { jenis: 'ktp', judul: 'x', mime: 'image/png', bytes: Buffer.alloc(n) });
    const kode = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return (e as AkunError).kode;
      }
      return null;
    };
    expect(kode(() => doc(vault, A, 11))).toBe('DOKUMEN_TERLALU_BESAR');
    doc(vault, A, 10);
    doc(vault, A, 10);
    expect(kode(() => doc(vault, A, 1))).toBe('DOKUMEN_KUOTA_PENUH');
    expect(kode(() => doc(vault, B, 6))).toBe('PENYIMPANAN_PENUH');
    doc(vault, B, 5);
    expect(vault.totalBytes()).toBe(25);
    const kedua = vaultUji({ diskPersen: () => persen, alert: (p) => alert.push(p) });
    kedua.user(A);
    persen = 85;
    expect(kode(() => doc(kedua.vault, A, 1))).toBe('PENYIMPANAN_PENUH');
    expect(alert).toHaveLength(2);
    expect(alert[1]).toMatch(/disk vault 85%/);
    expect(new Vault(openHarnessDb(), deriveKek(KEY_B64), '/').batas).toMatchObject({
      berkasPerPemilik: 10,
      ukuranMaks: 9 * 1024 * 1024,
      diskPersenMaks: 85,
    });
  });

  it('rotasi KEK: DEK dari URUSIN_PII_KEY_PREV dibuka lalu dibungkus ulang; data tetap terbaca', () => {
    const { db, dir, vault, user } = vaultUji();
    user(A);
    user(B);
    vault.setDataDiri(A, { namaLengkap: 'A' });
    vault.setDataDiri(B, { namaLengkap: 'B' });
    const KEY2 = Buffer.alloc(32, 11).toString('base64');
    expect(() => new Vault(db, deriveKek(KEY2), dir).getDataDiri(A)).toThrow(VaultError);
    expect(() => new Vault(db, deriveKek(KEY2), dir).bungkusUlangSemua()).toThrow(/PREV/);
    const malas = new Vault(db, deriveKek(KEY2), dir, { kekLama: deriveKek(KEY_B64) });
    expect(malas.getDataDiri(A)?.data).toEqual({ namaLengkap: 'A' });
    expect(new Vault(db, deriveKek(KEY2), dir).getDataDiri(A)?.data).toEqual({ namaLengkap: 'A' });
    expect(malas.bungkusUlangSemua()).toEqual({ dibungkusUlang: 1, sudahBaru: 1 });
    expect(new Vault(db, deriveKek(KEY2), dir).getDataDiri(B)?.data).toEqual({ namaLengkap: 'B' });
    expect(db.prepare('SELECT kek_version FROM user_keys ORDER BY user_id').all()).toEqual([
      { kek_version: 2 },
      { kek_version: 2 },
    ]);
  });

  it('pnpm kek:rotate (rotasiKek) terhadap berkas DB', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'kek-')), 'urusin.sqlite');
    const db = openHarnessDb(path);
    db.prepare("INSERT INTO users (id, email, created_at) VALUES (?, 'a@example.com', 'x')").run(A);
    new Vault(db, deriveKek(KEY_B64), '').setDataDiri(A, { namaLengkap: 'Warga' });
    db.close();
    const KEY2 = Buffer.alloc(32, 12).toString('base64');
    expect(() => rotasiKek({ URUSIN_PII_KEY: KEY2 })).toThrow(/PREV/);
    expect(() => rotasiKek({ URUSIN_PII_KEY_PREV: KEY_B64 })).toThrow(/URUSIN_PII_KEY/);
    expect(() =>
      rotasiKek({ URUSIN_PII_KEY: KEY2, URUSIN_PII_KEY_PREV: KEY2, URUSIN_DB_PATH: path }),
    ).toThrow(/sama/);
    expect(rotasiKek({ URUSIN_PII_KEY: KEY2, URUSIN_PII_KEY_PREV: KEY_B64, URUSIN_DB_PATH: path })).toEqual({
      dibungkusUlang: 1,
      sudahBaru: 0,
    });
    expect(
      rotasiKek({ URUSIN_PII_KEY: KEY2, URUSIN_PII_KEY_PREV: KEY_B64, DATABASE_URL: `file:${path}` }),
    ).toEqual({ dibungkusUlang: 0, sudahBaru: 1 });
    const db2 = openHarnessDb(path);
    expect(new Vault(db2, deriveKek(KEY2), '').getDataDiri(A)?.data).toEqual({ namaLengkap: 'Warga' });
    db2.close();
  });
});
