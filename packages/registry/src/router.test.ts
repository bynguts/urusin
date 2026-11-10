import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CityEntrySchema,
  RegistryError,
  SEED_ENTRIES,
  createRouter,
  kodeFromNik,
  routeByKode,
  routeByNik,
} from './index.js';

type Wilayah = { kabkota: { kode: string; nama: string }[] };
const wilayah: Wilayah = JSON.parse(
  readFileSync(new URL('../../../data/wilayah/kabkota.json', import.meta.url), 'utf8'),
);
const nama = new Map(wilayah.kabkota.map((k) => [k.kode, k.nama]));

describe('kodeFromNik', () => {
  it('mengambil empat digit pertama', () => {
    expect(kodeFromNik('3312000000000000')).toBe('3312');
  });
  it.each(['', '123', '33120000000000001', '33120000000000AB', '3312 000000000000', '33.1200000000000'])(
    'menolak NIK tidak valid %j',
    (bad) => {
      expect(() => kodeFromNik(bad)).toThrow(RegistryError);
    },
  );
  it('menolak non-string', () => {
    expect(() => kodeFromNik(3312000000000000 as unknown as string)).toThrow(RegistryError);
    expect(() => kodeFromNik(null as unknown as string)).toThrow(RegistryError);
  });
  it('pesan galat tidak membocorkan masukan', () => {
    const nik = '3312ABCD00000000';
    try {
      kodeFromNik(nik);
      expect.unreachable();
    } catch (e) {
      const err = e as RegistryError;
      expect(err.code).toBe('NIK_INVALID');
      expect(err.message).not.toContain('3312');
      expect(JSON.stringify(err)).not.toContain('3312');
      expect(String(err.stack)).not.toContain(nik);
    }
  });
});

describe('routeByNik', () => {
  it('Wonogiri -> semi kirim-asli', () => {
    const r = routeByNik('3312000000000000');
    expect(r.terdaftar).toBe(true);
    expect(r.entry.tier).toBe('semi');
    expect(r.entry.validasi).toBe('kirim-asli');
  });
  it('Surabaya dan Semarang -> dipandu; adapter baca-saja (cek status) tetap ada', () => {
    expect(routeByNik('3578000000000000').entry).toMatchObject({
      tier: 'dipandu',
      adapterId: 'klampid-surabaya',
    });
    expect(routeByNik('3578000000000000').entry.validasi).toBe('read-only');
    expect(routeByNik('3374000000000000').entry.validasi).toBe('read-only');
  });
  it('kode tanpa entri -> dipandu default', () => {
    const r = routeByNik('1101000000000000');
    expect(r.terdaftar).toBe(false);
    expect(r.entry.tier).toBe('dipandu');
    expect(r.entry.portal).toBeUndefined();
    expect(CityEntrySchema.safeParse(r.entry).success).toBe(true);
  });
  it('hasil tidak memuat sisa NIK setelah empat digit', () => {
    const nik = '3312123456789012';
    expect(JSON.stringify(routeByNik(nik))).not.toContain(nik.slice(4));
  });
  it('memakai nama wilayah resmi untuk fallback', () => {
    const r = createRouter({ namaWilayah: nama }).routeByNik('1101000000000000');
    expect(r.entry.nama).toBe('Kabupaten Aceh Selatan');
  });
});

describe('routeByKode', () => {
  it('menolak kode bukan 4 digit', () => {
    for (const bad of ['33', '33.12', '33120', 'abcd', '']) {
      expect(() => routeByKode(bad)).toThrow(RegistryError);
    }
  });
});

describe('createRouter', () => {
  it('menolak kode ganda', () => {
    const e = SEED_ENTRIES[0]!;
    expect(() => createRouter({ entries: [e, e] })).toThrow();
  });
  it('menolak entri tidak valid', () => {
    expect(() => createRouter({ entries: [{ ...SEED_ENTRIES[0]!, kodeKabKota: '12' }] })).toThrow();
  });
});

describe('seed registry', () => {
  it('semua entri lolos zod dan kodenya ada di dataset Kepmendagri', () => {
    for (const e of SEED_ENTRIES) {
      expect(CityEntrySchema.safeParse(e).success).toBe(true);
      expect(nama.has(e.kodeKabKota), e.kodeKabKota).toBe(true);
    }
  });
  it('nama seed cocok dengan dataset resmi', () => {
    for (const e of SEED_ENTRIES) expect(e.nama).toBe(nama.get(e.kodeKabKota));
  });
  it('setiap kab/kota dalam dataset menghasilkan entri valid', () => {
    const r = createRouter({ namaWilayah: nama });
    for (const k of wilayah.kabkota) {
      expect(CityEntrySchema.safeParse(r.routeByKode(k.kode).entry).success, k.kode).toBe(true);
    }
  });
  it('verifiedAt null; tier semi HANYA bila ada adapter TULIS (kirim-asli); baca-saja = dipandu', () => {
    for (const e of SEED_ENTRIES) {
      expect(e.verifiedAt).toBeNull();
      expect(e.tier === 'semi', e.nama).toBe(e.adapterId !== undefined && e.validasi === 'kirim-asli');
    }
  });
  it('hanya Wonogiri berstatus kirim-asli', () => {
    expect(SEED_ENTRIES.filter((e) => e.validasi === 'kirim-asli').map((e) => e.kodeKabKota)).toEqual([
      '3312',
    ]);
  });
  it('semi punya portal; dipandu tidak kirim-asli', () => {
    for (const e of SEED_ENTRIES) {
      if (e.tier === 'semi') expect(e.portal).toBeDefined();
      if (e.tier === 'dipandu') expect(e.validasi).not.toBe('kirim-asli');
    }
  });
  it('tidak memuat PII (nomor telepon / NIK)', () => {
    const s = JSON.stringify(SEED_ENTRIES);
    expect(s).not.toMatch(/\d{12,}/);
    expect(s).not.toMatch(/\+62|wa\.me/);
  });
});
