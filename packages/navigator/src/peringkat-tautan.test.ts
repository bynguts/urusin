import type { ElemenAmatan } from '@urusin/contracts';
import { normalisasi, PROFIL_MODEL, type Penyemat } from '@urusin/embedding';
import { describe, expect, it } from 'vitest';
import { buatPeringkatTautan } from './peringkat-tautan.js';
import { pesanRencana } from './prompt.js';
import { halaman } from './testing.js';

/** Penyemat palsu: sumbu per kata kunci, sehingga urutan kemiripan bisa diperkirakan. */
const SUMBU = ['lahir', 'mati', 'pindah'];
const penyemat = (o: { mati?: boolean } = {}): Penyemat & { dilihat: string[] } => {
  const dilihat: string[] = [];
  return {
    dilihat,
    semat(teks) {
      dilihat.push(...teks);
      if (o.mati) return Promise.resolve(null);
      return Promise.resolve(
        teks.map((t) => normalisasi([...SUMBU.map((s) => (t.toLowerCase().includes(s) ? 1 : 0)), 0.1])!),
      );
    },
  };
};

const tautan = (ref: string, nama: string, extra: Partial<ElemenAmatan> = {}): ElemenAmatan => ({
  ref,
  peran: 'tautan',
  nama,
  kelas: 'navigasi',
  ...extra,
});

const p = halaman({
  elemen: [
    tautan('e1', 'Pindah Datang'),
    tautan('e2', 'Akta Kematian'),
    tautan('e3', 'Akta Kelahiran'),
    tautan('e4', 'Berita'),
    { ref: 'e5', peran: 'teks', nama: 'Nama lahir ibu' },
    tautan('e6', 'Masuk lahir', { terlarang: 'sandi' }),
  ],
});

describe('buatPeringkatTautan', () => {
  it('mengurutkan tautan/tombol menurut tujuan dan hanya mengeluarkan ref (tanpa teks halaman)', async () => {
    const s = penyemat();
    const r = await buatPeringkatTautan(s, PROFIL_MODEL.harrier)(p, 'Kelahiran: akta lahir');
    expect(r).toMatch(/: e3, /);
    expect(r).not.toMatch(/Akta|Berita|Pindah/);
    // Kolom isian dan elemen terlarang tidak ikut diperingkat.
    expect(s.dilihat).not.toContain('Nama lahir ibu');
    expect(s.dilihat).not.toContain('Masuk lahir');
    expect(s.dilihat[0]).toMatch(/^Instruct: .*\nQuery: Kelahiran: akta lahir$/);
  });

  it('fail-open: sidecar mati, penyemat melempar, atau kandidat terlalu sedikit = null', async () => {
    expect(
      await buatPeringkatTautan(penyemat({ mati: true }), PROFIL_MODEL.harrier)(p, 'Kelahiran'),
    ).toBeNull();
    const lempar: Penyemat = { semat: () => Promise.reject(new Error('x')) };
    expect(await buatPeringkatTautan(lempar, PROFIL_MODEL.harrier)(p, 'Kelahiran')).toBeNull();
    const sedikit = halaman({ elemen: [tautan('e1', 'Akta Kelahiran'), tautan('e2', 'Berita')] });
    expect(await buatPeringkatTautan(penyemat(), PROFIL_MODEL.harrier)(sedikit, 'Kelahiran')).toBeNull();
  });

  it('prompt: baris peringkat ikut bila ada, prompt identik bila tidak ada', () => {
    const tanpa = pesanRencana({ pengamatan: p, tujuan: 'Kelahiran', nonce: 'n' });
    const kosong = pesanRencana({ pengamatan: p, tujuan: 'Kelahiran', nonce: 'n', petunjukTautan: null });
    expect(kosong).toEqual(tanpa);
    const dengan = pesanRencana({
      pengamatan: p,
      tujuan: 'Kelahiran',
      nonce: 'n',
      petunjukTautan: 'PERINGKAT TAUTAN: e3',
    });
    expect(dengan[1]!.content).toContain('\nPERINGKAT TAUTAN: e3');
  });
});
