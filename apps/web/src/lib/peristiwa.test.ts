import { describe, expect, it } from 'vitest';
import { PERISTIWA, URUSAN_LAIN, findPeristiwa } from './peristiwa';

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
