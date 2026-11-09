import { AkunError, hashDaftarWrite } from '@urusin/akun';
import { MemoryMailer } from '@urusin/akun/testing';
import { DemoProvider } from '@urusin/harness';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRuntime, setRuntimeForTests, type Runtime } from '../runtime';
import { izinkanIsiUrusan, nilaiIsiUrusan } from './isi';

const NIK = ['3201', '0101', '0190', '0002'].join('');
const SITUS = 'https://contoh-layanan.example.com';
const FIXTURES = 'https://fixtures.urusinai.web.id';
const KTX = { ip: '127.0.0.1', userAgent: null };
const SID = 'a'.repeat(32);
const WRITE = ['nik', 'namaLengkap'];

let rt: Runtime;
let u1: string;

beforeEach(() => {
  rt = createRuntime({
    provider: new DemoProvider(),
    config: { dbPath: ':memory:', disconnectGraceMs: 0 },
    akun: { mailer: new MemoryMailer(), google: null, vault: { diskPersen: () => 10 } },
  });
  setRuntimeForTests(rt);
  const tamu = rt.akun.pastikanTamu(SID, KTX);
  rt.akun.vault.setDataDiri(tamu, { namaLengkap: 'Warga Uji', nik: NIK, rt: '001' });
  u1 = rt.store.createUrusan({ jenis: 'kelahiran' }).id;
  rt.akun.catatPemilikUrusan(u1, { sid: SID });
});
afterEach(() => setRuntimeForTests(undefined));

const kode = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof AkunError ? e.kode : String(e);
  }
  return 'tidak melempar';
};

const izin = (o: Partial<Parameters<typeof izinkanIsiUrusan>[1]> = {}) =>
  izinkanIsiUrusan(rt, {
    urusanId: u1,
    peminta: { sid: SID },
    writeListHash: hashDaftarWrite(WRITE),
    writeList: WRITE,
    targetOrigin: SITUS,
    ...o,
  });

describe('jalur isi Pendamping (A-M1)', () => {
  it('pemilik menyetujui hash daftar write → nilai hanya di server, token sekali pakai', () => {
    const token = izin();
    const p = { urusanId: u1, peminta: { sid: SID }, token, writeList: WRITE, targetOrigin: SITUS };
    expect(nilaiIsiUrusan(rt, p)).toEqual({ nik: NIK, namaLengkap: 'Warga Uji' });
    expect(kode(() => nilaiIsiUrusan(rt, p))).toBe('IZIN_TIDAK_VALID');
  });

  it('bukan pemilik, urusan tak dikenal, atau hash persetujuan berbeda → IZIN_TIDAK_VALID', () => {
    for (const ubah of [
      { peminta: { sid: 'b'.repeat(32) } },
      { peminta: {} },
      { urusanId: 'u-lain' },
      { writeListHash: hashDaftarWrite(['nik']) },
      { writeList: [...WRITE, 'hp'] },
    ])
      expect([ubah, kode(() => izin(ubah))]).toEqual([ubah, 'IZIN_TIDAK_VALID']);
    // token sah tetap tidak bisa dipakai peminta lain
    const token = izin();
    expect(
      kode(() =>
        nilaiIsiUrusan(rt, {
          urusanId: u1,
          peminta: { sid: 'b'.repeat(32) },
          token,
          writeList: WRITE,
          targetOrigin: SITUS,
        }),
      ),
    ).toBe('IZIN_TIDAK_VALID');
  });

  it('urusan milik akun (salinan juri): hanya akun itu, dan data sintetis hanya ke situs latihan', () => {
    const { akun } = rt.akun.buatDemo(KTX);
    const { akun: lain } = rt.akun.buatDemo({ ...KTX, ip: '127.0.0.2' });
    const u2 = rt.store.createUrusan({ jenis: 'kelahiran' }).id;
    rt.akun.catatPemilikUrusan(u2, { akun });
    const base = { urusanId: u2, writeListHash: hashDaftarWrite(['nik']), writeList: ['nik'] };
    expect(
      kode(() => izinkanIsiUrusan(rt, { ...base, peminta: { akun: lain }, targetOrigin: FIXTURES })),
    ).toBe('IZIN_TIDAK_VALID');
    expect(kode(() => izinkanIsiUrusan(rt, { ...base, peminta: { akun }, targetOrigin: SITUS }))).toBe(
      'NILAI_SINTETIS_DITOLAK',
    );
    const token = izinkanIsiUrusan(rt, { ...base, peminta: { akun }, targetOrigin: FIXTURES });
    const nilai = nilaiIsiUrusan(rt, {
      urusanId: u2,
      peminta: { akun },
      token,
      writeList: ['nik'],
      targetOrigin: FIXTURES,
    });
    expect(Object.keys(nilai)).toEqual(['nik']);
  });
});
