import { describe, expect, it } from 'vitest';
import { KATALOG_PLACEHOLDER, kelaziman } from './validasi.js';

const kolom = (nama: string) => ({ nama, peran: 'teks' as const });

describe('katalog data keluarga', () => {
  it('AYAH/IBU/ANAK/PASANGAN x NAMA/NIK/TEMPAT_LAHIR/TGL_LAHIR/JK ada di katalog dengan label', () => {
    for (const ns of ['AYAH', 'IBU', 'ANAK', 'PASANGAN'])
      for (const k of ['NAMA', 'NIK', 'TEMPAT_LAHIR', 'TGL_LAHIR', 'JK']) {
        const e = KATALOG_PLACEHOLDER[`{{${ns}.${k}}}`];
        expect(e?.label, `${ns}.${k}`).toContain(ns.toLowerCase());
      }
    expect(KATALOG_PLACEHOLDER['{{ORANG2.NIK}}']).toBeUndefined();
  });

  it('NIK anggota tetap sensitif: hanya ke kolom NIK, bukan kolom lain', () => {
    expect(kelaziman('{{IBU.NIK}}', kolom('NIK Ibu'))).toBe('lazim');
    expect(kelaziman('{{ANAK.NIK}}', kolom('Nama Bayi'))).toBe('asing');
    expect(kelaziman('{{AYAH.NAMA}}', kolom('Nama Ayah'))).toBe('lazim');
    expect(kelaziman('{{ANAK.TGL_LAHIR}}', kolom('Tanggal Lahir Bayi'))).toBe('lazim');
    // tanpa isyarat atribut: autocomplete "name" portal tidak membuat nama anggota lazim di kolom samar
    expect(kelaziman('{{IBU.NAMA}}', { nama: 'Kontak', peran: 'teks', isyarat: 'nama' })).toBe('samar');
  });
});
