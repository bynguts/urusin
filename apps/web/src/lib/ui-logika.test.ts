import { describe, expect, it } from 'vitest';
import { menuAktif, rutAuth } from './components/shell/navigasi.js';
import { periksaBerkas, samarkan, ukuranBerkas } from './akun/klien.js';
import { labelPlaceholder, petakanIsian } from './pendamping/isi-data.js';
import { keadaanDariSesi } from './pendamping/sesi.svelte.js';
import { LABEL_STATE, LANGKAH_RENCANA, domain, infoStatus, tanggal, waktuSingkat } from './urusan-status.js';

describe('status urusan', () => {
  it('setiap state punya label, langkah, dan kelompok', () => {
    for (const s of Object.keys(LABEL_STATE) as (keyof typeof LABEL_STATE)[]) {
      const i = infoStatus(s);
      expect(i.label.length).toBeGreaterThan(0);
      expect(i.langkah).toBeGreaterThanOrEqual(0);
      expect(i.langkah).toBeLessThanOrEqual(LANGKAH_RENCANA.length + 1);
    }
    expect(infoStatus(null)).toEqual(infoStatus('BARU'));
    expect(infoStatus('MENUNGGU_SUBMIT_WARGA')).toMatchObject({ nada: 'anda', kelompok: 'anda', langkah: 4 });
    expect(infoStatus('TERKIRIM').kelompok).toBe('instansi');
  });

  it('format waktu dan domain', () => {
    expect(tanggal(null)).toBe('');
    expect(tanggal('bukan tanggal')).toBe('');
    expect(tanggal('2026-11-03T05:00:00.000Z')).toMatch(/2026/);
    expect(waktuSingkat('x')).toBe('');
    expect(waktuSingkat('2026-11-05T12:20:00.000Z')).toMatch(/Nov/);
    expect(domain('https://www.dukcapil.kemendagri.go.id/x')).toBe('dukcapil.kemendagri.go.id');
    expect(domain('bukan url')).toBe('bukan url');
  });
});

describe('navigasi', () => {
  it('layar akun tanpa kerangka; menu aktif termasuk halaman turunan', () => {
    expect(rutAuth('/masuk')).toBe(true);
    expect(rutAuth('/verifikasi-email')).toBe(true);
    expect(rutAuth('/masukan')).toBe(false);
    expect(menuAktif('/beranda', '/peristiwa/kelahiran')).toBe(true);
    expect(menuAktif('/beranda', '/urusanku')).toBe(false);
    expect(menuAktif('/urusanku', `/urusan/u_${'a'.repeat(32)}`)).toBe(true);
    expect(menuAktif('/urusanku', `/jejak/u_${'a'.repeat(32)}`)).toBe(true);
    expect(menuAktif('/dokumen', '/data-diri')).toBe(true);
    expect(menuAktif('/bantuan', '/bantuan')).toBe(true);
  });
});

describe('brankas akun', () => {
  it('memeriksa berkas sebelum unggah', () => {
    const f = (type: string, size: number) => ({ type, size }) as File;
    expect(periksaBerkas(f('image/jpeg', 1000))).toBeNull();
    expect(periksaBerkas(f('application/pdf', 6 * 1024 * 1024))).toBeNull();
    expect(periksaBerkas(f('application/pdf', 10 * 1024 * 1024))).toMatch(/Maksimal 9 MB/);
    expect(periksaBerkas(f('image/gif', 10))).toMatch(/JPG/);
  });

  it('ukuran berkas dan NIK disamarkan', () => {
    expect(ukuranBerkas(500)).toBe('1 KB');
    expect(ukuranBerkas(350 * 1024)).toBe('350 KB');
    expect(ukuranBerkas(1.5 * 1024 * 1024)).toBe('1,5 MB');
    expect(samarkan(undefined)).toBe('');
    expect(samarkan('123')).toBe('••••');
    expect(samarkan('1234' + '0'.repeat(8) + '5678')).toBe('1234 •••• •••• 5678');
  });
});

describe('Browser Pendamping', () => {
  it('memetakan placeholder ke Data Diri dan mencatat yang kurang', () => {
    const r = petakanIsian(['{{PEMOHON.NAMA}}', '{{PEMOHON.HP}}', '{{ANAK.TEMPAT_LAHIR}}', 'bukan'], {
      namaLengkap: 'Warga Contoh',
      hp: '0800',
    });
    expect(r.isian).toEqual({ '{{PEMOHON.NAMA}}': 'Warga Contoh', '{{PEMOHON.HP}}': '0800' });
    expect(r.kurang).toEqual(['Tempat lahir', 'Data lain']);
    expect(labelPlaceholder('{{PEMOHON.NIK}}')).toBe('NIK');
  });

  it('status sesi menjadi keadaan layar', () => {
    expect(keadaanDariSesi({ status: 'antre', mode: 'ai' }, false)).toBe('antre');
    expect(keadaanDariSesi({ status: 'menunggu_data', mode: 'ai' }, false)).toBe('menyiapkan');
    expect(keadaanDariSesi({ status: 'berjalan', mode: 'ai' }, false)).toBe('ai');
    expect(keadaanDariSesi({ status: 'berjalan', mode: 'takeover' }, true)).toBe('giliran');
    expect(keadaanDariSesi({ status: 'siaga', mode: 'takeover' }, false)).toBe('dijeda');
    expect(keadaanDariSesi({ status: 'gagal', mode: 'ai' }, false)).toBe('galat');
    expect(keadaanDariSesi({ status: 'dibatalkan', mode: 'ai' }, false)).toBe('mati');
  });
});
