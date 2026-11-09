import { describe, expect, it } from 'vitest';
import { dariDataDiri, pesanIsiSendiri } from './isian.js';

describe('placeholder Data Diri vs diketik warga', () => {
  it('hanya Data Diri yang boleh menahan AI', () => {
    expect(dariDataDiri('{{PEMOHON.HP}}')).toBe(true);
    expect(dariDataDiri('{{PEMOHON.ALAMAT.RT}}')).toBe(true);
    for (const p of ['{{URUSAN.KITIR}}', '{{USAHA.NIB}}', '{{KENDARAAN.NOPOL_ANGKA}}', '{{FILE:ktp}}', 'HP'])
      expect(dariDataDiri(p)).toBe(false);
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
});
