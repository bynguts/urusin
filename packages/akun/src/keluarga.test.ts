import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openHarnessDb } from '@urusin/harness';
import { describe, expect, it } from 'vitest';
import { deriveKek } from './keys.js';
import { aad, ANGGOTA_MAKS, seal, Vault, VaultError } from './vault.js';

const KEY_B64 = Buffer.alloc(32, 7).toString('base64');
const A = `akun_${'a'.repeat(32)}`;
const B = `akun_${'b'.repeat(32)}`;
const T = `tamu_${'c'.repeat(32)}`;
/** NIK uji dirakit saat runtime (pii-scan menolak literal 16 digit). */
const nik = (d: string) => d.repeat(16);

function vaultUji() {
  const db = openHarnessDb();
  const dir = mkdtempSync(join(tmpdir(), 'vault-kel-'));
  const vault = new Vault(db, deriveKek(KEY_B64), dir, { diskPersen: () => 10 });
  const user = (id: string, jenis = 'akun') =>
    db
      .prepare(
        "INSERT INTO users (id, email, jenis, created_at) VALUES (?, ?, ?, '2026-11-09T00:00:00.000Z')",
      )
      .run(id, jenis === 'akun' ? `${id}@example.com` : null, jenis);
  return { db, dir, vault, user };
}

describe('Vault: data keluarga (blob Data Diri versi 2)', () => {
  it('migrasi: blob lama (Data Diri polos) dibaca sebagai "Saya" tanpa anggota, lalu jadi versi 2', () => {
    const { db, vault, user } = vaultUji();
    user(A);
    // Tulis blob lama persis seperti sebelum fitur keluarga: objek Data Diri polos.
    vault.setIngatan(A, { versi: 1, butir: [] }); // membuat DEK
    const dek = (vault as unknown as { dek(u: string, c: boolean): Buffer }).dek(A, false);
    const lama = { namaLengkap: 'Warga Lama', noKk: nik('3') };
    db.prepare('INSERT INTO vault_data_diri (user_id, ciphertext, updated_at) VALUES (?,?,?)').run(
      A,
      seal(dek, Buffer.from(JSON.stringify(lama)), aad.dataDiri(A)),
      '2026-11-01T00:00:00.000Z',
    );
    expect(vault.getDataDiri(A)?.data).toEqual(lama);
    expect(vault.getKeluarga(A)).toEqual({ anggota: [], updatedAt: '2026-11-01T00:00:00.000Z' });
    expect(vault.ringkasanData(A)).toEqual({
      dataDiri: true,
      ayah: false,
      ibu: false,
      pasangan: false,
      anak: 0,
      lainnya: 0,
    });

    const { anggota } = vault.tambahAnggota(A, { hubungan: 'ibu', namaLengkap: 'Ibu Uji' });
    expect(vault.getDataDiri(A)?.data).toEqual(lama); // "Saya" tidak berubah
    expect(vault.getKeluarga(A)?.anggota).toEqual([anggota]);
  });

  it('CRUD anggota: id agt_, ubah, hapus, Data Diri dan anggota saling tidak menimpa, terenkripsi', () => {
    const { db, vault, user } = vaultUji();
    user(A);
    user(B);
    expect(vault.getKeluarga(A)).toBeNull();
    const ibu = vault.tambahAnggota(A, { hubungan: 'ibu', namaLengkap: 'Siti Uji', nik: nik('5') }).anggota;
    const anak = vault.tambahAnggota(A, {
      hubungan: 'anak',
      namaLengkap: 'Bayu Uji',
      tanggalLahir: '2025-03-01',
    }).anggota;
    expect(ibu.id).toMatch(/^agt_[0-9a-f]{32}$/);
    expect(ibu.id).not.toBe(anak.id);
    expect(vault.getDataDiri(A)?.data).toEqual({});

    vault.setDataDiri(A, { namaLengkap: 'Warga Uji' });
    expect(vault.getKeluarga(A)?.anggota.map((a) => a.namaLengkap)).toEqual(['Siti Uji', 'Bayu Uji']);

    const diubah = vault.ubahAnggota(A, anak.id, { hubungan: 'anak', namaLengkap: 'Bayu Ubah' });
    expect(diubah?.anggota).toEqual({ hubungan: 'anak', namaLengkap: 'Bayu Ubah', id: anak.id });
    expect(vault.ubahAnggota(A, 'agt_tidak_ada', { namaLengkap: 'x' })).toBeNull();
    expect(vault.ubahAnggota(B, anak.id, { namaLengkap: 'x' })).toBeNull();
    expect(vault.hapusAnggota(B, ibu.id)).toBe(false);

    const ct = (
      db.prepare('SELECT ciphertext FROM vault_data_diri WHERE user_id = ?').get(A) as { ciphertext: Buffer }
    ).ciphertext.toString('latin1');
    expect(ct).not.toContain('Siti');
    expect(ct).not.toContain(nik('5'));

    expect(vault.ringkasanData(A)).toMatchObject({ dataDiri: true, ibu: true, ayah: false, anak: 1 });
    expect(vault.hapusAnggota(A, ibu.id)).toBe(true);
    expect(vault.hapusAnggota(A, ibu.id)).toBe(false);
    expect(vault.getKeluarga(A)?.anggota.map((a) => a.id)).toEqual([anak.id]);
    expect(vault.getDataDiri(A)?.data).toEqual({ namaLengkap: 'Warga Uji' });
  });

  it('ringkasan: pasangan/suami/istri = pasangan, anak dihitung, tanpa nilai', () => {
    const { vault, user } = vaultUji();
    user(A);
    expect(vault.ringkasanData(A)).toEqual({
      dataDiri: false,
      ayah: false,
      ibu: false,
      pasangan: false,
      anak: 0,
      lainnya: 0,
    });
    vault.tambahAnggota(A, { hubungan: 'istri', namaLengkap: 'P' });
    vault.tambahAnggota(A, { hubungan: 'anak', namaLengkap: 'A1' });
    vault.tambahAnggota(A, { hubungan: 'anak', namaLengkap: 'A2' });
    vault.tambahAnggota(A, { hubungan: 'ayah', namaLengkap: 'Y' });
    vault.tambahAnggota(A, { hubungan: 'lainnya', namaLengkap: 'L' });
    const r = vault.ringkasanData(A);
    expect(r).toEqual({ dataDiri: false, ayah: true, ibu: false, pasangan: true, anak: 2, lainnya: 1 });
    expect(JSON.stringify(r)).not.toMatch(/A1|A2|"P"/);
  });

  it(`batas ${ANGGOTA_MAKS} anggota`, () => {
    const { vault, user } = vaultUji();
    user(A);
    for (let i = 0; i < ANGGOTA_MAKS; i++)
      vault.tambahAnggota(A, { hubungan: 'lainnya', namaLengkap: `L${i}` });
    expect(() => vault.tambahAnggota(A, { hubungan: 'anak', namaLengkap: 'lebih' })).toThrow(VaultError);
  });

  it('hapus semua (crypto-shred) ikut menghapus anggota keluarga', () => {
    const { db, vault, user } = vaultUji();
    user(A);
    vault.setDataDiri(A, { namaLengkap: 'Warga' });
    vault.tambahAnggota(A, { hubungan: 'ayah', namaLengkap: 'Ayah Uji' });
    vault.shred(A);
    expect(vault.getKeluarga(A)).toBeNull();
    expect(vault.ringkasanData(A).ayah).toBe(false);
    expect(db.prepare('SELECT COUNT(*) n FROM vault_data_diri').get()).toEqual({ n: 0 });
  });

  it('pindah tamu → akun: Data Diri akun menang, anggota tamu melengkapi tanpa menggandakan NIK', () => {
    const { vault, user } = vaultUji();
    user(A);
    user(T, 'tamu');
    vault.setDataDiri(A, { namaLengkap: 'Akun' });
    vault.tambahAnggota(A, { hubungan: 'ibu', namaLengkap: 'Ibu Akun', nik: nik('7') });
    vault.setDataDiri(T, { namaLengkap: 'Tamu', hp: 'x' });
    vault.tambahAnggota(T, { hubungan: 'ibu', namaLengkap: 'Ibu Tamu', nik: nik('7') });
    const anakTamu = vault.tambahAnggota(T, { hubungan: 'anak', namaLengkap: 'Anak Tamu' }).anggota;
    const r = vault.siapkanPindah(T, A);
    r.terapkan();
    r.selesai();
    expect(vault.getDataDiri(A)?.data).toEqual({ namaLengkap: 'Akun', hp: 'x' });
    const anggota = vault.getKeluarga(A)!.anggota;
    expect(anggota.map((a) => a.namaLengkap)).toEqual(['Ibu Akun', 'Anak Tamu']);
    expect(anggota[1]!.id).not.toBe(anakTamu.id); // id baru di pemilik baru
    expect(vault.getKeluarga(T)).toBeNull();
  });
});
