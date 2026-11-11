import { describe, expect, it } from 'vitest';
import type { UrusinEvent } from '#lib/contracts.js';
import {
  bangunLinimasa,
  barisKonfirmasi,
  labelParam,
  labelProgres,
  nilaiParam,
  unikPerRef,
} from './linimasa.js';

const at = '2026-11-09T01:00:00.000Z';
const ev = (seq: number, type: string, isi: Record<string, unknown> = {}) =>
  ({ seq, at, chainHead: 'h', type, ...isi }) as unknown as UrusinEvent;

describe('bangunLinimasa', () => {
  it('kartu ingatan: simpan tampil; hapus berikutnya menandai kartu lama dibatalkan', () => {
    const butir = { id: 'ing_0123456789abcdef', jenis: 'lansia', label: 'Warga lansia' };
    const out = bangunLinimasa(
      [ev(1, 'ingatan', { aksi: 'simpan', butir }), ev(2, 'ingatan', { aksi: 'hapus', butir })],
      [],
    );
    expect(out.map((x) => [x.jenis, x.jenis === 'ingatan' && x.dibatalkan])).toEqual([
      ['ingatan', true],
      ['ingatan', false],
    ]);
  });

  it('menyisipkan pesan warga sesuai urutan seq dan menggabungkan teks streaming', () => {
    const out = bangunLinimasa(
      [ev(2, 'assistant_text', { delta: 'Halo ' }), ev(3, 'assistant_text', { delta: 'Bu.' }), ev(4, 'done')],
      [
        { teks: 'pertanyaan kedua', setelahSeq: 4 },
        { teks: 'pertanyaan pertama', setelahSeq: 0 },
      ],
    );
    expect(out.map((x) => x.jenis)).toEqual(['warga', 'teks', 'warga']);
    expect(out[0]).toMatchObject({ teks: 'pertanyaan pertama' });
    expect(out[1]).toMatchObject({ teks: 'Halo Bu.' });
  });

  it('usulan wilayah jadi kartu konfirmasi; setelah ditetapkan kartu nonaktif dan muncul kalimat sistem', () => {
    const wonogiri = { kodeKabKota: '3312', nama: 'Kabupaten Wonogiri' };
    const usulan = ev(1, 'wilayah', { status: 'usulan', ktp: wonogiri, sumber: 'data_diri' });
    expect(bangunLinimasa([usulan], [])).toEqual([
      { jenis: 'wilayah', key: 'e1', e: usulan, terakhir: true },
    ]);
    const out = bangunLinimasa(
      [
        usulan,
        ev(2, 'wilayah', {
          status: 'ditetapkan',
          ktp: wonogiri,
          sumber: 'warga',
          tujuan: { kodeKabKota: '3578', nama: 'Kota Surabaya' },
        }),
      ],
      [],
    );
    expect(out[0]).toMatchObject({ jenis: 'wilayah', terakhir: false });
    expect(out[1]).toEqual({
      jenis: 'sistem',
      key: 'e2',
      teks: 'Wilayah KTP: Kabupaten Wonogiri · pindah ke Kota Surabaya',
      at,
    });
  });

  it('heartbeat diabaikan; state penting menjadi kalimat sistem; TERKIRIM menjadi kartu', () => {
    const out = bangunLinimasa(
      [
        ev(1, 'heartbeat'),
        ev(2, 'state', { dari: 'RENCANA_DIUSULKAN', state: 'RENCANA_DISETUJUI' }),
        ev(3, 'state', { dari: 'BARU', state: 'MEMAHAMI' }),
        ev(4, 'state', { dari: 'MENUNGGU_SUBMIT_WARGA', state: 'TERKIRIM' }),
      ],
      [],
    );
    expect(out).toEqual([
      { jenis: 'sistem', key: 'e2', teks: 'Anda menyetujui rencana', at },
      { jenis: 'terkirim', key: 'e4', at },
    ]);
  });

  it('hanya kartu rencana/konfirmasi terakhir yang aktif; konfirmasi memakai permintaan dengan hash sama', () => {
    const req = (seq: number, paramsHash: string) => ev(seq, 'execution_request', { paramsHash, params: {} });
    const out = bangunLinimasa(
      [
        ev(1, 'plan_card', { langkah: [] }),
        ev(2, 'plan_card', { langkah: [] }),
        req(3, 'a'),
        req(4, 'b'),
        ev(5, 'gate', { jenis: 'konfirmasi', pesan: 'Setujui?', paramsHash: 'a' }),
        ev(6, 'gate', { jenis: 'login', pesan: 'Masuk dulu' }),
      ],
      [],
    );
    const rencana = out.filter((x) => x.jenis === 'rencana');
    expect(rencana.map((r) => r.terakhir)).toEqual([false, true]);
    const k = out.find((x) => x.jenis === 'konfirmasi');
    expect(k).toMatchObject({ terakhir: true });
    expect(k?.jenis === 'konfirmasi' && k.permintaan?.seq).toBe(3);
    expect(out.at(-1)).toMatchObject({ jenis: 'giliran', terakhir: true });
  });

  it('galat yang sudah disusul pesan warga tidak lagi aktif', () => {
    const out = bangunLinimasa(
      [ev(1, 'error', { kode: 'TIMEOUT', pesanWarga: 'x' })],
      [{ teks: 'coba lagi', setelahSeq: 1 }],
    );
    expect(out.map((x) => x.jenis)).toEqual(['galat', 'warga']);
    expect(out[0]).toMatchObject({ terakhir: false });
  });
});

describe('label untuk warga', () => {
  it('labelProgres menyembunyikan nama tool teknis', () => {
    expect(labelProgres('Menjalankan rag__cari_pengetahuan…')).toBe('Mencari sumber resmi…');
    expect(labelProgres('Menjalankan alat_baru…')).toBe('Urusin sedang bekerja…');
    expect(labelProgres(null, 'urusan__susun_rencana')).toBe('Menyusun rencana…');
    expect(labelProgres(null)).toBe('Urusin sedang bekerja…');
    expect(labelProgres('Membaca peraturan')).toBe('Membaca peraturan');
  });

  it('labelParam dan nilaiParam', () => {
    expect(labelParam('namaAnak')).toBe('Nama anak');
    expect(labelParam('tanggal_lahir')).toBe('Tanggal lahir');
    expect(nilaiParam(true)).toBe('Ya');
    expect(nilaiParam(false)).toBe('Tidak');
    expect(nilaiParam('{{PEMOHON.NIK}}')).toBe('Diambil dari Data Diri Anda');
    expect(nilaiParam(3)).toBe('3');
  });
});

describe('unikPerRef', () => {
  it('satu klaim dengan dua kutipan dari potongan yang sama hanya menyisakan satu per refId', () => {
    // Kasus produksi (KTP-el rusak Wonogiri): "Tatap muka langsung" dan "melalui Loket Online" sama-sama #1.
    const out = unikPerRef([
      { refId: 'wonogiri-ktp-el#1', kutipanPersis: 'Tatap muka langsung' },
      { refId: 'wonogiri-ktp-el#1', kutipanPersis: 'melalui Loket Online' },
      { refId: 'wonogiri-ktp-el#2', kutipanPersis: 'loket Kecamatan' },
    ]);
    expect(out.map((q) => q.refId)).toEqual(['wonogiri-ktp-el#1', 'wonogiri-ktp-el#2']);
    expect(out[0]?.kutipanPersis).toBe('Tatap muka langsung');
  });
});

describe('barisKonfirmasi', () => {
  it('menyembunyikan parameter rute dan membuat daftar berkas terbaca', () => {
    // Telunjuk Sakti Wonogiri (adapter) dan portal generik Makassar, seperti tampil di produksi.
    expect(barisKonfirmasi({ layanan_id: 23, berkas: 'kk,ktp,surat' })).toEqual([
      ['Berkas yang diunggah', 'KK, KTP, SURAT'],
    ]);
    expect(barisKonfirmasi({ jenis: 'kelahiran', kode: '7371', jalur: '/' })).toEqual([]);
    expect(barisKonfirmasi({ namaAnak: '{{DIRI:nama}}', setuju: true })).toEqual([
      ['Nama anak', 'Diambil dari Data Diri Anda'],
      ['Setuju', 'Ya'],
    ]);
  });
});

describe('teks agen', () => {
  it('penanda tebal Markdown dibuang, bukan ditampilkan mentah', () => {
    // QA warga Medan/Surabaya: "KTP Anda terdaftar di **Kota Medan**, betul?"
    const out = bangunLinimasa(
      [
        ev(1, 'assistant_text', { delta: 'KTP Anda terdaftar di **Kota ' }),
        ev(2, 'assistant_text', { delta: 'Medan**, betul? Pakai 2 * 3 berkas.' }),
      ],
      [],
    );
    expect(out).toMatchObject([
      { jenis: 'teks', teks: 'KTP Anda terdaftar di Kota Medan, betul? Pakai 2 * 3 berkas.' },
    ]);
  });
});
