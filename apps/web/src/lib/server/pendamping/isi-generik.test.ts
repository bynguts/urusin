import { AkunError } from '@urusin/akun';
import { MemoryMailer } from '@urusin/akun/testing';
import { DemoProvider, portalWebWilayah } from '@urusin/harness';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRuntime, setRuntimeForTests, type Runtime } from '../runtime';
import { ambilIsianUntukIsi, izinkanIsiUrusan } from './isi';

const NIK = ['3374', '0101', '0190', '0002'].join('');
const KTX = { ip: '127.0.0.1', userAgent: null };
const SID = 'a'.repeat(32);
/** Portal web Kota Semarang menurut registry wilayah (tes tidak menghubunginya). */
const SMG = portalWebWilayah('3374')!.origin;
const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);

let rt: Runtime;
let tamu: string;
let u3: string;

beforeEach(() => {
  rt = createRuntime({
    provider: new DemoProvider(),
    config: { dbPath: ':memory:', disconnectGraceMs: 0 },
    akun: { mailer: new MemoryMailer(), google: null, vault: { diskPersen: () => 10 } },
  });
  setRuntimeForTests(rt);
  tamu = rt.akun.pastikanTamu(SID, KTX);
  rt.akun.vault.setDataDiri(tamu, { namaLengkap: 'Warga Uji', nik: NIK });
  u3 = rt.store.createUrusan({ jenis: 'kelahiran', kodeKabKota: '3374' }).id;
  rt.akun.catatPemilikUrusan(u3, { sid: SID });
});
afterEach(() => {
  setRuntimeForTests(undefined);
});

const kode = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof AkunError ? e.kode : String(e);
  }
  return 'tidak melempar';
};

const izinSmg = (o: Partial<Parameters<typeof izinkanIsiUrusan>[1]> = {}) =>
  izinkanIsiUrusan(rt, {
    urusanId: u3,
    peminta: { sid: SID },
    writeList: ['{{PEMOHON.NIK}}'],
    targetOrigin: SMG,
    rencanaHash: H1,
    ...o,
  });

describe('Navigator generik: portal milik wilayah urusan + persetujuan terikat rencanaHash', () => {
  it('portal wilayah KTP urusan boleh; nilai keluar hanya untuk rencanaHash yang disetujui', () => {
    izinSmg();
    expect(
      ambilIsianUntukIsi(rt, { urusanId: u3, liveOrigin: `${SMG}/form`, rencanaHash: H1 }).isian,
    ).toEqual({
      '{{PEMOHON.NIK}}': NIK,
    });
  });

  it('rencanaHash berbeda atau hilang → IZIN_TIDAK_VALID, persetujuan hangus', () => {
    for (const rencanaHash of [H2, undefined]) {
      izinSmg();
      expect(kode(() => ambilIsianUntukIsi(rt, { urusanId: u3, liveOrigin: SMG, rencanaHash }))).toBe(
        'IZIN_TIDAK_VALID',
      );
      expect(kode(() => ambilIsianUntukIsi(rt, { urusanId: u3, liveOrigin: SMG, rencanaHash: H1 }))).toBe(
        'IZIN_TIDAK_VALID',
      );
    }
  });

  it('portal wilayah lain, urusan tanpa wilayah, atau http → ditolak', () => {
    const uWng = rt.store.createUrusan({ jenis: 'kelahiran', kodeKabKota: '3312' }).id;
    const uTanpa = rt.store.createUrusan({ jenis: 'kelahiran' }).id;
    for (const urusanId of [uWng, uTanpa]) {
      rt.akun.catatPemilikUrusan(urusanId, { sid: SID });
      expect(kode(() => izinSmg({ urusanId }))).toBe('IZIN_TIDAK_VALID');
    }
    expect(kode(() => izinSmg({ targetOrigin: SMG.replace('https:', 'http:') }))).toBe('IZIN_TIDAK_VALID');
  });

  it('akun demo tetap ditolak di portal wilayah (hanya situs latihan)', () => {
    const { akun } = rt.akun.buatDemo(KTX);
    const u4 = rt.store.createUrusan({ jenis: 'kelahiran', kodeKabKota: '3374' }).id;
    rt.akun.catatPemilikUrusan(u4, { akun });
    expect(kode(() => izinSmg({ urusanId: u4, peminta: { akun } }))).toBe('NILAI_SINTETIS_DITOLAK');
  });
});
