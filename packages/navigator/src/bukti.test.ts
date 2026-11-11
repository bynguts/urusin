import { describe, expect, it } from 'vitest';
import { buatResi, buktiDariPengamatan, ringkasBukti } from './bukti.js';
import { halaman, halamanForm } from './testing.js';

const sukses = (teks: string) =>
  halaman({ elemen: [], teks, sinyal: { ...halamanForm().sinyal, sukses: true } });

describe('bukti dan resi', () => {
  it('nomor registrasi dari halaman sukses', () => {
    expect(buktiDariPengamatan(sukses('Berhasil! No. Pendaftaran: KK/2026/0042.'))).toEqual({
      nomor: 'KK/2026/0042',
      status: 'Pengajuan diterima situs',
    });
  });

  it('bukan halaman sukses → tanpa bukti; nomor menyerupai NIK/HP dibuang', () => {
    expect(buktiDariPengamatan(halamanForm())).toBeUndefined();
    const nik = ['3312', '0115', '0890', '0001'].join('');
    expect(buktiDariPengamatan(sukses(`Nomor registrasi: ${nik}`))?.nomor).toBeUndefined();
    expect(
      buktiDariPengamatan(sukses(`Nomor tiket: ${['0812', '3456', '7890'].join('')}`))?.nomor,
    ).toBeUndefined();
  });

  it('resi tanpa nilai, hash stabil atas isi kanonik', () => {
    const isi = {
      executionId: 'x_1',
      host: 'localhost:4400',
      selesaiPada: '2026-11-10T00:00:00.000Z',
      akhir: 'selesai',
      halaman: 2,
      aksi: 5,
      panggilanLlm: 2,
      rencana: ['a'.repeat(64)],
    };
    expect(buatResi(isi).hash).toBe(buatResi({ ...isi }).hash);
    expect(buatResi(isi).hash).not.toBe(buatResi({ ...isi, aksi: 6 }).hash);
    expect(ringkasBukti({ nomor: 'REG-1' })).toMatch(/REG-1/);
    expect(ringkasBukti(undefined)).toMatch(/tanpa nomor/);
  });
});
