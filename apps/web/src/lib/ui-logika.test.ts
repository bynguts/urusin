import { describe, expect, it } from 'vitest';
import { menuAktif, rutAuth, rutWeb } from './components/shell/navigasi.js';
import { periksaBerkas, samarkan, ukuranBerkas } from './akun/klien.js';
import { daftarWrite, kolomDari, labelPlaceholder, petakanIsian } from './pendamping/isi-data.js';
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
    expect(rutWeb('/cara-kerja')).toBe(true);
    expect(rutWeb('/urusan')).toBe(true);
    expect(rutWeb(`/urusan/u_${'a'.repeat(32)}`)).toBe(false);
    expect(menuAktif('/beranda', '/peristiwa/kelahiran')).toBe(true);
    expect(menuAktif('/beranda', '/urusanku')).toBe(false);
    // App 02–09: halaman satu urusan menyorot urusannya di "Urusan aktif", bukan menu.
    expect(menuAktif('/urusanku', `/urusan/u_${'a'.repeat(32)}`)).toBe(false);
    expect(menuAktif('/urusanku', `/jejak/u_${'a'.repeat(32)}`)).toBe(false);
    expect(menuAktif('/pengaturan', '/pengaturan')).toBe(true);
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
    expect(r.kurang).toEqual(['Data lain', 'Data lain']);
    expect(labelPlaceholder('{{PEMOHON.NIK}}')).toBe('NIK');
    expect(labelPlaceholder('{{KENDARAAN.NOPOL_ANGKA}}')).toBe('Angka nomor polisi');
    expect(labelPlaceholder('{{URUSAN.KITIR}}')).toBe('Nomor kitir');
    expect(labelPlaceholder('{{X.CONSTRUCTOR}}')).toBe('Data lain');
  });

  it('daftar write "Izinkan isi": placeholder Data Diri + berkas:<JENIS>; non-Data Diri tidak ikut', () => {
    const f = daftarWrite(
      ['{{PEMOHON.NIK}}', '{{ANAK.NIK}}', '{{PEMOHON.HP}}', '{{URUSAN.KITIR}}', '{{PEMOHON.NIK}}'],
      ['ktp'],
    );
    expect(f).toEqual(['{{PEMOHON.NIK}}', '{{PEMOHON.HP}}', 'berkas:KTP']);
    expect(daftarWrite(['{{KENDARAAN.NOPOL_ANGKA}}'], [])).toEqual([]);
    expect(kolomDari('{{PEMOHON.HP}}')).toBe('hp');
    expect(kolomDari('{{URUSAN.KITIR}}')).toBeUndefined();
    for (const p of [
      '{{ANAK.NIK}}',
      '{{ORANG2.NIK}}',
      '{{PEMOHON.AYAH.NAMA}}',
      '{{PEMOHON.ALAMAT.RT}}',
      '{{XPEMOHON.NIK}}',
    ])
      expect(kolomDari(p)).toBeUndefined();
  });

  it('izinkanIsi: kirim daftar write + origin butuh_data (tanpa nilai); yang kurang jadi pesan; galat diteruskan', async () => {
    const kiriman: { url: string; body: string }[] = [];
    let jawab: () => Response = () => Response.json({ diizinkan: true, kurang: ['Nomor kitir', 'KTP'] });
    const s = new SesiPendampingUi(
      'u_1',
      async () => null,
      async (url, init) => {
        kiriman.push({ url: String(url), body: String(init?.body) });
        return jawab();
      },
    );
    const ORIGIN_SITUS = 'https://telunjuksakti.wonogirikab.go.id';
    expect(await s.izinkanIsi()).toBeUndefined();
    expect(kiriman).toHaveLength(0);
    s.data = {
      ...s.data,
      butuhData: {
        placeholder: ['{{PEMOHON.NIK}}', '{{URUSAN.KITIR}}'],
        berkas: ['ktp'],
        origin: ORIGIN_SITUS,
      },
    };
    expect(await s.izinkanIsi()).toBe('Isi sendiri di layar: Nomor kitir, KTP.');
    expect(kiriman[0]).toEqual({
      url: '/api/urusan/u_1/izinkan-isi',
      body: JSON.stringify({ writeList: ['{{PEMOHON.NIK}}', 'berkas:KTP'], targetOrigin: ORIGIN_SITUS }),
    });
    expect(s.data.butuhData).not.toBeNull();
    jawab = () => Response.json({ diizinkan: true, kurang: [] });
    expect(await s.izinkanIsi()).toBeUndefined();
    expect(s.data.butuhData).toBeNull();
    // Hanya data non-Data Diri: tidak ada yang bisa diambil server; tidak ada permintaan.
    s.data = {
      ...s.data,
      butuhData: { placeholder: ['{{KENDARAAN.NOPOL_ANGKA}}'], berkas: [], origin: ORIGIN_SITUS },
    };
    expect(await s.izinkanIsi()).toBe('Isi sendiri di layar: Angka nomor polisi.');
    expect(kiriman).toHaveLength(2);
    s.data = { ...s.data, butuhData: { placeholder: ['{{PEMOHON.NIK}}'], berkas: [] } };
    expect(await s.izinkanIsi()).toMatch(/Situs tujuan belum diketahui/);
    s.data = { ...s.data, butuhData: { placeholder: ['{{PEMOHON.NIK}}'], berkas: [], origin: ORIGIN_SITUS } };
    jawab = () =>
      Response.json({ kode: 'IZIN_TIDAK_VALID', pesanWarga: 'Persetujuan tidak cocok.' }, { status: 403 });
    expect(await s.izinkanIsi()).toBe('Persetujuan tidak cocok.');
    jawab = () => new Response('x', { status: 500 });
    expect(await s.izinkanIsi()).toMatch(/Izin belum tercatat/);
    jawab = () => {
      throw new Error('jaringan');
    };
    expect(await s.izinkanIsi()).toMatch(/Koneksi terputus/);
  });

  it('izinkanIsi Navigator generik: hanya data yang dicentang + rencanaHash; lembar tertutup, AI lanjut', async () => {
    const kiriman: string[] = [];
    const s = new SesiPendampingUi(
      'u_3',
      async () => null,
      async (_url, init) => {
        kiriman.push(String(init?.body));
        return Response.json({ diizinkan: true, kurang: ['NIK'] });
      },
    );
    const H = 'c'.repeat(64);
    const ORIGIN_SITUS = 'https://sidnok.semarangkota.go.id';
    s.data = {
      ...s.data,
      butuhData: {
        placeholder: ['{{PEMOHON.NIK}}', '{{PEMOHON.NAMA}}'],
        berkas: ['KTP'],
        origin: ORIGIN_SITUS,
        kolom: [
          { placeholder: '{{PEMOHON.NIK}}', labelPortal: 'Nomor identitas', tidakLazim: true },
          { placeholder: '{{PEMOHON.NAMA}}', labelPortal: 'Nama Pemohon' },
        ],
        rencanaHash: H,
      },
    };
    expect(await s.izinkanIsi({ placeholder: ['{{PEMOHON.NAMA}}'], berkas: ['KTP'] })).toBeUndefined();
    expect(JSON.parse(kiriman[0]!)).toEqual({
      writeList: ['{{PEMOHON.NAMA}}', 'berkas:KTP'],
      targetOrigin: ORIGIN_SITUS,
      rencanaHash: H,
    });
    expect(s.data.butuhData).toBeNull();
  });

  it('Lanjutkan pada berkas_kurang: izin baru untuk berkas itu saja, lalu kendali kembali; giliran lain langsung', async () => {
    const kiriman: string[] = [];
    let kurang: string[] = [];
    const s = new SesiPendampingUi(
      'u_2',
      async () => null,
      async (url, init) => {
        kiriman.push(`${String(url)} ${String(init?.body)}`);
        return Response.json({ diizinkan: true, kurang });
      },
    );
    const viewer = { kembali: 0, kembalikan: () => void viewer.kembali++ };
    (s as unknown as { viewer: unknown }).viewer = viewer;
    const SITUS = 'https://telunjuksakti.wonogirikab.go.id';
    s.terapkanEvent({
      jenis: 'giliran_anda',
      alasan: 'berkas_kurang',
      pesan: 'Dokumen KK belum ada. Tambahkan di Dokumen, lalu tekan Lanjutkan.',
      berkas: { nama: 'kk', origin: SITUS },
    });
    expect(s.data.keadaan).toBe('giliran');
    kurang = ['KK'];
    await s.kembalikan();
    expect(kiriman).toEqual([
      `/api/urusan/u_2/izinkan-isi ${JSON.stringify({ writeList: ['berkas:KK'], targetOrigin: SITUS })}`,
    ]);
    // Masih belum ada: pesan jujur, kendali tetap dikembalikan (langkah unggah diulang, giliran muncul lagi).
    expect(s.data.pesan).toBe('Isi sendiri di layar: KK.');
    expect(s.data.giliran).toBeNull();
    expect(viewer.kembali).toBe(1);
    // Giliran isi_sendiri: tidak ada permintaan izin.
    s.terapkanEvent({ jenis: 'giliran_anda', alasan: 'isi_sendiri', pesan: 'Ketik Nomor kitir' });
    await s.kembalikan();
    expect(kiriman).toHaveLength(1);
    expect(viewer.kembali).toBe(2);
  });

  it('status sesi menjadi keadaan layar', () => {
    expect(keadaanDariSesi({ status: 'antre', mode: 'ai' }, false)).toBe('antre');
    // Izin isi diminta: "Menyiapkan" hanya sampai portal tergambar; sesudahnya situs tetap terlihat.
    expect(keadaanDariSesi({ status: 'menunggu_data', mode: 'ai' }, false)).toBe('menyiapkan');
    expect(keadaanDariSesi({ status: 'menunggu_data', mode: null }, false, true)).toBe('ai');
    expect(keadaanDariSesi({ status: 'menunggu_data', mode: 'takeover' }, false, true)).toBe('dijeda');
    expect(keadaanDariSesi({ status: 'memulai', mode: null }, false, true)).toBe('menyiapkan');
    expect(keadaanDariSesi({ status: 'berjalan', mode: 'ai' }, false)).toBe('ai');
    expect(keadaanDariSesi({ status: 'berjalan', mode: 'takeover' }, true)).toBe('giliran');
    expect(keadaanDariSesi({ status: 'siaga', mode: 'takeover' }, false)).toBe('siaga');
    expect(keadaanDariSesi({ status: 'gagal', mode: 'ai' }, false)).toBe('galat');
    expect(keadaanDariSesi({ status: 'dibatalkan', mode: 'ai' }, false)).toBe('mati');
  });
});
