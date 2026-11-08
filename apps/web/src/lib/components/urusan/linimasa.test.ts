import { describe, expect, it } from 'vitest';
import type { UrusinEvent } from '#lib/contracts.js';
import { bangunLinimasa, labelParam, labelProgres, nilaiParam } from './linimasa.js';

const at = '2026-11-09T01:00:00.000Z';
const ev = (seq: number, type: string, isi: Record<string, unknown> = {}) =>
  ({ seq, at, chainHead: 'h', type, ...isi }) as unknown as UrusinEvent;

describe('bangunLinimasa', () => {
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
