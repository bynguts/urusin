import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bacaIngatan,
  bawaDariTamu,
  ingatanKosong,
  jumlahDariTamu,
  nilaiButir,
  openHarnessDb,
  terapkanOperasi,
  type Db,
} from '@urusin/harness';
import { beforeEach, describe, expect, it } from 'vitest';
import { deriveKek } from './keys.js';
import { MemoryMailer } from './mailer.js';
import { AkunService } from './service.js';
import { testLimiter } from './testing.js';
import { aad, open, Vault, VaultError } from './vault.js';

/** Ingatan warga di vault (ADR 0031): enkripsi + AAD, shred, umur tamu, rotasi tamu → akun, hapus. */
const ctx = { ip: '203.0.113.9', userAgent: 'uji' };
const EMAIL = 'ingat@example.com';
const SANDI = 'kuda-lari-cepat-9';

let t: number;
let db: Db;
let mailer: MemoryMailer;
let akun: AkunService;
let alert: string[];

beforeEach(() => {
  alert = [];
  t = Date.parse('2026-11-11T08:00:00.000Z');
  db = openHarnessDb();
  mailer = new MemoryMailer();
  akun = new AkunService({
    db,
    mailer,
    vault: new Vault(
      db,
      deriveKek(Buffer.alloc(32, 5).toString('base64')),
      mkdtempSync(join(tmpdir(), 'ing-')),
      {
        now: () => new Date(t),
        diskPersen: () => 10,
        alert: (p) => alert.push(p),
      },
    ),
    publicOrigin: 'https://urusin.example.com',
    limiter: testLimiter(() => t),
    now: () => new Date(t),
  });
});

const ingatan = (...isi: [Parameters<typeof nilaiButir>[0], string?][]) =>
  isi.reduce(
    (i, [jenis, nilai]) =>
      terapkanOperasi(
        i,
        { aksi: 'simpan', jenis, nilai: nilaiButir(jenis, nilai) },
        new Date(t).toISOString(),
      ).ingatan,
    ingatanKosong(),
  );

const urusan = (...ids: string[]) => {
  for (const id of ids)
    db.prepare("INSERT INTO urusan (id, state, created_at, updated_at) VALUES (?,'BARU','x','x')").run(id);
};

/** Daftar langsung menghasilkan akun penuh (ADR 0032: tanpa verifikasi email). */
async function akunBaru(email = EMAIL) {
  return (await akun.daftar({ email, sandi: SANDI }, ctx)).akun;
}

describe('vault ingatan: enkripsi + AAD', () => {
  it('tersimpan terenkripsi (tanpa teks polos di DB), terbuka hanya dengan AAD pemiliknya', () => {
    const tamu = akun.pastikanTamu('sid-a', ctx);
    const lain = akun.pastikanTamu('sid-b', ctx);
    akun.vault.setIngatan(tamu, ingatan(['domisili', 'Kota Semarang'], ['catatan', 'suka datang pagi']));
    akun.vault.setDataDiri(lain, { namaLengkap: 'x' }); // DEK pemilik lain
    const baris = db.prepare('SELECT * FROM vault_ingatan WHERE user_id = ?').get(tamu) as {
      ciphertext: Buffer;
    };
    expect(baris.ciphertext.toString('latin1')).not.toContain('datang pagi');
    expect(baris.ciphertext.toString('latin1')).not.toContain('3374');
    expect(bacaIngatan(akun.vault.getIngatan(tamu)!.data).butir.map((b) => b.nilai)).toEqual([
      '3374',
      'suka datang pagi',
    ]);
    // baris dipindah ke pemilik lain → AAD/DEK tidak cocok → gagal dibuka
    db.prepare('INSERT INTO vault_ingatan (user_id, ciphertext, updated_at) VALUES (?,?,?)').run(
      lain,
      baris.ciphertext,
      'x',
    );
    expect(() => akun.vault.getIngatan(lain)).toThrow(VaultError);
    // AAD ingatan berbeda dari AAD Data Diri pemilik yang sama (objek tidak bisa ditukar)
    expect(aad.ingatan(tamu)).not.toBe(aad.dataDiri(tamu));
    const dataDiriCt = (
      db.prepare('SELECT ciphertext FROM vault_data_diri WHERE user_id = ?').get(lain) as {
        ciphertext: Buffer;
      }
    ).ciphertext;
    db.prepare('UPDATE vault_ingatan SET ciphertext = ? WHERE user_id = ?').run(dataDiriCt, lain);
    expect(() => akun.vault.getIngatan(lain)).toThrow(VaultError);
    expect(() => open(Buffer.alloc(32), baris.ciphertext, aad.ingatan(tamu))).toThrow(VaultError);
  });

  it('gagal dibuka = galat + alert operator (bukan dibaca kosong lalu ditimpa)', () => {
    const tamu = akun.pastikanTamu('sid-a', ctx);
    akun.vault.setIngatan(tamu, ingatan(['lansia']));
    db.prepare('UPDATE vault_ingatan SET ciphertext = ? WHERE user_id = ?').run(Buffer.alloc(40, 1), tamu);
    expect(() => akun.vault.getIngatan(tamu)).toThrow(VaultError);
    expect(alert.at(-1)).toMatch(/ingatan pemilik .* tidak bisa dibuka/);
    expect(alert.at(-1)).not.toMatch(/lansia/);
  });

  it('hapus semua ingatan; crypto-shred ikut menghapus ingatan', () => {
    const tamu = akun.pastikanTamu('sid-a', ctx);
    akun.vault.setIngatan(tamu, ingatan(['lansia']));
    expect(akun.vault.punyaIsi(tamu)).toBe(true);
    expect(akun.vault.hapusIngatan(tamu)).toBe(true);
    expect(akun.vault.getIngatan(tamu)).toBeNull();
    expect(akun.vault.hapusIngatan(tamu)).toBe(false);
    akun.vault.setIngatan(tamu, ingatan(['lansia']));
    akun.vault.shred(tamu);
    expect(db.prepare('SELECT COUNT(*) n FROM vault_ingatan').get()).toEqual({ n: 0 });
  });
});

describe('pemilik ingatan sebuah urusan', () => {
  it('tamu lewat hash sid; akun (langsung setelah daftar) dan demo → dirinya; tanpa pemilik → null', async () => {
    urusan('u_tamu', 'u_akun', 'u_yatim', 'u_demo');
    const tamu = akun.pastikanTamu('sid-a', ctx);
    akun.catatPemilikUrusan('u_tamu', { sid: 'sid-a' });
    expect(akun.pemilikIngatanUrusan('u_tamu')).toBe(tamu);
    expect(akun.urusanPemilikVault(tamu)).toEqual(['u_tamu']);
    expect(akun.pemilikIngatanUrusan('u_yatim')).toBeNull();
    expect(akun.pemilikIngatanUrusan('u_tidak_ada')).toBeNull();

    const demo = akun.buatDemo(ctx).akun;
    akun.catatPemilikUrusan('u_demo', { akun: demo });
    expect(akun.pemilikIngatanUrusan('u_demo')).toBe(demo.id);

    const a = await akunBaru();
    akun.catatPemilikUrusan('u_akun', { akun: a });
    expect(akun.pemilikIngatanUrusan('u_akun')).toBe(a.id);
    expect(akun.urusanPemilikVault(a.id)).toEqual(['u_akun']);
  });

  it('tamu kedaluwarsa (72 jam) tidak lagi memegang ingatan; penyapu menghapus barisnya', () => {
    urusan('u_1');
    const tamu = akun.pastikanTamu('sid-a', ctx);
    akun.catatPemilikUrusan('u_1', { sid: 'sid-a' });
    akun.vault.setIngatan(tamu, ingatan(['kanal', 'online']));
    t += 73 * 3_600_000;
    expect(akun.pemilikIngatanUrusan('u_1')).toBeNull();
    akun.bersihkan();
    expect(db.prepare('SELECT COUNT(*) n FROM vault_ingatan').get()).toEqual({ n: 0 });
  });
});

describe('rotasi tamu → akun', () => {
  it('ingatan tamu DITITIPKAN (tidak dipakai) sampai warga memilih; Bawa ke akun tidak menggusur akun; DEK tamu hancur', async () => {
    const a = await akunBaru();
    akun.vault.setIngatan(a.id, ingatan(['ktp', 'Kabupaten Wonogiri'], ['catatan', 'suka pagi']));
    const tamu = akun.pastikanTamu('sid-lama', ctx);
    akun.vault.setIngatan(
      tamu,
      ingatan(['ktp', 'Kota Surabaya'], ['lansia'], ['catatan', 'suka pagi'], ['catatan', 'diantar cucu']),
    );
    expect(
      akun.rotasiPemilik({ sidLama: 'sid-lama', sidBaru: 'sid-baru', userId: a.id }).vaultDipindahkan,
    ).toBe(true);
    const g = bacaIngatan(akun.vault.getIngatan(a.id)!.data);
    expect(g.butir.map((b) => [b.jenis, b.nilai])).toEqual([
      ['ktp', '3312'],
      ['catatan', 'suka pagi'],
    ]);
    const kini = new Date(t).toISOString();
    expect(jumlahDariTamu(g, kini)).toBe(2); // ktp + lansia; catatan tamu (butuh persetujuan) tidak dititipkan
    expect(bawaDariTamu(g, kini).butir.map((b) => [b.jenis, b.nilai])).toEqual([
      ['ktp', '3312'],
      ['catatan', 'suka pagi'],
      ['lansia', 'ya'],
    ]);
    expect(db.prepare('SELECT COUNT(*) n FROM vault_ingatan WHERE user_id = ?').get(tamu)).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) n FROM user_keys WHERE user_id = ?').get(tamu)).toEqual({ n: 0 });
  });

  it('tamu yang hanya punya ingatan (tanpa Data Diri/dokumen) tetap dititipkan, tidak langsung dipakai', async () => {
    const a = await akunBaru();
    const tamu = akun.pastikanTamu('sid-lama', ctx);
    akun.vault.setIngatan(tamu, ingatan(['bahasa_sederhana']));
    akun.rotasiPemilik({ sidLama: 'sid-lama', sidBaru: 'sid-baru', userId: a.id });
    const g = bacaIngatan(akun.vault.getIngatan(a.id)!.data);
    expect(g.butir).toEqual([]);
    expect(g.dariTamu?.map((b) => b.jenis)).toEqual(['bahasa_sederhana']);
  });

  it('penyapu bersihkan() membuang titipan tamu yang kedaluwarsa (30 hari), yang masih berlaku tetap', async () => {
    const a = await akunBaru();
    const lansia = {
      id: 'ing_00000000000000d1',
      jenis: 'lansia',
      nilai: 'ya',
      at: new Date(t).toISOString(),
    };
    akun.vault.setIngatan(a.id, {
      versi: 1,
      butir: [{ ...lansia, id: 'ing_00000000000000d2', jenis: 'kanal', nilai: 'online' }],
      dariTamu: [lansia],
      dariTamuSejak: new Date(t).toISOString(),
    });
    t += 29 * 86_400_000;
    akun.bersihkan();
    expect(bacaIngatan(akun.vault.getIngatan(a.id)!.data).dariTamu).toHaveLength(1);
    t += 2 * 86_400_000;
    akun.bersihkan();
    const g = bacaIngatan(akun.vault.getIngatan(a.id)!.data);
    expect(g.dariTamu).toBeUndefined();
    expect(g.butir.map((b) => b.jenis)).toEqual(['kanal']);
  });

  it('ingatan akun yang rusak tidak ditimpa titipan dan tidak menggagalkan login', async () => {
    const a = await akunBaru();
    akun.vault.setIngatan(a.id, ingatan(['lansia']));
    const rusak = Buffer.alloc(40, 2);
    db.prepare('UPDATE vault_ingatan SET ciphertext = ? WHERE user_id = ?').run(rusak, a.id);
    const tamu = akun.pastikanTamu('sid-lama', ctx);
    akun.vault.setIngatan(tamu, ingatan(['kanal', 'online']));
    akun.rotasiPemilik({ sidLama: 'sid-lama', sidBaru: 'sid-baru', userId: a.id });
    const baris = db.prepare('SELECT ciphertext FROM vault_ingatan WHERE user_id = ?').get(a.id) as {
      ciphertext: Buffer;
    };
    expect(baris.ciphertext.equals(rusak)).toBe(true);
    expect(alert.some((p) => /tidak bisa dibuka/.test(p))).toBe(true);
  });
});
