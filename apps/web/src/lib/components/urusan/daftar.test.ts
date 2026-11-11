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

  it('galat sebelumnya dibersihkan setelah daftar lokal dihapus', async () => {
    const d = new DaftarUrusan((async () => new Response('', { status: 503 })) as typeof fetch);
    await d.muat([catatan]);
    expect(d.galat).toBe(true);
    await d.muat([]);
    expect([d.galat, d.memuat]).toEqual([false, false]);
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
