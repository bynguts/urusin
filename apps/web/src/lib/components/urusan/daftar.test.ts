import { describe, expect, it } from 'vitest';
import { DaftarUrusan } from './daftar.svelte.js';
import type { CatatanUrusan } from '#lib/stores/lokal.svelte.js';

const catatan: CatatanUrusan = {
  id: `u_${'a'.repeat(32)}`,
  judul: 'Urusan uji',
  peristiwa: 'kelahiran',
  dibuatPada: '2026-11-11T00:00:00Z',
};

describe('DaftarUrusan: pemuatan yang terputus', () => {
  it('menghapus catatan saat permintaan lama berjalan tidak memunculkan urusan lama lagi', async () => {
    let jawab!: (r: Response) => void;
    const d = new DaftarUrusan(
      (() =>
        new Promise<Response>((r) => {
          jawab = r;
        })) as typeof fetch,
    );
    const lama = d.muat([catatan]);
    await d.muat([]);
    expect(d.memuat).toBe(false);
    jawab(Response.json({ urusan: [{ id: catatan.id, state: 'TERKIRIM' }] }));
    await lama;
    expect(d.isi).toEqual([]);
    expect(d.galat).toBe(false);
  });

  it('jawaban lama tidak menggantikan status terbaru ketika dua permintaan berurutan', async () => {
    const jawaban: ((r: Response) => void)[] = [];
    const d = new DaftarUrusan((() => new Promise<Response>((r) => jawaban.push(r))) as typeof fetch);
    const pertama = d.muat([catatan]);
    const kedua = d.muat([catatan]);
    jawaban[1]!(Response.json({ urusan: [{ id: catatan.id, state: 'TERKIRIM' }] }));
    await kedua;
    jawaban[0]!(Response.json({ urusan: [{ id: catatan.id, state: 'MEMAHAMI' }] }));
    await pertama;
    expect(d.isi[0]?.ringkasan?.state).toBe('TERKIRIM');
  });

  it('server menjawab tanpa urusan ini (salinan demo lama/akun lain): ditandai hilang, bukan galat', async () => {
    const lain = { ...catatan, id: `u_${'b'.repeat(32)}` };
    const d = new DaftarUrusan((async () =>
      Response.json({ urusan: [{ id: catatan.id, state: 'TERKIRIM' }] })) as typeof fetch);
    await d.muat([catatan, lain]);
    expect(d.galat).toBe(false);
    expect(d.isi[0]).toMatchObject({ ringkasan: { state: 'TERKIRIM' } });
    expect(d.isi[0]).not.toHaveProperty('hilang');
    expect(d.isi[1]).toMatchObject({ ringkasan: null, hilang: true });
  });

  it('galat sebelumnya dibersihkan setelah daftar lokal dihapus', async () => {
    const d = new DaftarUrusan((async () => new Response('', { status: 503 })) as typeof fetch);
    await d.muat([catatan]);
    expect(d.galat).toBe(true);
    await d.muat([]);
    expect([d.galat, d.memuat]).toEqual([false, false]);
  });
});

describe('DaftarUrusan: akun yang masuk (milik)', () => {
  it('daftar perangkat kosong setelah keluar-masuk: urusan akun dari server tampil dan dicatat', async () => {
    const url: string[] = [];
    const d = new DaftarUrusan((async (u: string) => {
      url.push(u);
      return Response.json({
        urusan: [
          { id: catatan.id, state: 'MEMAHAMI', jenis: 'ktp', dibuatPada: '2026-11-10T00:00:00Z' },
          {
            id: `u_${'c'.repeat(32)}`,
            state: 'TERKIRIM',
            judul: 'Ganti KTP rusak',
            dibuatPada: '2026-11-12T00:00:00Z',
          },
        ],
      });
    }) as typeof fetch);
    let baru: string[] = [];
    d.onbaru = (b) => (baru = b.map((c) => c.judul));
    await d.muat([], { milik: true });
    expect(url).toEqual(['/api/urusan?ids=&milik=1']);
    expect(d.isi.map((u) => [u.judul, u.peristiwa, u.ringkasan?.state])).toEqual([
      ['Ganti KTP rusak', null, 'TERKIRIM'],
      ['KTP elektronik', 'ktp', 'MEMAHAMI'],
    ]);
    expect(baru).toEqual(['KTP elektronik', 'Ganti KTP rusak']);
  });

  it('catatan perangkat milik akun lain tidak ditampilkan (judulnya tidak bocor) dan dibuang', async () => {
    const lain = { ...catatan, id: `u_${'b'.repeat(32)}`, judul: 'Urusan akun sebelumnya' };
    const d = new DaftarUrusan((async () =>
      Response.json({
        urusan: [{ id: catatan.id, state: 'TERKIRIM', dibuatPada: catatan.dibuatPada }],
      })) as typeof fetch);
    let hilang: string[] = [];
    d.onhilang = (ids) => (hilang = ids);
    await d.muat([catatan, lain], { milik: true });
    expect(d.isi.map((u) => u.id)).toEqual([catatan.id]);
    expect(hilang).toEqual([lain.id]);
  });
});

describe('DaftarUrusan: permintaan menggantung', () => {
  it('berakhir sebagai galat setelah batas tunggu, tidak "Memuat status…" selamanya', async () => {
    const d = new DaftarUrusan(
      ((_u: string, init?: RequestInit) =>
        new Promise<Response>((_, tolak) =>
          init?.signal?.addEventListener('abort', () => tolak(init.signal!.reason)),
        )) as typeof fetch,
      20,
    );
    await d.muat([catatan]);
    expect([d.memuat, d.galat]).toEqual([false, true]);
    expect(d.isi[0]?.ringkasan).toBeNull();
  });
});
