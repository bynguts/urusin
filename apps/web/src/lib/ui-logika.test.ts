import { describe, expect, it } from 'vitest';
import { menuAktif, rutAuth } from './components/shell/navigasi.js';
import { periksaBerkas, samarkan, ukuranBerkas } from './akun/klien.js';
import { daftarWrite, hashDaftarWrite, labelPlaceholder, petakanIsian } from './pendamping/isi-data.js';
import { keadaanDariSesi, SesiPendampingUi } from './pendamping/sesi.svelte.js';
import {
  FASE,
  LABEL_STATE,
  LANGKAH_RENCANA,
  domain,
  faseUrusan,
  infoStatus,
  tanggal,
  waktuSingkat,
} from './urusan-status.js';

describe('status urusan', () => {
  it('fase Ringkasan: empat fase berurutan mengikuti state', () => {
    expect(FASE).toHaveLength(4);
    expect(faseUrusan(null)).toBe(1);
    expect(faseUrusan('RENCANA_DIUSULKAN')).toBe(1);
    expect(faseUrusan('MENYIAPKAN_BERKAS')).toBe(2);
    expect(faseUrusan('MENUNGGU_SUBMIT_WARGA')).toBe(3);
    expect(faseUrusan('DIPANDU')).toBe(3);
    expect(faseUrusan('SELESAI')).toBe(4);
    expect(faseUrusan('GAGAL_AMAN')).toBe(1);
  });

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
    expect(menuAktif('/jejak', `/jejak/u_${'a'.repeat(32)}`)).toBe(true);
    expect(menuAktif('/urusanku', `/jejak/u_${'a'.repeat(32)}`)).toBe(false);
    expect(menuAktif('/dokumen', '/data-diri')).toBe(true);
    expect(menuAktif('/bantuan', '/bantuan')).toBe(true);
  });
});

describe('brankas akun', () => {
  it('memeriksa berkas sebelum unggah', () => {
    const f = (type: string, size: number) => ({ type, size }) as File;
    expect(periksaBerkas(f('image/jpeg', 1000))).toBeNull();
    expect(periksaBerkas(f('application/pdf', 6 * 1024 * 1024))).toMatch(/Maksimal 5 MB/);
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
    expect(labelPlaceholder('{{KENDARAAN.NOPOL_ANGKA}}')).toBe('Angka nomor polisi');
    expect(labelPlaceholder('{{URUSAN.KITIR}}')).toBe('Nomor kitir');
    expect(labelPlaceholder('{{X.CONSTRUCTOR}}')).toBe('Data lain');
  });

  it('daftar write "Izinkan isi": field Data Diri + berkas, unik terurut; hash sha256 hex', async () => {
    const f = daftarWrite(['{{PEMOHON.NIK}}', '{{ANAK.NIK}}', '{{PEMOHON.HP}}', '{{URUSAN.KITIR}}'], ['KTP']);
    expect(f).toEqual(['berkas:ktp', 'hp', 'nik']);
    // Vektor: sha256 dari "hp" + baris baru + "nik".
    expect(await hashDaftarWrite(['nik', 'hp', 'nik'])).toBe(
      '87a153264c87d1ad4ecb3b17785ea20c965827265aa36a286fea989392733c28',
    );
    expect(await hashDaftarWrite([])).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('izinkanIsi: hanya hash yang dikirim; yang kurang jadi pesan; galat server diteruskan', async () => {
    const kiriman: { url: string; body: string }[] = [];
    let jawab: () => Response = () =>
      Response.json({ kurang: { placeholder: ['Nomor kitir'], berkas: ['ktp'] } });
    const s = new SesiPendampingUi(
      'u_1',
      async () => null,
      async (url, init) => {
        kiriman.push({ url: String(url), body: String(init?.body) });
        return jawab();
      },
    );
    expect(await s.izinkanIsi()).toBeUndefined();
    expect(kiriman).toHaveLength(0);
    s.data = {
      ...s.data,
      butuhData: { placeholder: ['{{PEMOHON.NIK}}', '{{URUSAN.KITIR}}'], berkas: ['ktp'] },
    };
    expect(await s.izinkanIsi()).toBe('Isi sendiri di layar: Nomor kitir, KTP.');
    expect(kiriman[0]).toEqual({
      url: '/api/urusan/u_1/pendamping/izinkan',
      body: JSON.stringify({ writeListHash: await hashDaftarWrite(['berkas:ktp', 'nik']) }),
    });
    expect(s.data.butuhData).not.toBeNull();
    jawab = () => Response.json({ kurang: { placeholder: [], berkas: [] } });
    expect(await s.izinkanIsi()).toBeUndefined();
    expect(s.data.butuhData).toBeNull();
    s.data = { ...s.data, butuhData: { placeholder: ['{{PEMOHON.NIK}}'], berkas: [] } };
    jawab = () =>
      Response.json({ kode: 'ISI_OTOMATIS_TIDAK_TERSEDIA', pesanWarga: 'Belum tersedia.' }, { status: 503 });
    expect(await s.izinkanIsi()).toBe('Belum tersedia.');
    jawab = () => new Response('x', { status: 500 });
    expect(await s.izinkanIsi()).toMatch(/belum bisa dipakai/);
    jawab = () => {
      throw new Error('jaringan');
    };
    expect(await s.izinkanIsi()).toMatch(/Koneksi terputus/);
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
