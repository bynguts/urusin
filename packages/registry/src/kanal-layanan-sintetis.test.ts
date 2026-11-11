import { describe, expect, it, vi } from 'vitest';
import { kontakLayanan, ringkasKontak } from './kanal-layanan.js';

// Data bersumber belum memuat `layanan_online` dan jam layanan ganda. Entri sintetis (kode 9901, tanpa nomor atau
// email) menguji perakitan cabang itu tanpa mengubah data/wilayah/kanal-layanan.json.
vi.mock('./wilayah-data.js', async (asli) => {
  const m = await asli<typeof import('./wilayah-data.js')>();
  const dasar = {
    kode: '9901',
    layanan: 'adminduk',
    instansi: 'Dinas Uji',
    dicekPada: '2026-11-11',
  } as const;
  return {
    ...m,
    DATA_KANAL_LAYANAN: [
      ...m.DATA_KANAL_LAYANAN,
      { ...dasar, jenis: 'jam_layanan', nilai: 'Senin-Jumat 08.00-15.00', sumberUrl: 'https://uji.go.id/a' },
      { ...dasar, jenis: 'jam_layanan', nilai: 'Sabtu tutup', sumberUrl: 'https://uji.go.id/a' },
      {
        ...dasar,
        jenis: 'layanan_online',
        nilai: 'Daftar online',
        url: 'https://uji.go.id/daftar',
        sumberUrl: 'https://uji.go.id/b',
      },
      { ...dasar, jenis: 'layanan_online', nilai: 'Tanpa tautan', sumberUrl: 'https://uji.go.id/b' },
    ],
  };
});

describe('kontakLayanan: layanan online dan jam layanan (entri sintetis)', () => {
  it('layanan online bertautan ikut, tanpa tautan dibuang; jam layanan pertama dipakai; sumber tidak ganda', () => {
    const k = kontakLayanan('9901', 'adminduk')!;
    expect(k).toEqual({
      instansi: 'Dinas Uji',
      telepon: [],
      whatsapp: [],
      email: [],
      jamLayanan: 'Senin-Jumat 08.00-15.00',
      layananOnline: [{ nama: 'Daftar online', url: 'https://uji.go.id/daftar' }],
      sumber: [
        { url: 'https://uji.go.id/a', dicekPada: '2026-11-11' },
        { url: 'https://uji.go.id/b', dicekPada: '2026-11-11' },
      ],
    });
    expect(ringkasKontak(k)).toBe(
      'Jam layanan Senin-Jumat 08.00-15.00 · Daftar online https://uji.go.id/daftar',
    );
  });
});
