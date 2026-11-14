import { describe, expect, it } from 'vitest';
import { LokalStore, bersihkanLokal, kueWilayah, namaPendek } from './lokal.svelte.js';

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

  it('wilayah perangkat ikut ke cookie (server memakainya di landing tanpa JS); dihapus saat dihapus', () => {
    const tulis: (string | null)[] = [];
    const g = gudang();
    const s = new LokalStore(g, (k) => void tulis.push(k));
    expect(tulis).toEqual([]); // tanpa pilihan, cookie yang mungkin ada tidak dihapus diam-diam
    s.aturWilayah({ kodeKabKota: '3404', nama: 'Kab. Sleman' });
    s.aturWilayah(null);
    s.aturWilayah({ kodeKabKota: '3374', nama: 'Kota Semarang' });
    s.hapusSemua();
    expect(tulis).toEqual(['3404', null, '3374', null]);
    // Pilihan lama di localStorage (sebelum ada cookie) disinkronkan saat store dibuat.
    const g2 = gudang();
    new LokalStore(g2, () => {}).aturWilayah({ kodeKabKota: '3404', nama: 'Kab. Sleman' });
    const sinkron: (string | null)[] = [];
    new LokalStore(g2, (k) => void sinkron.push(k));
    expect(sinkron).toEqual(['3404']);
  });

  it('baris cookie wilayah: kode 4 digit saja, SameSite=Lax, Secure di https; selain itu hapus', () => {
    expect(kueWilayah('3404', true)).toBe(
      'urusin_wilayah=3404; Path=/; Max-Age=31536000; SameSite=Lax; Secure',
    );
    expect(kueWilayah('3404', false)).toBe('urusin_wilayah=3404; Path=/; Max-Age=31536000; SameSite=Lax');
    expect(kueWilayah(null, false)).toBe('urusin_wilayah=; Path=/; Max-Age=0; SameSite=Lax');
    expect(kueWilayah('34;x', false)).toBe('urusin_wilayah=; Path=/; Max-Age=0; SameSite=Lax');
  });

  it('perangkat bersama: akun lain atau sesudah keluar → daftar, pesan, dan wilayah sebelumnya dibuang', () => {
    const A = 'a'.repeat(16);
    const B = 'b'.repeat(16);
    const tulis: (string | null)[] = [];
    const g = gudang();
    const s = new LokalStore(g, (k) => void tulis.push(k));
    // Tamu → masuk: daftar tamu tetap (urusan tamu ikut pindah ke akun).
    s.catatUrusan({ id: ID, judul: 'KTP rusak', peristiwa: null, dibuatPada: 'a' });
    s.sesuaikanPemilik(A);
    expect([s.data.urusan.length, s.data.pemilik]).toEqual([1, A]);
    // Akun A → akun B di peramban yang sama: judul, pesan, dan wilayah A tidak terlihat lagi.
    s.catatPesan(ID, { teks: 'rahasia A', setelahSeq: 1 });
    s.aturWilayah({ kodeKabKota: '3404', nama: 'Kab. Sleman' });
    s.atur('kontrasTinggi', true);
    s.sesuaikanPemilik(B);
    expect([s.data.urusan, s.data.wilayah, s.data.pemilik]).toEqual([[], null, B]);
    expect(s.pesanWarga(ID)).toEqual([]);
    expect(s.data.kontrasTinggi).toBe(true); // pilihan tampilan perangkat tetap
    expect(tulis.at(-1)).toBeNull();
    expect(new LokalStore(g).data.pemilik).toBe(B);
    // Akun B keluar (sesi habis/tanpa tombol Keluar): tamu berikutnya juga tidak melihat daftar B.
    s.catatUrusan({ id: ID2, judul: 'Akta B', peristiwa: null, dibuatPada: 'b' });
    s.sesuaikanPemilik(null);
    expect([s.data.urusan, s.data.pemilik]).toEqual([[], null]);
    // Penanda yang sama: tidak mengubah apa pun.
    s.catatUrusan({ id: ID, judul: 'Tamu', peristiwa: null, dibuatPada: 'c' });
    s.sesuaikanPemilik(null);
    expect(s.data.urusan.length).toBe(1);
    expect(bersihkanLokal({ pemilik: 'bukan penanda' }).pemilik).toBeNull();
  });

  it('gabungUrusan menambah urusan akun dari server (terbaru dulu); buangUrusan membuang beserta pesannya', () => {
    const g = gudang();
    const s = new LokalStore(g);
    s.catatUrusan({ id: ID, judul: 'Lama', peristiwa: null, dibuatPada: '2026-11-10T00:00:00Z' });
    s.gabungUrusan([
      { id: ID, judul: 'Duplikat', peristiwa: null, dibuatPada: '2026-11-10T00:00:00Z' },
      { id: ID2, judul: 'Baru', peristiwa: 'ktp', dibuatPada: '2026-11-12T00:00:00Z' },
      { id: 'u_salah', judul: 'x', peristiwa: null, dibuatPada: '2026-11-13T00:00:00Z' },
    ]);
    expect(s.data.urusan.map((u) => [u.id, u.judul])).toEqual([
      [ID2, 'Baru'],
      [ID, 'Lama'],
    ]);
    s.catatPesan(ID, { teks: 'halo', setelahSeq: 1 });
    s.buangUrusan([ID]);
    expect(s.data.urusan.map((u) => u.id)).toEqual([ID2]);
    expect(s.pesanWarga(ID)).toEqual([]);
    expect(new LokalStore(g).data.urusan.map((u) => u.id)).toEqual([ID2]);
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
