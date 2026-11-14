import { describe, expect, it } from 'vitest';
import type { UrusinEvent } from '#lib/contracts.js';
import {
  bangunLinimasa,
  barisKonfirmasi,
  jenisTerkini,
  kalimatWilayah,
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
    const usulan = ev(1, 'wilayah', { status: 'usulan', ktp: wonogiri, sumber: 'warga' });
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
      teks: 'Pindah dari Kabupaten Wonogiri ke Kota Surabaya',
      at,
    });
  });

  it('usulan awal (Data Diri) bukan pembuka obrolan: tersembunyi sampai jenis jelas, lalu di ujung', () => {
    const wonogiri = { kodeKabKota: '3312', nama: 'Kabupaten Wonogiri' };
    const usulan = ev(1, 'wilayah', { status: 'usulan', ktp: wonogiri, sumber: 'data_diri' });
    const balasan = ev(2, 'assistant_text', { delta: 'Barang apa yang hilang?' });
    const pesan = [{ teks: 'aku kehilangan barang', setelahSeq: 0 }];
    // Jenis belum diketahui ("kehilangan barang"): tanpa kartu wilayah.
    expect(bangunLinimasa([usulan, balasan], pesan, null).map((x) => x.jenis)).toEqual(['warga', 'teks']);
    expect(bangunLinimasa([usulan, balasan], pesan, 'lainnya').map((x) => x.jenis)).toEqual([
      'warga',
      'teks',
    ]);
    // Jenis jelas: rencana menunggu wilayah, kartu aktif tampil di ujung percakapan.
    const out = bangunLinimasa([usulan, balasan], pesan, 'ktp');
    expect(out.map((x) => x.jenis)).toEqual(['warga', 'teks', 'wilayah']);
    expect(out.at(-1)).toMatchObject({ terakhir: true });
    // Sudah ditetapkan: kartu awal hilang, cukup kalimat sistem.
    const tetap = ev(3, 'wilayah', { status: 'ditetapkan', ktp: wonogiri, sumber: 'warga' });
    expect(bangunLinimasa([usulan, balasan, tetap], pesan, 'ktp').map((x) => x.jenis)).toEqual([
      'warga',
      'teks',
      'sistem',
    ]);
  });

  it('halaman dimuat sebelum klasifikasi: jenis dari `done` memunculkan kartu Data Diri tanpa muat ulang', () => {
    // Urutan event prod "syarat akta kelahiran di Wonogiri apa saja?" (giliran hanya kartu wilayah, tanpa rencana).
    const wonogiri = { kodeKabKota: '3312', nama: 'Kabupaten Wonogiri' };
    const events = [
      ev(1, 'wilayah', { status: 'usulan', ktp: wonogiri, sumber: 'data_diri' }),
      ev(2, 'state', { state: 'MEMAHAMI', dari: 'BARU', tier: null, version: 2 }),
      ev(3, 'progress', { label: 'Memahami kebutuhan Anda…' }),
      ev(4, 'done', { turnId: 't1', status: 'selesai', lanjutkan: false, degraded: false, jenis: 'kelahiran' }),
    ];
    const pesan = [{ teks: 'syarat akta kelahiran di Wonogiri apa saja?', setelahSeq: 0 }];
    expect(jenisTerkini(events.slice(0, 3), null)).toBeNull();
    const jenis = jenisTerkini(events, null);
    expect(jenis).toBe('kelahiran');
    expect(bangunLinimasa(events, pesan, jenis).map((x) => x.jenis)).toEqual(['warga', 'wilayah']);
    // Jenis saat dimuat tetap dipakai bila stream belum membawanya; rencana yang lebih baru menang.
    expect(jenisTerkini([], 'ktp')).toBe('ktp');
    expect(jenisTerkini([...events, ev(5, 'plan_card', { jenis: 'pindah', langkah: [] })], null)).toBe('pindah');
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
    expect(labelProgres('Menjalankan web__cari…', 'web__cari')).toBe('Mencari di situs resmi pemerintah…');
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
  it('Markdown dipertahankan utuh untuk TeksKaya (tebal dirender, bukan tampil mentah)', () => {
    // QA warga Medan/Surabaya: "KTP Anda terdaftar di **Kota Medan**, betul?"
    const out = bangunLinimasa(
      [
        ev(1, 'assistant_text', { delta: 'KTP Anda terdaftar di **Kota ' }),
        ev(2, 'assistant_text', { delta: 'Medan**, betul? Pakai 2 * 3 berkas.' }),
      ],
      [],
    );
    expect(out).toMatchObject([
      { jenis: 'teks', teks: 'KTP Anda terdaftar di **Kota Medan**, betul? Pakai 2 * 3 berkas.' },
    ]);
  });

  it('pesan utuh dari server (di luar turn): gelembung sendiri, tidak menyambung dan tidak disambung', () => {
    const out = bangunLinimasa(
      [
        ev(1, 'assistant_text', { delta: 'Halo.' }),
        ev(2, 'assistant_text', { delta: 'Browser Pendamping melaporkan langkah berhasil.', utuh: true }),
        ev(3, 'assistant_text', { delta: 'Bukti dari situs resmi: nomor X.', utuh: true }),
        ev(4, 'assistant_text', { delta: 'Teks turn berikutnya.' }),
      ],
      [],
    );
    expect(out.map((x) => x.jenis === 'teks' && x.teks)).toEqual([
      'Halo.',
      'Browser Pendamping melaporkan langkah berhasil.',
      'Bukti dari situs resmi: nomor X.',
      'Teks turn berikutnya.',
    ]);
  });

  it('persetujuan dipandu: pesan tetap sendiri; turn berikutnya (tanpa pesan warga) tidak menyambungnya', () => {
    const out = bangunLinimasa(
      [
        ev(1, 'state', { dari: 'RENCANA_DIUSULKAN', state: 'RENCANA_DISETUJUI' }),
        ev(2, 'assistant_text', { delta: 'Rencana disetujui. Kami pandu langkahnya.' }),
        ev(3, 'progress', { label: 'Memahami kebutuhan Anda…' }),
        ev(4, 'assistant_text', { delta: 'Lanjut ke langkah berikutnya.' }),
        ev(5, 'done', { turnId: 't', status: 'selesai', lanjutkan: false, degraded: false }),
      ],
      [],
    );
    expect(out.filter((x) => x.jenis === 'teks').map((x) => x.jenis === 'teks' && x.teks)).toEqual([
      'Rencana disetujui. Kami pandu langkahnya.',
      'Lanjut ke langkah berikutnya.',
    ]);
  });
});

describe('linimasa mengikuti kejadian nyata', () => {
  const burstSetuju = [
    ev(1, 'state', { dari: 'RENCANA_DIUSULKAN', state: 'RENCANA_DISETUJUI' }),
    ev(2, 'state', { dari: 'RENCANA_DISETUJUI', state: 'MENYIAPKAN_BERKAS' }),
    ev(3, 'state', { dari: 'MENYIAPKAN_BERKAS', state: 'BERKAS_SIAP' }),
    ev(4, 'state', { dari: 'BERKAS_SIAP', state: 'MENGISI' }),
    ev(5, 'state', { dari: 'MENGISI', state: 'MENUNGGU_KONFIRMASI' }),
  ];

  it('persetujuan rencana: tanpa "Semua dokumen siap" dan tanpa "AI mulai mengisi" dari state pembukuan', () => {
    const teks = bangunLinimasa(burstSetuju, []).map((x) => (x.jenis === 'sistem' ? x.teks : x.jenis));
    expect(teks).toEqual(['Anda menyetujui rencana']);
  });

  it('"Semua dokumen siap" hanya bila checklist terakhir lengkap', () => {
    const lengkap = ev(0, 'checklist', {
      item: [
        { id: 'a', label: 'KTP', status: 'ok' },
        { id: 'b', label: 'KK', status: 'ok' },
      ],
    });
    const kurang = ev(0, 'checklist', {
      item: [
        { id: 'a', label: 'KTP', status: 'ok' },
        { id: 'b', label: 'KK', status: 'perlu' },
      ],
    });
    const sistem = (cl: UrusinEvent) =>
      bangunLinimasa(
        [{ ...cl, seq: 1 } as UrusinEvent, ...burstSetuju.map((e) => ({ ...e, seq: e.seq + 1 }))],
        [],
      )
        .filter((x) => x.jenis === 'sistem')
        .map((x) => x.jenis === 'sistem' && x.teks);
    expect(sistem(lengkap)).toEqual(['Anda menyetujui rencana', 'Semua dokumen siap']);
    expect(sistem(kurang)).toEqual(['Anda menyetujui rencana']);
    expect(sistem(ev(0, 'checklist', { item: [] }))).toEqual(['Anda menyetujui rencana']);
  });

  it('kalimat wilayah netral per jenis: layanan, pindah asal ke tujuan, domisili', () => {
    const sleman = { kodeKabKota: '3404', nama: 'Kabupaten Sleman' };
    const smg = { kodeKabKota: '3374', nama: 'Kota Semarang' };
    const w = (isi: Record<string, unknown>) =>
      ev(1, 'wilayah', { status: 'ditetapkan', sumber: 'warga', ...isi }) as Extract<
        UrusinEvent,
        { type: 'wilayah' }
      >;
    expect(kalimatWilayah(w({ ktp: sleman }), 'kematian')).toBe('Wilayah layanan: Kabupaten Sleman');
    expect(kalimatWilayah(w({ ktp: sleman }))).toBe('Wilayah layanan: Kabupaten Sleman');
    expect(kalimatWilayah(w({ ktp: smg, tujuan: sleman }), 'pindah')).toBe(
      'Pindah dari Kota Semarang ke Kabupaten Sleman',
    );
    expect(kalimatWilayah(w({ ktp: smg }), 'pindah')).toBe('Pindah dari Kota Semarang');
    expect(kalimatWilayah(w({ ktp: smg, domisili: sleman }), 'kelahiran')).toBe(
      'Wilayah layanan: Kota Semarang · tinggal di Kabupaten Sleman',
    );
    expect(kalimatWilayah(w({ ktp: sleman }), 'kematian')).not.toMatch(/KTP/);
    // bangunLinimasa meneruskan jenis
    const out = bangunLinimasa([w({ ktp: sleman })], [], 'kematian');
    expect(out[0]).toMatchObject({ jenis: 'sistem', teks: 'Wilayah layanan: Kabupaten Sleman' });
  });
});
