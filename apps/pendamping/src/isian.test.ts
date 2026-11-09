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

  it('Data Diri HANYA {{PEMOHON.<KUNCI>}}: data orang lain/bertingkat diketik warga sendiri', () => {
    for (const p of [
      '{{ANAK.NIK}}',
      '{{ORANG2.NIK}}',
      '{{ANAK.TEMPAT_LAHIR}}',
      '{{PEMOHON.AYAH.NAMA}}',
      '{{PEMOHON.ALAMAT.RT}}',
      '{{XPEMOHON.NIK}}',
    ])
      expect(dariDataDiri(p)).toBe(false);
    expect(pesanIsiSendiri('{{ANAK.NIK}}')).toBe(
      'Ketik isian yang diminta di kolom yang disorot, lalu tekan Lanjutkan.',
    );
    expect(dariDataDiri('{{X.constructor}}')).toBe(false);
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
});
