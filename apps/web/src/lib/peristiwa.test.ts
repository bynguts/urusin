import { describe, expect, it } from 'vitest';
import { PERISTIWA, URUSAN_LAIN, findPeristiwa, peristiwaDariJenis } from './peristiwa';

describe('Peristiwa Hidup', () => {
  it('memuat empat peristiwa utama dengan urutan tetap', () => {
    expect(PERISTIWA.map((p) => p.judul)).toEqual(['Kelahiran', 'Kematian', 'Perkawinan', 'Pindah domisili']);
  });
  it('slug unik dan aman untuk URL', () => {
    const slugs = [...PERISTIWA, URUSAN_LAIN].map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z-]+$/);
  });
  it('findPeristiwa menemukan urusan lain dan menolak slug asing', () => {
    expect(findPeristiwa('lainnya')?.judul).toBe('Urusan lain');
    expect(findPeristiwa('../admin')).toBeUndefined();
  });
});

describe('lencana mengikuti jenis urusan', () => {
  it('peristiwa hidup memakai lencananya sendiri, bukan "KTP & dokumen"', () => {
    expect(peristiwaDariJenis('kelahiran').lencana).toBe('Kelahiran');
    expect(peristiwaDariJenis('pindah').lencana).toBe('Pindah rumah');
    expect(peristiwaDariJenis('kematian').lencana).toBe('Kehilangan keluarga');
    expect(peristiwaDariJenis('perkawinan').lencana).toBe('Menikah');
  });
  it('jenis lain memakai label jenisnya; "KTP & dokumen" hanya bila jenis belum diketahui', () => {
    expect(peristiwaDariJenis('ktp').lencana).toBe('KTP elektronik');
    expect(peristiwaDariJenis('skck').lencana).toBe('SKCK');
    expect(peristiwaDariJenis('pajak_kendaraan').lencana).toBe('Pajak kendaraan');
    expect(peristiwaDariJenis('sim_baru').lencana).toBe('Sim baru');
    expect(peristiwaDariJenis('sim_baru').icon).toBe('lainnya');
    expect(peristiwaDariJenis(null)).toBe(URUSAN_LAIN);
    expect(peristiwaDariJenis('')).toBe(URUSAN_LAIN);
  });
});
