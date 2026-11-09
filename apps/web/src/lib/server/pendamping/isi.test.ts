import { AkunError } from '@urusin/akun';
import { MemoryMailer } from '@urusin/akun/testing';
import { DemoProvider } from '@urusin/harness';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST as izinkanApi } from '../../../routes/api/urusan/[id]/izinkan-isi/+server';
import { createRuntime, setRuntimeForTests, type Runtime } from '../runtime';
import { ambilIsianUntukIsi, izinkanIsiUrusan } from './isi';

const NIK = ['3201', '0101', '0190', '0002'].join('');
const SITUS = 'https://contoh-layanan.example.com';
const FIXTURES = 'https://fixtures.urusinai.web.id';
const ORIGIN = 'http://localhost:5173';
const KTX = { ip: '127.0.0.1', userAgent: null };
const SID = 'a'.repeat(32);
const WRITE = ['{{PEMOHON.NIK}}', '{{PEMOHON.NAMA_LENGKAP}}', '{{PEMOHON.HP}}', 'berkas:KTP'];

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
  rt.akun.vault.setDataDiri(tamu, { namaLengkap: 'Warga Uji', nik: NIK, rt: '001' });
  rt.akun.vault.putDocument(tamu, {
    jenis: 'ktp',
    judul: 'KTP saya',
    mime: 'image/png',
    bytes: Buffer.from([1, 2, 3]),
  });
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
  izinkanIsiUrusan(rt, { urusanId: u1, peminta: { sid: SID }, writeList: WRITE, targetOrigin: SITUS, ...o });

describe('jalur isi Pendamping (A-M1)', () => {
  it('peramban hanya mengirim {writeList, targetOrigin}; nilai + berkas diambil Pendamping di server, sekali', () => {
    expect(izin()).toEqual({ kurang: ['Nomor HP'] });
    const isian = ambilIsianUntukIsi(rt, { urusanId: u1, liveOrigin: `${SITUS}/formulir?langkah=2` });
    expect(isian.isian).toEqual({ '{{PEMOHON.NIK}}': NIK, '{{PEMOHON.NAMA_LENGKAP}}': 'Warga Uji' });
    expect(isian.berkas.map((b) => [b.nama, b.judul, b.mime, [...b.bytes]])).toEqual([
      ['KTP', 'KTP saya', 'image/png', [1, 2, 3]],
    ]);
    expect(kode(() => ambilIsianUntukIsi(rt, { urusanId: u1, liveOrigin: SITUS }))).toBe('IZIN_TIDAK_VALID');
  });

  it('origin halaman hidup harus sama dengan targetOrigin persetujuan', () => {
    izin();
    expect(
      kode(() => ambilIsianUntukIsi(rt, { urusanId: u1, liveOrigin: 'https://evil.example.com/x' })),
    ).toBe('IZIN_TIDAK_VALID');
    // persetujuan hangus setelah percobaan origin salah
    expect(kode(() => ambilIsianUntukIsi(rt, { urusanId: u1, liveOrigin: SITUS }))).toBe('IZIN_TIDAK_VALID');
  });

  it('bukan pemilik atau urusan tak dikenal → IZIN_TIDAK_VALID; daftar write dibatasi', () => {
    for (const ubah of [{ peminta: { sid: 'b'.repeat(32) } }, { peminta: {} }, { urusanId: 'u-lain' }])
      expect([ubah, kode(() => izin(ubah))]).toEqual([ubah, 'IZIN_TIDAK_VALID']);
    expect(kode(() => izin({ writeList: ['{{PEMOHON.NIK}}', 'tidak-dikenal'] }))).toBe('IZIN_TIDAK_VALID');
    expect(kode(() => ambilIsianUntukIsi(rt, { urusanId: u1, liveOrigin: SITUS }))).toBe('IZIN_TIDAK_VALID');
  });

  it('salinan juri: data sintetis hanya menuju situs latihan', () => {
    const { akun } = rt.akun.buatDemo(KTX);
    const u2 = rt.store.createUrusan({ jenis: 'kelahiran' }).id;
    rt.akun.catatPemilikUrusan(u2, { akun });
    const base = { urusanId: u2, peminta: { akun }, writeList: ['{{PEMOHON.NIK}}'] };
    expect(kode(() => izinkanIsiUrusan(rt, { ...base, targetOrigin: SITUS }))).toBe('NILAI_SINTETIS_DITOLAK');
    izinkanIsiUrusan(rt, { ...base, targetOrigin: FIXTURES });
    expect(Object.keys(ambilIsianUntukIsi(rt, { urusanId: u2, liveOrigin: FIXTURES }).isian)).toEqual([
      '{{PEMOHON.NIK}}',
    ]);
  });

  it('API POST /api/urusan/[id]/izinkan-isi: tanpa nilai di respons; bukan pemilik 404', async () => {
    const ev = (body: unknown, sid: string) =>
      ({
        request: new Request(`${ORIGIN}/api/urusan/${u1}/izinkan-isi`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: ORIGIN },
          body: JSON.stringify(body),
        }),
        params: { id: u1 },
        locals: { sid },
        cookies: { get: () => undefined },
        getClientAddress: () => '127.0.0.1',
      }) as never;
    const r = await izinkanApi(ev({ writeList: WRITE, targetOrigin: SITUS }, SID));
    const body = await r.json();
    expect([r.status, body]).toEqual([200, { diizinkan: true, kurang: ['Nomor HP'] }]);
    expect(JSON.stringify(body)).not.toContain(NIK);
    expect((await izinkanApi(ev({ writeList: WRITE, targetOrigin: SITUS }, 'b'.repeat(32)))).status).toBe(
      404,
    );
    expect((await izinkanApi(ev({ writeList: 'nik', targetOrigin: SITUS }, SID))).status).toBe(422);
  });
});
