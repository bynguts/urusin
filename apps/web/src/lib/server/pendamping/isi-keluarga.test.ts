import { AkunError } from '@urusin/akun';
import { MemoryMailer } from '@urusin/akun/testing';
import { DemoProvider } from '@urusin/harness';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  anggotaPeran,
  daftarWrite,
  fieldDataDiri,
  labelPlaceholder,
  nilaiIsian,
  petakanIsian,
} from '#lib/pendamping/isi-data.js';
import { penyimpanIngatan } from '../ingatan';
import { createRuntime, setRuntimeForTests, type Runtime } from '../runtime';
import { ambilIsianUntukIsi, izinkanIsiUrusan } from './isi';

/** NIK uji dirakit saat runtime (pii-scan menolak literal 16 digit). */
const nik = (d: string) => d.repeat(16);
const SITUS = 'https://telunjuksakti.wonogirikab.go.id';
const KTX = { ip: '127.0.0.1', userAgent: null };
const SID = 'b'.repeat(32);

let rt: Runtime;
let u1: string;
let tamu: string;

beforeEach(() => {
  rt = createRuntime({
    provider: new DemoProvider(),
    config: { dbPath: ':memory:', disconnectGraceMs: 0 },
    akun: { mailer: new MemoryMailer(), google: null, vault: { diskPersen: () => 10 } },
  });
  setRuntimeForTests(rt);
  tamu = rt.akun.pastikanTamu(SID, KTX);
  rt.akun.vault.setDataDiri(tamu, { namaLengkap: 'Warga Uji', nik: nik('1') });
  u1 = rt.store.createUrusan({ jenis: 'kelahiran' }).id;
  rt.akun.catatPemilikUrusan(u1, { sid: SID });
});
afterEach(() => setRuntimeForTests(undefined));

const tambah = (d: Record<string, unknown>) => rt.akun.vault.tambahAnggota(tamu, d).anggota;
const izin = (writeList: string[]) =>
  izinkanIsiUrusan(rt, { urusanId: u1, peminta: { sid: SID }, writeList, targetOrigin: SITUS });
const ambil = () => ambilIsianUntukIsi(rt, { urusanId: u1, liveOrigin: SITUS }).isian;

describe('placeholder anggota keluarga', () => {
  it('pemetaan per hubungan, alias pemohon, dan yang bukan data brankas', () => {
    expect(fieldDataDiri('{{AYAH.NAMA}}')).toBe('ayah.namaLengkap');
    expect(fieldDataDiri('{{IBU.NIK}}')).toBe('ibu.nik');
    expect(fieldDataDiri('{{ANAK.TGL_LAHIR}}')).toBe('anak.tanggalLahir');
    expect(fieldDataDiri('{{ANAK.TANGGAL_LAHIR}}')).toBe('anak.tanggalLahir');
    expect(fieldDataDiri('{{PASANGAN.JK}}')).toBe('pasangan.jenisKelamin');
    expect(fieldDataDiri('{{ANAK.TEMPAT_LAHIR}}')).toBe('anak.tempatLahir');
    expect(fieldDataDiri('{{PEMOHON.NAMA_IBU}}')).toBe('ibu.namaLengkap');
    expect(fieldDataDiri('{{PEMOHON.AYAH.NAMA}}')).toBe('ayah.namaLengkap');
    expect(fieldDataDiri('{{PEMOHON.NIK}}')).toBe('nik');
    for (const p of [
      '{{ORANG2.NIK}}',
      '{{ANAK.AYAH.NAMA}}',
      '{{PEMOHON.ALAMAT.RT}}',
      '{{ANAK.HP}}',
      '{{KAKEK.NIK}}',
      '{{PEMOHON.ANAK.NIK}}',
      '{{ANAK.constructor}}',
    ])
      expect([p, fieldDataDiri(p)]).toEqual([p, undefined]);
    expect(labelPlaceholder('{{IBU.NIK}}')).toBe('NIK ibu');
    expect(labelPlaceholder('{{ANAK.TGL_LAHIR}}')).toBe('Tanggal lahir anak');
    expect(labelPlaceholder('{{PEMOHON.NAMA_IBU}}')).toBe('Nama lengkap ibu');
  });

  it('anggota per peran: pasangan dari suami/istri, anak otomatis bila satu, pilihan bila banyak', () => {
    const a = [
      { id: 'agt_1', hubungan: 'istri', namaLengkap: 'P' },
      { id: 'agt_2', hubungan: 'anak', namaLengkap: 'A1' },
      { id: 'agt_3', hubungan: 'ibu', namaLengkap: 'I' },
    ];
    expect(Object.keys(anggotaPeran(a)).sort()).toEqual(['anak', 'ibu', 'pasangan']);
    const dua = [...a, { id: 'agt_4', hubungan: 'anak', namaLengkap: 'A2' }];
    expect(anggotaPeran(dua).anak).toBeUndefined();
    expect(anggotaPeran(dua, 'agt_4').anak?.namaLengkap).toBe('A2');
    expect(anggotaPeran(dua, 'agt_1').anak).toBeUndefined(); // bukan anak
    expect(nilaiIsian({ nik: 'x', kosong: '' }, dua, 'agt_2')).toEqual({
      nik: 'x',
      'pasangan.namaLengkap': 'P',
      'anak.namaLengkap': 'A1',
      'ibu.namaLengkap': 'I',
    });
    expect(petakanIsian(['{{IBU.NAMA}}', '{{AYAH.NAMA}}'], nilaiIsian({}, dua))).toEqual({
      isian: { '{{IBU.NAMA}}': 'I' },
      kurang: ['Nama lengkap ayah'],
    });
  });

  it('daftar write: placeholder keluarga ikut; anak:<id> hanya bila ada {{ANAK.*}}', () => {
    const id = `agt_${'e'.repeat(32)}`;
    expect(daftarWrite(['{{IBU.NIK}}', '{{URUSAN.KITIR}}'], ['akta'], id)).toEqual([
      '{{IBU.NIK}}',
      'berkas:AKTA',
    ]);
    expect(daftarWrite(['{{ANAK.NAMA}}', '{{ANAK.NIK}}'], [], id)).toEqual([
      '{{ANAK.NAMA}}',
      '{{ANAK.NIK}}',
      `anak:${id}`,
    ]);
  });
});

describe('jalur isi Pendamping dengan data keluarga', () => {
  it('akta kelahiran: ayah, ibu, satu anak otomatis; nilai hanya keluar setelah izin, sekali', () => {
    tambah({ hubungan: 'ayah', namaLengkap: 'Budi Ayah', nik: nik('2') });
    tambah({ hubungan: 'ibu', namaLengkap: 'Sari Ibu', nik: nik('3'), tanggalLahir: '1995-05-05' });
    tambah({
      hubungan: 'anak',
      namaLengkap: 'Bayi Uji',
      tanggalLahir: '2026-10-01',
      jenisKelamin: 'perempuan',
    });
    const w = [
      '{{AYAH.NIK}}',
      '{{IBU.NIK}}',
      '{{IBU.TGL_LAHIR}}',
      '{{ANAK.NAMA}}',
      '{{ANAK.JK}}',
      '{{ANAK.TEMPAT_LAHIR}}',
      '{{PEMOHON.NAMA_IBU}}',
    ];
    expect(izin(w)).toEqual({ kurang: ['Tempat lahir anak'] });
    expect(ambil()).toEqual({
      '{{AYAH.NIK}}': nik('2'),
      '{{IBU.NIK}}': nik('3'),
      '{{IBU.TGL_LAHIR}}': '1995-05-05',
      '{{ANAK.NAMA}}': 'Bayi Uji',
      '{{ANAK.JK}}': 'perempuan',
      '{{PEMOHON.NAMA_IBU}}': 'Sari Ibu',
    });
    expect(() => ambil()).toThrow(AkunError);
  });

  it('lebih dari satu anak: tanpa pilihan = warga isi sendiri; anak:<id> memilih anak yang dimaksud', () => {
    tambah({ hubungan: 'anak', namaLengkap: 'Kakak', nik: nik('4') });
    const adik = tambah({ hubungan: 'anak', namaLengkap: 'Adik', nik: nik('5') });
    expect(izin(['{{ANAK.NIK}}'])).toEqual({ kurang: ['NIK anak'] });
    expect(ambil()).toEqual({});
    expect(izin(['{{ANAK.NIK}}', `anak:${adik.id}`])).toEqual({ kurang: [] });
    expect(ambil()).toEqual({ '{{ANAK.NIK}}': nik('5') });
  });

  it('anak:<id> asing atau rusak ditolak / tidak membocorkan anggota lain', () => {
    tambah({ hubungan: 'anak', namaLengkap: 'Satu', nik: nik('6') });
    const ibu = tambah({ hubungan: 'ibu', namaLengkap: 'Ibu' });
    expect(() => izin(['{{ANAK.NIK}}', 'anak:../../x'])).toThrow(AkunError);
    // id anggota bukan anak: anak yang dimaksud tidak ada, nilainya tidak keluar
    expect(izin(['{{ANAK.NIK}}', `anak:${ibu.id}`])).toEqual({ kurang: ['NIK anak'] });
    expect(ambil()).toEqual({});
  });

  it('isi anggota yang tidak sah menurut kontrak dilewati, tidak melempar', () => {
    rt.akun.vault.tambahAnggota(tamu, { hubungan: 'ibu', namaLengkap: '', nik: 'bukan-nik' });
    expect(izin(['{{IBU.NIK}}'])).toEqual({ kurang: ['NIK ibu'] });
  });

  it('ringkasan ketersediaan untuk agen: tanpa nilai', () => {
    tambah({ hubungan: 'ibu', namaLengkap: 'Sari Ibu', nik: nik('3') });
    const p = penyimpanIngatan(() => rt.akun);
    const r = p.ketersediaanData!(tamu);
    expect(r).toEqual({ dataDiri: true, ayah: false, ibu: true, pasangan: false, anak: 0, lainnya: 0 });
    expect(JSON.stringify(r)).not.toContain('Sari');
  });
});
