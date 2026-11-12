import { describe, expect, it } from 'vitest';
import {
  BATAS_PETUNJUK,
  LAYANAN_PETA,
  PETA_PORTAL,
  asetDiblokir,
  aturanBlokirAset,
  ketersediaanLayanan,
  layananPeta,
  petunjukPortal,
} from './peta-portal.js';
import { PORTAL_WILAYAH } from './registry-wilayah.js';

/** Sama dengan validasi `params.jalur` di worker (apps/pendamping/src/sessions.ts programGenerik). */
const JALUR_WORKER = /^\/(?![/\\])[^?#\s\\]{0,200}$/;

describe('PETA_PORTAL: data peta portal daerah aktif', () => {
  const entri = Object.entries(PETA_PORTAL);

  it('setiap portal memetakan kelima layanan, host-nya host portal registry, jalur awalnya sah untuk worker', () => {
    // Kesepuluh daerah Browser Pendamping aktif (ADR 0033) terpetakan.
    expect(entri.map(([kode]) => kode).sort()).toEqual([
      '1271',
      '1371',
      '1871',
      '3276',
      '3312',
      '3374',
      '3573',
      '3578',
      '3671',
      '6371',
    ]);
    for (const [kode, p] of entri) {
      expect(p.kode).toBe(kode);
      expect(Object.keys(p.layanan).sort()).toEqual([...LAYANAN_PETA].sort());
      const reg = PORTAL_WILAYAH[kode];
      expect(reg?.jenis, kode).toBe('web');
      expect(reg?.hosts, kode).toContain(p.host);
      expect(p.jalurMasuk, kode).toMatch(JALUR_WORKER);
      for (const sel of Object.values(p.layanan)) {
        if (sel.jalurMasuk) expect(sel.jalurMasuk, kode).toMatch(JALUR_WORKER);
        for (const v of Object.values(sel.varian ?? {}))
          if (v.jalurMasuk) expect(v.jalurMasuk, kode).toMatch(JALUR_WORKER);
      }
      if (p.prasyaratAkun?.url) expect(new URL(p.prasyaratAkun.url).host, kode).toBe(p.host);
    }
  });

  it('setiap sel atau varian offline punya alasan dan alternatif konkret', () => {
    for (const [kode, p] of entri)
      for (const [layanan, sel] of Object.entries(p.layanan)) {
        const adaOffline = !sel.online || Object.values(sel.varian ?? {}).some((v) => !v.online);
        if (!adaOffline) continue;
        expect(sel.offline?.alasan.length, `${kode}/${layanan}`).toBeGreaterThan(10);
        expect(sel.offline?.alternatif.teks.length, `${kode}/${layanan}`).toBeGreaterThan(30);
      }
  });

  it('tanpa data pribadi: tidak ada deret 12+ angka (NIK/KK) di peta', () => {
    expect(JSON.stringify(PETA_PORTAL)).not.toMatch(/\d{12,}/);
  });

  it('jenis urusan harness → layanan peta (akta umum dan jenis lain tidak dipetakan)', () => {
    expect(layananPeta('kelahiran')).toBe('akta_lahir');
    expect(layananPeta('ktp')).toBe('ktp_el');
    expect(layananPeta('kk')).toBe('kk');
    expect(layananPeta('kia')).toBe('kia');
    expect(layananPeta('pindah')).toBe('pindah');
    expect(layananPeta('akta')).toBeUndefined();
    expect(layananPeta('kematian')).toBeUndefined();
    expect(layananPeta(null)).toBeUndefined();
  });
});

describe('ketersediaanLayanan: sel × varian', () => {
  it('Semarang KTP-el offline (TPDK kecamatan), Malang pindah offline', () => {
    const smg = ketersediaanLayanan('3374', 'ktp');
    expect(smg).toMatchObject({ dipetakan: true, online: false });
    if (smg.dipetakan && !smg.online) {
      expect(smg.alternatif.teks).toMatch(/TPDK/);
      expect(smg.alternatif.lokasi).toBe('kecamatan');
    }
    expect(ketersediaanLayanan('3573', 'pindah')).toMatchObject({ dipetakan: true, online: false });
  });

  it('Padang KTP-el: hanya varian hilang yang online (/layanan/0045); KIA hanya pemula', () => {
    expect(ketersediaanLayanan('1371', 'ktp')).toMatchObject({ online: false });
    expect(ketersediaanLayanan('1371', 'ktp', 'baru')).toMatchObject({ online: false });
    expect(ketersediaanLayanan('1371', 'ktp', 'hilang')).toMatchObject({
      online: true,
      rute: '/layanan/0045',
      varian: 'hilang',
    });
    expect(ketersediaanLayanan('1371', 'kia')).toMatchObject({ online: true, rute: '/layanan/0037' });
    expect(ketersediaanLayanan('1371', 'kia', 'hilang')).toMatchObject({ online: false });
  });

  it('Tangerang KTP-el baru offline, rusak/hilang online; Bandar Lampung KTP-el baru = antrean perekaman tanpa akun', () => {
    expect(ketersediaanLayanan('3671', 'ktp', 'baru')).toMatchObject({ online: false });
    expect(ketersediaanLayanan('3671', 'ktp', 'rusak')).toMatchObject({ online: true, jalurMasuk: '/' });
    const balam = ketersediaanLayanan('1871', 'ktp', 'baru');
    expect(balam).toMatchObject({ online: true, jalurMasuk: '/perekaman', butuhLogin: false });
    expect(balam.dipetakan && balam.online && balam.prasyarat).toBeFalsy();
    expect(ketersediaanLayanan('1871', 'ktp')).toMatchObject({
      online: true,
      jalurMasuk: '/pelayanan/auth',
      prasyarat: { perangkat: 'bebas' },
    });
  });

  it('varian tak dikenal = nilai sel; wilayah/jenis belum dipetakan = dipetakan:false', () => {
    expect(ketersediaanLayanan('3374', 'kk', 'tidak-ada')).toMatchObject({ online: true });
    expect(ketersediaanLayanan('3201', 'ktp')).toEqual({ dipetakan: false });
    expect(ketersediaanLayanan('3374', 'kematian')).toEqual({ dipetakan: false });
    expect(ketersediaanLayanan(null, 'ktp')).toEqual({ dipetakan: false });
  });

  it('Surabaya: KIA dan pindah datang tidak untuk akun warga; pindah keluar online di /app', () => {
    const kia = ketersediaanLayanan('3578', 'kia');
    expect(kia).toMatchObject({ dipetakan: true, online: false });
    if (kia.dipetakan && !kia.online) {
      expect(kia.alternatif.lokasi).toBe('kelurahan-desa');
      expect(kia.alternatif.teks).toMatch(/sekolah anak/);
    }
    expect(ketersediaanLayanan('3578', 'pindah', 'datang')).toMatchObject({ online: false });
    expect(ketersediaanLayanan('3578', 'pindah')).toMatchObject({
      online: true,
      jalurMasuk: '/app',
      prasyarat: { perangkat: 'bebas' },
    });
  });

  it('Wonogiri KTP-el: id layanan per varian (8/9/10/11); Medan, Banjarmasin: jalur halaman masuk', () => {
    expect(ketersediaanLayanan('3312', 'ktp', 'hilang')).toMatchObject({
      online: true,
      rute: '/telunjuksakti/index.php/pendaftaran/syarat/10',
      jalurMasuk: '/telunjuksakti/index.php/users/login',
    });
    expect(ketersediaanLayanan('3312', 'ktp', 'baru')).toMatchObject({
      rute: '/telunjuksakti/index.php/pendaftaran/syarat/8',
    });
    expect(PETA_PORTAL['3312']?.butuhHeaded).toBe(true);
    expect(ketersediaanLayanan('1271', 'kk')).toMatchObject({
      online: true,
      jalurMasuk: '/portal/',
      rute: '/portal/pengajuan',
    });
    expect(ketersediaanLayanan('6371', 'ktp')).toMatchObject({ online: true, jalurMasuk: '/auth/login' });
  });
});

describe('petunjukPortal: teks tepercaya untuk Navigator', () => {
  it('memuat portal, jalur menu, jebakan, kolom, dan tombol akhir milik warga; dibatasi panjangnya', () => {
    const t = petunjukPortal('3671', 'ktp', 'hilang')!;
    expect(t).toMatch(/Sobat Dukcapil/);
    expect(t).toMatch(/Kartu Tanda Penduduk \(KTP-EL\) > Cari > Rusak\/Hilang/);
    expect(t).toMatch(/Upload Foto Selfie/);
    expect(t).toMatch(/digambar warga/);
    expect(t).toMatch(/selalu ditekan warga/);
    for (const kode of Object.keys(PETA_PORTAL))
      for (const jenis of ['kelahiran', 'kk', 'pindah', 'kia', 'ktp']) {
        const p = petunjukPortal(kode, jenis);
        if (p) expect(p.length).toBeLessThanOrEqual(BATAS_PETUNJUK);
      }
  });

  it('Depok: mulai dari beranda, tab Pendaftaran; varian lain disebut', () => {
    const t = petunjukPortal('3276', 'pindah', 'datang')!;
    expect(t).toMatch(/Pindah Datang \(SKDWNI\)/);
    expect(t).toMatch(/Tautan langsung \/public\/layanan\/\* = 404/);
    expect(t).toMatch(/tab "Pendaftaran"/);
  });

  it('Depok: berkas dan pertanyaan per varian (QUESTION_DATA) menimpa milik sel', () => {
    const hilang = ketersediaanLayanan('3276', 'ktp', 'hilang');
    expect(hilang).toMatchObject({ online: true, berkasLengkap: true, keyakinan: 'tinggi' });
    expect(hilang.dipetakan && hilang.online && hilang.berkas).toContain(
      'Surat keterangan hilang dari kepolisian',
    );
    const t = petunjukPortal('3276', 'pindah', 'datang')!;
    expect(t).toMatch(/Status Kartu Keluarga\?\* \[select: KK Baru \/ KK Tetap/);
    expect(t).toMatch(/Surat pernyataan alamat tujuan yang ditandatangani Ketua RT/);
    expect(petunjukPortal('3276', 'pindah')).toMatch(/Jenis Kepindahan\*/);
  });

  it('sel offline atau belum dipetakan: tanpa petunjuk', () => {
    expect(petunjukPortal('3374', 'ktp')).toBeUndefined();
    expect(petunjukPortal('3201', 'kk')).toBeUndefined();
    expect(petunjukPortal('3578', 'kia')).toBeUndefined();
  });
});

describe('blokirAset: aset berat portal (Depok)', () => {
  const depok = aturanBlokirAset(['silondomaju.depok.go.id', 'challenges.cloudflare.com']);

  it('hanya sesi yang memuat host portal itu yang mendapat aturan', () => {
    expect(depok.length).toBeGreaterThan(0);
    expect(aturanBlokirAset(['sidnok.semarangkota.go.id'])).toEqual([]);
    expect(aturanBlokirAset([])).toEqual([]);
  });

  it('gambar/fon/media cms.depok.go.id, ikon SVG icon-submission, dan GIF 404 dibatalkan', () => {
    expect(asetDiblokir(depok, 'https://cms.depok.go.id/uploads/banner-1.jpg', 'image')).toBe(true);
    expect(asetDiblokir(depok, 'https://cms.depok.go.id/fonts/x.woff2', 'font')).toBe(true);
    expect(asetDiblokir(depok, 'https://cms.depok.go.id/v/intro.mp4', 'media')).toBe(true);
    expect(
      asetDiblokir(
        depok,
        'https://silondomaju.depok.go.id/assets/images/media/icon-submission/Kartu-keluarga.svg',
        'image',
      ),
    ).toBe(true);
    expect(
      asetDiblokir(depok, 'https://silondomaju.depok.go.id/assets/images/404-animasi.gif', 'image'),
    ).toBe(true);
  });

  it('dokumen, skrip, gaya, XHR, dan gambar lain (logo, captcha) tidak pernah diblokir', () => {
    for (const tipe of ['document', 'script', 'stylesheet', 'xhr', 'fetch'])
      expect(asetDiblokir(depok, 'https://cms.depok.go.id/a.jpg', tipe)).toBe(false);
    expect(asetDiblokir(depok, 'https://silondomaju.depok.go.id/assets/images/logo.svg', 'image')).toBe(
      false,
    );
    expect(asetDiblokir(depok, 'https://silondomaju.depok.go.id/captcha/puzzle.png', 'image')).toBe(false);
    expect(
      asetDiblokir(
        depok,
        'https://silondomaju.depok.go.id/assets/images/media/icon-submission/a.png',
        'image',
      ),
    ).toBe(false);
    expect(asetDiblokir(depok, 'https://challenges.cloudflare.com/turnstile/v0/x.png', 'image')).toBe(false);
    expect(asetDiblokir(depok, 'bukan url', 'image')).toBe(false);
  });
});
