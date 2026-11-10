import { describe, expect, it } from 'vitest';
import { kanalWilayah, rencanaWilayah } from './index.js';

const semua = () => true;

describe('kanalWilayah: portal → situs Disdukcapil terverifikasi → nasional', () => {
  it('Surabaya: portal Klampid di registry', () => {
    expect(kanalWilayah('3578')).toMatchObject({
      jenis: 'portal',
      url: 'https://wargaklampid-dispendukcapil.surabaya.go.id/',
    });
  });
  it('Kab. Bekasi: portal SITEPAK', () => {
    expect(kanalWilayah('3216')).toMatchObject({ jenis: 'portal', url: 'https://sitepak.bekasikab.go.id/' });
  });
  it('tanpa entri registry, ada kontak terverifikasi (Aceh Tengah): situs Disdukcapil-nya', () => {
    expect(kanalWilayah('1104')).toMatchObject({
      jenis: 'disdukcapil',
      url: expect.stringMatching(/acehtengahkab/),
    });
  });
  it('tanpa portal dan tanpa kontak (Aceh Selatan): kanal nasional', () => {
    expect(kanalWilayah('1101')).toMatchObject({
      jenis: 'nasional',
      url: 'https://dukcapil.kemendagri.go.id/',
    });
  });
});

describe('rencanaWilayah: tidak ada isi Wonogiri untuk warga daerah lain', () => {
  it.each([
    ['3578', 'Kota Surabaya', 'https://wargaklampid-dispendukcapil.surabaya.go.id/'],
    ['3216', 'Kabupaten Bekasi', 'https://sitepak.bekasikab.go.id/'],
    ['1101', 'Kabupaten Aceh Selatan', 'https://dukcapil.kemendagri.go.id/'],
  ])('%s (%s): langkah nasional + kanal resmi sendiri, tier dipandu', (kode, nama, url) => {
    for (const slug of ['kelahiran', 'kematian', 'perkawinan']) {
      const r = rencanaWilayah(slug, { ktp: kode, pendampingTersedia: semua })!;
      expect(JSON.stringify(r), slug).not.toMatch(/wonogiri/i);
      expect(r.tier).toBe('dipandu');
      expect(r.khususWilayah).toBe(false);
      expect(r.ktp?.nama).toBe(nama);
      expect(r.langkah.some((l) => l.jenis === 'online-adapter')).toBe(false);
      expect(r.langkah[0]!.sourceRef[0]!.url).toBe(url);
      expect(r.peringatan).toBeUndefined();
    }
  });
  it('wilayah tanpa situs terverifikasi mengatakannya terus terang', () => {
    const r = rencanaWilayah('kelahiran', { ktp: '1101' })!;
    expect(r.langkah[0]!.keterangan).toMatch(/belum terverifikasi/);
  });
  it('tanpa wilayah: rencana umum nasional, tanpa Wonogiri', () => {
    const r = rencanaWilayah('kelahiran', { ktp: null })!;
    expect(JSON.stringify(r)).not.toMatch(/wonogiri/i);
    expect(r.ktp).toBeNull();
    expect(r.tier).toBe('dipandu');
  });
});

describe('rencanaWilayah: Wonogiri tetap memakai bundel khususnya', () => {
  it('dengan Browser Pendamping: langkah ajukan online-adapter, tier semi', () => {
    const r = rencanaWilayah('kelahiran', { ktp: '3312', pendampingTersedia: semua })!;
    expect(r.khususWilayah).toBe(true);
    expect(r.tier).toBe('semi');
    expect(r.langkah[0]).toMatchObject({
      jenis: 'online-adapter',
      pendamping: { params: { layanan_id: 23 } },
    });
  });
  it('tanpa adapter yang sanggup: jujur dipandu (online-manual, tanpa alur pendamping)', () => {
    const r = rencanaWilayah('kelahiran', { ktp: '3312' })!;
    expect(r.tier).toBe('dipandu');
    expect(r.langkah[0]!.jenis).toBe('online-manual');
    expect(r.langkah[0]!.pendamping).toBeUndefined();
  });
});

describe('rencanaWilayah: KTP ≠ domisili dan pindah', () => {
  it('domisili berbeda: catatan menjelaskan yurisdiksi KTP dan bahwa online bisa dari mana saja', () => {
    const r = rencanaWilayah('kelahiran', { ktp: '3578', domisili: '3216' })!;
    expect(r.domisili?.kodeKabKota).toBe('3216');
    expect(r.catatan).toMatch(/Anda tinggal di Kabupaten Bekasi/);
    expect(r.catatan).toMatch(/sesuai alamat KTP: Kota Surabaya/);
    expect(r.catatan).toMatch(/dari mana saja/);
    // Kanal tetap milik wilayah KTP, bukan domisili.
    expect(r.langkah[0]!.sourceRef[0]!.url).toMatch(/surabaya/);
  });
  it('domisili sama dengan KTP diabaikan', () => {
    expect(rencanaWilayah('kelahiran', { ktp: '3578', domisili: '3578' })!.domisili).toBeNull();
  });
  it('pindah Surabaya → Kab. Bekasi: SKPWNI di asal, datang/KK/KTP-el di tujuan, tanpa Wonogiri', () => {
    const r = rencanaWilayah('pindah', { ktp: '3578', tujuan: '3216' })!;
    expect(JSON.stringify(r)).not.toMatch(/wonogiri/i);
    const [pwni, dwni, kk, ktp] = r.langkah;
    expect(pwni!.judul).toMatch(/Kota Surabaya/);
    expect(pwni!.sourceRef[0]!.url).toMatch(/surabaya/);
    for (const l of [dwni!, kk!, ktp!]) {
      expect(l.judul).toMatch(/Kab\. Bekasi/);
      expect(l.sourceRef[0]!.url).toMatch(/bekasikab/);
    }
    expect(dwni!.dependsOn).toEqual(['skpwni']);
    expect(r.kanal.map((k) => k.url)).toEqual([
      'https://wargaklampid-dispendukcapil.surabaya.go.id/',
      'https://sitepak.bekasikab.go.id/',
    ]);
    expect(r.catatan).toMatch(/dari Kota Surabaya ke Kabupaten Bekasi/);
  });
  it('pindah dari Wonogiri: halaman SKPWNI Wonogiri hanya di sisi asal', () => {
    const r = rencanaWilayah('pindah', { ktp: '3312', tujuan: '3578' })!;
    expect(JSON.stringify(r.langkah[0])).toMatch(/wonogiri/i);
    for (const l of r.langkah.slice(1)) expect(JSON.stringify(l)).not.toMatch(/wonogiri/i);
  });
});
