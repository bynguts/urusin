import { describe, expect, it } from 'vitest';
import { kanalWilayah, onlineTerverifikasi, rencanaWilayah, wilayahByKode } from './index.js';

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
  it('label jujur: "online" hanya bila pengajuan online wilayah itu terverifikasi, selain itu cek kanal', () => {
    const w = (k: string) => wilayahByKode(k)!;
    expect(onlineTerverifikasi(w('3578'))).toBe(true); // Surabaya: portal, read-only terverifikasi
    expect(onlineTerverifikasi(w('3216'))).toBe(false); // Kab. Bekasi: portal pending-recon
    expect(onlineTerverifikasi(w('1101'))).toBe(false); // Aceh Selatan: tanpa entri
    expect(onlineTerverifikasi(null)).toBe(false);
    for (const slug of ['kelahiran', 'kematian', 'perkawinan']) {
      for (const kode of ['3216', '1101']) {
        const r = rencanaWilayah(slug, { ktp: kode })!;
        expect(
          r.langkah.map((l) => l.jenis).every((j) => j === 'cek-kanal'),
          `${slug} ${kode}`,
        ).toBe(true);
      }
      const sby = rencanaWilayah(slug, { ktp: '3578' })!;
      expect(sby.langkah[0]!.jenis, slug).toBe('online-manual');
      // Penyerahan dokumen beda-beda per daerah (cetak mandiri/ambil): tidak pernah dilabeli "datang langsung".
      expect(
        sby.langkah.some((l) => l.jenis === 'offline'),
        slug,
      ).toBe(false);
    }
    const pindah = rencanaWilayah('pindah', { ktp: '3578', tujuan: '3216' })!;
    expect(pindah.langkah.map((l) => l.jenis)).toEqual(['online-manual', 'cek-kanal']);
    expect(rencanaWilayah('kelahiran', { ktp: null })!.langkah[0]!.jenis).toBe('cek-kanal');
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
    expect(r.langkah.map((l) => l.id)).toEqual(['skpwni', 'kk-ktp-el']);
    const [pwni, tujuan] = r.langkah;
    expect(pwni!.judul).toMatch(/SKPWNI.*Kota Surabaya/);
    expect(pwni!.sourceRef[0]!.url).toMatch(/surabaya/);
    expect(pwni!.keterangan).toMatch(/100 hari kerja/);
    expect(pwni!.keterangan).toMatch(/Disdukcapil tujuan bisa membantu/);
    expect(tujuan!.judul).toMatch(/Kab\. Bekasi.*KK dan KTP-el/);
    expect(tujuan!.sourceRef[0]!.url).toMatch(/bekasikab/);
    expect(tujuan!.dokumen).toContain('SKPWNI dari daerah asal');
    expect(tujuan!.keterangan).toMatch(/KTP-el lama ditarik di sini, bukan di asal/);
    expect(tujuan!.dependsOn).toEqual(['skpwni']);
    // SKDWNI bukan dokumen nasional: tidak disebut bila tujuan bukan daerah yang memakai nama itu.
    expect(JSON.stringify(r)).not.toMatch(/SKDWNI/);
    expect(pwni!.sourceRef.map((s) => s.url)).toContain(
      'https://peraturan.bpk.go.id/Download/129847/Permendagri%20108%20Tahun%202019.pdf',
    );
    expect(tujuan!.sourceRef.map((s) => s.url)).toContain('https://peraturan.go.id/files/ps96-2018.pdf');
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
  it('pindah ke Wonogiri: SKDWNI hanya disebut sebagai nama layanan lokal di sisi tujuan', () => {
    const r = rencanaWilayah('pindah', { ktp: '3578', tujuan: '3312' })!;
    expect(r.keluaran).not.toContain('SKDWNI');
    const tujuan = r.langkah[1]!;
    expect(tujuan.keterangan).toMatch(
      /Di Wonogiri layanan ini bernama Surat Keterangan Datang WNI \(SKDWNI\)/,
    );
    expect(tujuan.dokumen).toContain('SKPWNI dari daerah asal');
    expect(JSON.stringify(r.langkah[0])).not.toMatch(/SKDWNI/);
  });
  it('pindah dalam satu kab/kota: satu langkah tanpa SKPWNI antar daerah (Permendagri 108/2019 Ps. 29)', () => {
    const r = rencanaWilayah('pindah', { ktp: '3578', tujuan: '3578' })!;
    expect(r.langkah.map((l) => l.id)).toEqual(['pindah-alamat']);
    expect(r.langkah[0]!.judul).toMatch(/Kota Surabaya.*KK dan KTP-el alamat baru/);
    expect(r.langkah[0]!.keterangan).toMatch(/Ps\. 29/);
    expect(r.catatan).toMatch(/cukup satu kali lapor/);
  });
  it('rencana nasional memuat batas waktu dan dasar hukum bersumber', () => {
    const lahir = rencanaWilayah('kelahiran', { ktp: '3216' })!.langkah[0]!;
    expect(lahir.keterangan).toMatch(/paling lambat 60 hari/);
    expect(lahir.keterangan).toMatch(/tanpa penetapan pengadilan/);
    expect(lahir.sourceRef.map((s) => s.url)).toContain('https://peraturan.go.id/files/uu24-2013bt.pdf');
    const mati = rencanaWilayah('kematian', { ktp: '3216' })!.langkah[0]!;
    expect(mati.keterangan).toMatch(/paling lambat 30 hari/);
    const kawin = rencanaWilayah('perkawinan', { ktp: '3216' })!.langkah[0]!;
    expect(kawin.keterangan).toMatch(/KUA kecamatan dan Dukcapil tidak menerbitkan kutipan akta/);
    expect(kawin.sourceRef.map((s) => s.url)).toContain('https://peraturan.go.id/files/uu23-2006.pdf');
  });
});
