import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AkunError } from '@urusin/akun';
import { ESLint } from 'eslint';
import { MemoryMailer } from '@urusin/akun/testing';
import { DemoProvider } from '@urusin/harness';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRuntime, setRuntimeForTests, type Runtime } from '../runtime';
import { izinkanIsi, resolusiNilai } from './resolver';

const NIK = ['3201', '0101', '0190', '0002'].join('');
/** Portal `kirim-asli` di registry (allowlist tujuan isi); tes tidak menghubunginya. */
const SITUS = 'https://telunjuksakti.wonogirikab.go.id';
const FIXTURES = 'https://fixtures.urusinai.web.id';
const KTX = { ip: '127.0.0.1', userAgent: null };

let rt: Runtime;
let pemilik: string;

beforeEach(() => {
  rt = createRuntime({
    provider: new DemoProvider(),
    config: { dbPath: ':memory:', disconnectGraceMs: 0 },
    akun: { mailer: new MemoryMailer(), google: null, vault: { diskPersen: () => 10 } },
  });
  setRuntimeForTests(rt);
  pemilik = rt.akun.pastikanTamu('a'.repeat(32), KTX);
  rt.akun.vault.setDataDiri(pemilik, { namaLengkap: 'Warga Uji', nik: NIK, rt: '001' });
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

describe('penyelesai nilai PII', () => {
  it('token persetujuan → hanya field di daftar write, sekali pakai', () => {
    const writeList = ['nik', 'namaLengkap', 'hp'];
    const token = izinkanIsi(rt, pemilik, writeList, `${SITUS}/form?x=1`);
    const p = { ownerId: pemilik, token, writeList: ['hp', 'nik', 'namaLengkap'], targetOrigin: SITUS };
    // urutan daftar bebas; field yang tidak ada di Data Diri tidak ikut
    expect(resolusiNilai(rt, p)).toEqual({ nik: NIK, namaLengkap: 'Warga Uji' });
    expect(kode(() => resolusiNilai(rt, p))).toBe('IZIN_TIDAK_VALID');
  });

  it('daftar write, origin, atau pemilik berbeda dari persetujuan → IZIN_TIDAK_VALID', () => {
    const lain = rt.akun.pastikanTamu('b'.repeat(32), KTX);
    for (const ubah of [
      { writeList: ['nik', 'namaLengkap', 'rt'] },
      { targetOrigin: 'https://evil.example.com' },
      { ownerId: lain },
      { token: 'bukan-token' },
    ]) {
      const token = izinkanIsi(rt, pemilik, ['nik', 'namaLengkap'], SITUS);
      const p = { ownerId: pemilik, token, writeList: ['nik', 'namaLengkap'], targetOrigin: SITUS, ...ubah };
      expect([ubah, kode(() => resolusiNilai(rt, p))]).toEqual([ubah, 'IZIN_TIDAK_VALID']);
    }
  });

  it('kedaluwarsa setelah 5 menit', () => {
    let jam = Date.now();
    rt = createRuntime({
      provider: new DemoProvider(),
      config: { dbPath: ':memory:', disconnectGraceMs: 0 },
      akun: {
        mailer: new MemoryMailer(),
        google: null,
        now: () => new Date(jam),
        vault: { diskPersen: () => 10 },
      },
    });
    const id = rt.akun.pastikanTamu('c'.repeat(32), KTX);
    const token = izinkanIsi(rt, id, ['nik'], SITUS);
    jam += 6 * 60 * 1000;
    expect(
      kode(() => resolusiNilai(rt, { ownerId: id, token, writeList: ['nik'], targetOrigin: SITUS })),
    ).toBe('IZIN_TIDAK_VALID');
  });

  it('salinan demo (data sintetis) hanya boleh menuju situs latihan', () => {
    const { akun } = rt.akun.buatDemo(KTX);
    expect(kode(() => izinkanIsi(rt, akun.id, ['nik'], SITUS))).toBe('NILAI_SINTETIS_DITOLAK');
    const token = izinkanIsi(rt, akun.id, ['nik'], FIXTURES);
    const nilai = resolusiNilai(rt, { ownerId: akun.id, token, writeList: ['nik'], targetOrigin: FIXTURES });
    expect(Object.keys(nilai)).toEqual(['nik']);
  });

  it('salinan demo: data sintetis mengikuti wilayah urusan (SBY 3578/Surabaya, SMG 3374/Semarang)', () => {
    const { akun } = rt.akun.buatDemo(KTX);
    const writeList = ['nik', 'noKk', 'tempatLahir', 'kodeKabKota', 'namaLengkap'];
    const nilai = (kodeWilayah: string | null) => {
      const token = izinkanIsi(rt, akun.id, writeList, FIXTURES, { kodeWilayah });
      return resolusiNilai(rt, { ownerId: akun.id, token, writeList, targetOrigin: FIXTURES, kodeWilayah });
    };
    const sby = nilai('3578');
    expect(sby.nik!.slice(0, 4)).toBe('3578');
    expect(sby.noKk!.slice(0, 4)).toBe('3578');
    expect(sby).toMatchObject({ tempatLahir: 'Surabaya', kodeKabKota: '3578' });
    const smg = nilai('3374');
    expect(smg.nik!.slice(0, 4)).toBe('3374');
    expect(smg).toMatchObject({ tempatLahir: 'Semarang', kodeKabKota: '3374' });
    // Wonogiri / tanpa wilayah: templat bawaan; nama tidak bergantung wilayah.
    for (const k of ['3312', null]) {
      const w = nilai(k);
      expect(w.nik!.slice(0, 4)).toBe('3312');
      expect(w.tempatLahir).toBe('Wonogiri');
      expect(w.namaLengkap).toBe(sby.namaLengkap);
    }
    // Isian yang sudah diubah juri di Data Diri dipertahankan.
    const dd = rt.akun.vault.getDataDiri(akun.id)?.data ?? {};
    rt.akun.vault.setDataDiri(akun.id, { ...dd, tempatLahir: 'Klaten' });
    expect(nilai('3578')).toMatchObject({ tempatLahir: 'Klaten', kodeKabKota: '3578' });
  });

  it('akun warga biasa: Data Diri apa adanya, tidak diubah wilayah urusan', () => {
    const token = izinkanIsi(rt, pemilik, ['nik'], SITUS, { kodeWilayah: '3578' });
    expect(
      resolusiNilai(rt, {
        ownerId: pemilik,
        token,
        writeList: ['nik'],
        targetOrigin: SITUS,
        kodeWilayah: '3578',
      }),
    ).toEqual({ nik: NIK });
  });

  it('origin tujuan tidak valid ditolak', () => {
    expect(kode(() => izinkanIsi(rt, pemilik, ['nik'], 'bukan url'))).toBe('IZIN_TIDAK_VALID');
  });
});

describe('batas impor: penyelesai hanya dipanggil jalur isi Pendamping', () => {
  it('tidak ada berkas di luar src/lib/server/pendamping/** yang mengimpor vault/resolver', () => {
    const src = fileURLToPath(new URL('../../../', import.meta.url));
    const sendiri = [
      join('lib', 'server', 'vault', 'resolver.ts'),
      join('lib', 'server', 'vault', 'resolver.test.ts'),
      // Pemanggil sah kedua: nilai pemilik ditulis hanya ke berkas buatan agen di Dokumen pemilik itu sendiri.
      join('lib', 'server', 'vault', 'berkas.ts'),
    ];
    const izin = (rel: string) =>
      rel.startsWith(['lib', 'server', 'pendamping', ''].join(sep)) || sendiri.includes(rel);
    const pelanggar: string[] = [];
    const jelajah = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) jelajah(p);
        else if (/\.(ts|js|svelte)$/.test(n)) {
          const rel = relative(src, p);
          if (!izin(rel) && /vault\/resolver(\.js|\.ts)?['"]/.test(readFileSync(p, 'utf8')))
            pelanggar.push(rel);
        }
      }
    };
    jelajah(src);
    expect(pelanggar).toEqual([]);
  });

  it('PoC A-M1: kode peramban tidak membaca nilai vault untuk Pendamping (hanya {writeList, targetOrigin})', () => {
    const src = fileURLToPath(new URL('../../../', import.meta.url));
    const pelanggar: string[] = [];
    const jelajah = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) {
          if (relative(src, p) !== join('lib', 'server')) jelajah(p);
        } else if (/\.(ts|svelte)$/.test(n) && !n.endsWith('.test.ts')) {
          const isi = readFileSync(p, 'utf8');
          if (/kirimVault\(|kirimBerkas\(/.test(isi)) pelanggar.push(relative(src, p));
        }
      }
    };
    jelajah(src);
    expect(pelanggar).toEqual([]);
  });
});

describe('aturan lint no-restricted-imports untuk penyelesai', () => {
  const root = resolve(import.meta.dirname, '../../../../../..');
  const eslint = new ESLint({ cwd: root });
  const kode = `import { resolusiNilai } from '#lib/server/vault/resolver.js';
export const x = resolusiNilai;
`;
  const aturan = async (file: string) => {
    const [r] = await eslint.lintText(kode, { filePath: resolve(root, file) });
    return (r?.messages ?? []).map((m) => m.ruleId);
  };

  it('menolak impor dari rute/lib lain, mengizinkan jalur isi Pendamping', async () => {
    expect(await aturan('apps/web/src/routes/api/x/+server.ts')).toContain('no-restricted-imports');
    expect(await aturan('apps/web/src/lib/server/akun.ts')).toContain('no-restricted-imports');
    expect(await aturan('apps/web/src/lib/server/pendamping/isi.ts')).not.toContain('no-restricted-imports');
  }, 120_000);
});

describe('ikatan rencanaHash (Navigator generik)', () => {
  it('token untuk rencana A tidak berlaku untuk rencana B atau tanpa rencana', () => {
    const A = 'a'.repeat(64);
    for (const rencanaHash of ['b'.repeat(64), undefined]) {
      const token = izinkanIsi(rt, pemilik, ['nik'], SITUS, { rencanaHash: A });
      const p = { ownerId: pemilik, token, writeList: ['nik'], targetOrigin: SITUS, rencanaHash };
      expect(kode(() => resolusiNilai(rt, p))).toBe('IZIN_TIDAK_VALID');
    }
    const token = izinkanIsi(rt, pemilik, ['nik'], SITUS, { rencanaHash: A });
    const p = { ownerId: pemilik, token, writeList: ['nik'], targetOrigin: SITUS, rencanaHash: A };
    expect(resolusiNilai(rt, p)).toEqual({ nik: NIK });
    expect(kode(() => izinkanIsi(rt, pemilik, ['nik'], SITUS, { rencanaHash: 'bukan-hash' }))).toBe(
      'IZIN_TIDAK_VALID',
    );
  });
});
