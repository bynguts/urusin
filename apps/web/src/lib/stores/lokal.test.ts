import { describe, expect, it } from 'vitest';
import { LokalStore, bersihkanLokal, namaPendek } from './lokal.svelte.js';

const ID = `u_${'a'.repeat(32)}`;
const ID2 = `u_${'b'.repeat(32)}`;

function gudang() {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe('bersihkanLokal', () => {
  it('membuang entri tidak valid; tanpa pilihan valid wilayah kosong (bukan Wonogiri diam-diam)', () => {
    const d = bersihkanLokal({
      urusan: [
        { id: ID, judul: 'Akta', dibuatPada: 'x' },
        { id: 'bukan-id', judul: 'x', dibuatPada: 'x' },
        null,
      ],
      wilayah: { kodeKabKota: '12', nama: 'x' },
      kontrasTinggi: 'ya',
    });
    expect(d.urusan).toEqual([{ id: ID, judul: 'Akta', peristiwa: null, dibuatPada: 'x' }]);
    expect(d.wilayah).toBeNull();
    expect(bersihkanLokal(null).wilayah).toBeNull();
    expect(d.kontrasTinggi).toBe(false);
  });

  it('default Wonogiri lama di localStorage (tanpa versiWilayah) diabaikan; pilihan baru dipertahankan', () => {
    const lama = { wilayah: { kodeKabKota: '3312', nama: 'Kab. Wonogiri' }, urusan: [] };
    expect(bersihkanLokal(lama).wilayah).toBeNull();
    const baru = { versiWilayah: 2, wilayah: { kodeKabKota: '3312', nama: 'Kab. Wonogiri' } };
    expect(bersihkanLokal(baru).wilayah).toEqual({ kodeKabKota: '3312', nama: 'Kab. Wonogiri' });
    const g = gudang();
    g.setItem('urusin.lokal.v1', JSON.stringify(lama));
    const s = new LokalStore(g);
    expect(s.data.wilayah).toBeNull();
    s.aturWilayah({ kodeKabKota: '3372', nama: 'Kota Surakarta' });
    expect(new LokalStore(g).data.wilayah?.kodeKabKota).toBe('3372');
  });

  it('namaPendek menyingkat nama resmi', () => {
    expect(namaPendek('Kabupaten Wonogiri')).toBe('Kab. Wonogiri');
    expect(namaPendek('Kota Administrasi Jakarta Timur')).toBe('Kota Jakarta Timur');
    expect(namaPendek('Kota Surakarta')).toBe('Kota Surakarta');
  });
});

describe('LokalStore', () => {
  it('mencatat urusan terbaru di depan tanpa duplikat dan menyimpannya', () => {
    const g = gudang();
    const s = new LokalStore(g);
    s.catatUrusan({ id: ID, judul: 'Akta', peristiwa: 'kelahiran', dibuatPada: 'a' });
    s.catatUrusan({ id: ID2, judul: 'KTP', peristiwa: null, dibuatPada: 'b' });
    s.catatUrusan({ id: ID, judul: 'Akta', peristiwa: 'kelahiran', dibuatPada: 'a' });
    s.catatUrusan({ id: 'u_salah', judul: 'x', peristiwa: null, dibuatPada: 'c' });
    expect(s.data.urusan.map((u) => u.id)).toEqual([ID, ID2]);
    expect(new LokalStore(g).cari(ID2)?.judul).toBe('KTP');
  });

  it('pesan warga, pesan tertunda, dan hapus semua', () => {
    const g = gudang();
    const s = new LokalStore(g);
    s.catatUrusan({ id: ID, judul: 'Akta', peristiwa: null, dibuatPada: 'a' });
    s.catatPesan(ID, { teks: 'halo', setelahSeq: 3 });
    expect(s.pesanWarga(ID)).toEqual([{ teks: 'halo', setelahSeq: 3 }]);
    s.simpanTertunda('pesan pertama');
    expect(s.ambilTertunda()).toBe('pesan pertama');
    expect(s.ambilTertunda()).toBeNull();
    s.aturWilayah({ kodeKabKota: '3372', nama: 'Kota Surakarta' });
    s.atur('kontrasTinggi', true);
    expect(s.data.wilayah?.kodeKabKota).toBe('3372');
    s.aturWilayah(null);
    expect(s.data.wilayah).toBeNull();
    s.hapusSemua();
    expect(s.data.urusan).toEqual([]);
    expect(s.data.kontrasTinggi).toBe(false);
    expect(s.pesanWarga(ID)).toEqual([]);
  });

  it('tetap jalan saat penyimpanan rusak atau diblokir', () => {
    const s = new LokalStore({
      getItem: () => '{rusak',
      setItem: () => {
        throw new Error('penuh');
      },
    });
    s.atur('kurangiGerak', true);
    expect(s.data.kurangiGerak).toBe(true);
    expect(new LokalStore(undefined).data.urusan).toEqual([]);
  });
});
