import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dariDataDiri, pesanBerkasKurang, pesanIsiSendiri } from './isian.js';

describe('placeholder Data Diri vs diketik warga', () => {
  it('hanya Data Diri yang boleh menahan AI', () => {
    expect(dariDataDiri('{{PEMOHON.HP}}')).toBe(true);
    expect(dariDataDiri('{{PEMOHON.NIK}}')).toBe(true);
    for (const p of ['{{URUSAN.KITIR}}', '{{USAHA.NIB}}', '{{KENDARAAN.NOPOL_ANGKA}}', '{{FILE:ktp}}', 'HP'])
      expect(dariDataDiri(p)).toBe(false);
  });

  it('data keluarga di brankas (AYAH/IBU/ANAK/PASANGAN, NAMA_IBU) ikut menahan AI', () => {
    for (const p of [
      '{{ANAK.NIK}}',
      '{{ANAK.TEMPAT_LAHIR}}',
      '{{ANAK.TGL_LAHIR}}',
      '{{IBU.NAMA}}',
      '{{AYAH.NIK}}',
      '{{PASANGAN.JK}}',
      '{{PEMOHON.AYAH.NAMA}}',
      '{{PEMOHON.NAMA_IBU}}',
    ])
      expect(dariDataDiri(p)).toBe(true);
    expect(pesanIsiSendiri('{{ANAK.NIK}}')).toBe(
      'Ketik NIK anak di kolom yang disorot, lalu tekan Lanjutkan.',
    );
    expect(pesanIsiSendiri('{{PEMOHON.NAMA_IBU}}')).toContain('Nama lengkap ibu');
  });

  it('data orang lain/bertingkat di luar brankas diketik warga sendiri', () => {
    for (const p of [
      '{{ORANG2.NIK}}',
      '{{ANAK.AYAH.NAMA}}',
      '{{PEMOHON.ALAMAT.RT}}',
      '{{XPEMOHON.NIK}}',
      '{{ANAK.HP}}',
      '{{KAKEK.NIK}}',
    ])
      expect(dariDataDiri(p)).toBe(false);
    expect(dariDataDiri('{{X.constructor}}')).toBe(false);
    expect(dariDataDiri('{{ANAK.constructor}}')).toBe(false);
  });

  it('pesan giliran menyebut label, tanpa nilai; label tak dikenal = umum', () => {
    expect(pesanIsiSendiri('{{URUSAN.KITIR}}')).toBe(
      'Ketik Nomor kitir di kolom yang disorot, lalu tekan Lanjutkan.',
    );
    expect(pesanIsiSendiri('+62 {{PEMOHON.HP}}')).toContain('Nomor HP');
    expect(pesanIsiSendiri('{{URUSAN.LAIN}}')).toBe(
      'Ketik isian yang diminta di kolom yang disorot, lalu tekan Lanjutkan.',
    );
  });

  it('pesan berkas_kurang menyebut nama Dokumen', () => {
    expect(pesanBerkasKurang('kk')).toBe('Dokumen KK belum ada. Tambahkan di Dokumen, lalu tekan Lanjutkan.');
  });
});

describe('kontrak Data Diri pendamping <-> web', () => {
  const kunci = (berkas: string, nama: string): string[] => {
    const src = readFileSync(new URL(berkas, import.meta.url), 'utf8');
    const blok = new RegExp(`^const ${nama}: [^=]+= \\{\\n([\\s\\S]*?)^\\};`, 'm').exec(src)?.[1] ?? '';
    return [...blok.matchAll(/^ {2}([A-Z0-9_]+):/gm)].map((m) => m[1]!).sort();
  };

  it('DATA_DIRI (isian.ts) dan KOLOM (web isi-data.ts) punya himpunan kunci yang sama', () => {
    const pendamping = kunci('./isian.ts', 'DATA_DIRI');
    const web = kunci('../../web/src/lib/pendamping/isi-data.ts', 'KOLOM');
    expect(pendamping.length).toBeGreaterThan(10);
    expect(pendamping).toEqual(web);
  });

  it('kunci anggota keluarga dan alias pemohon sama di kedua sisi', () => {
    const web = '../../web/src/lib/pendamping/isi-data.ts';
    expect(kunci('./isian.ts', 'ANGGOTA')).toEqual(kunci(web, 'KOLOM_ANGGOTA'));
    expect(kunci('./isian.ts', 'ANGGOTA').length).toBeGreaterThan(5);
    expect(kunci('./isian.ts', 'ALIAS')).toEqual(kunci(web, 'ALIAS_PEMOHON'));
    expect(kunci('./isian.ts', 'ALIAS')).toHaveLength(2);
  });
});
