import { describe, expect, it } from 'vitest';
import {
  DAERAH_PENDAMPING_AKTIF,
  DAFTAR_PENDAMPING_AKTIF,
  kalimatPendampingBerkembang,
  pendampingAktif,
  wilayahByKode,
} from './index.js';

describe('DAERAH_PENDAMPING_AKTIF (keputusan pemilik, ADR 0033)', () => {
  it('tepat 10 daerah prioritas, kode dan nama cocok dengan Kepmendagri', () => {
    expect(DAERAH_PENDAMPING_AKTIF.map((d) => d.kode)).toEqual([
      '3578',
      '3312',
      '3374',
      '1271',
      '3573',
      '3276',
      '3671',
      '1371',
      '1871',
      '6371',
    ]);
    for (const d of DAERAH_PENDAMPING_AKTIF) {
      const w = wilayahByKode(d.kode);
      expect(w, d.kode).toBeDefined();
      // Nama pendek tetap menunjuk kab/kota yang benar (Kota Tangerang, bukan Kabupaten Tangerang).
      expect(w!.nama.toLowerCase(), d.kode).toContain(d.nama.replace(/^Kota /, '').toLowerCase());
      if (d.nama.startsWith('Kota ')) expect(w!.nama).toMatch(/^Kota /);
    }
  });

  it('pendampingAktif hanya untuk 10 kode itu', () => {
    expect(pendampingAktif('3312')).toBe(true);
    expect(pendampingAktif('3671')).toBe(true);
    for (const k of ['9171', '7371', '3174', '9601', '5371', '3603', null, undefined, ''])
      expect(pendampingAktif(k), String(k)).toBe(false);
  });

  it('kalimat positif: memandu, sedang dikembangkan, daftar daerah aktif', () => {
    const k = kalimatPendampingBerkembang('Kota Jayapura');
    expect(k).toMatch(/^Untuk Kota Jayapura, Urusin memandu Anda langkah demi langkah\./);
    expect(k).toContain('untuk Kota Jayapura sedang kami kembangkan');
    expect(k).toContain(DAFTAR_PENDAMPING_AKTIF);
    expect(DAFTAR_PENDAMPING_AKTIF).toBe(
      'Surabaya, Wonogiri, Semarang, Medan, Malang, Depok, Kota Tangerang, Padang, Bandar Lampung, dan Banjarmasin',
    );
    expect(k).not.toMatch(/belum bisa dibantu|tidak bisa/);
    expect(kalimatPendampingBerkembang('X', 'Disdukcapil X melayani lewat WhatsApp.')).toContain(
      'langkah. Disdukcapil X melayani lewat WhatsApp. Browser',
    );
  });
});
