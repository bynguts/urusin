import { describe, expect, it } from 'vitest';
import { kontakLayanan, kontakResmiTercatat, ringkasKontak } from './kanal-layanan.js';
import { wilayahByKode } from './wilayah.js';
import { DATA_KANAL_LAYANAN } from './wilayah-data.js';

describe('data kanal-layanan', () => {
  it('setiap nilai bersumber halaman https .go.id, bertanggal cek, untuk kab/kota yang sah', () => {
    expect(DATA_KANAL_LAYANAN.length).toBeGreaterThan(0);
    for (const e of DATA_KANAL_LAYANAN) {
      expect(wilayahByKode(e.kode), e.kode).toBeDefined();
      const u = new URL(e.sumberUrl);
      expect(u.protocol).toBe('https:');
      expect(u.hostname.endsWith('.go.id'), e.sumberUrl).toBe(true);
      expect(e.dicekPada).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.nilai.trim()).not.toBe('');
      if (e.jenis === 'layanan_online') expect(new URL(e.url!).hostname.endsWith('.go.id')).toBe(true);
      if (e.jenis === 'whatsapp') expect(e.nilai.replace(/\D/g, '')).toMatch(/^08[1-9]\d{7,10}$/);
    }
  });

  it('wilayah persona utama punya kontak layanan Disdukcapil', () => {
    for (const kode of ['3312', '3311', '3310', '3374', '3404', '3216', '3275', '3276', '3578', '3175'])
      expect(kontakLayanan(kode, 'adminduk'), kode).toBeDefined();
  });
});

describe('kontakLayanan / ringkasKontak / kontakResmiTercatat', () => {
  it('mengelompokkan entri satu wilayah dan menyebut sumbernya', () => {
    const k = kontakLayanan('3312', 'adminduk')!;
    expect(k.instansi).toContain('Wonogiri');
    expect(k.sumber.length).toBeGreaterThan(0);
    expect(k.sumber.every((s) => s.url.startsWith('https://'))).toBe(true);
    const r = ringkasKontak(k);
    for (const nilai of [...k.telepon, ...k.whatsapp, ...k.email]) expect(r).toContain(nilai);
  });

  it('wilayah tanpa data: undefined, tidak dikarang', () => {
    expect(kontakLayanan('9999', 'adminduk')).toBeUndefined();
    expect(kontakLayanan('3312', 'skck')).toBeUndefined();
  });

  it('nomor dan email resmi dikenali dalam penulisan apa pun; nomor lain tidak', () => {
    const wa = DATA_KANAL_LAYANAN.find((e) => e.jenis === 'whatsapp')!.nilai;
    const d = wa.replace(/\D/g, '');
    expect(kontakResmiTercatat(wa)).toBe(true);
    expect(kontakResmiTercatat(`+62 ${d.slice(1)}`)).toBe(true);
    const email = DATA_KANAL_LAYANAN.find((e) => e.jenis === 'email')!.nilai;
    expect(kontakResmiTercatat(email.toUpperCase())).toBe(true);
    expect(kontakResmiTercatat('0812-0000-0001')).toBe(false); // pii-scan:allow
    expect(kontakResmiTercatat('warga@gmail.com')).toBe(false); // pii-scan:allow
  });
});
