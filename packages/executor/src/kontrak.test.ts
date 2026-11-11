import { afterEach, describe, expect, it } from 'vitest';
import {
  HasilAksiSchema,
  KELAS_BOLEH_KLIK_AI as KELAS_KONTRAK,
  KelasKendaliSchema,
  PengamatanSchema,
} from '@urusin/contracts';
import { bangunPengamatan, sidikElemen } from './amatan.js';
import { KELAS_BOLEH_KLIK_AI, bolehDiklikAi } from './klasifikasi.js';
import { jalankanAksi, keHasilKontrak, setNativeValue, type HasilAksi } from './runner-ops.js';

afterEach(() => {
  document.body.innerHTML = '';
  document.title = '';
});

/** Kompatibilitas runtime runner dengan skema zod @urusin/contracts (WP-D). */
describe('kontrak: PengamatanSchema', () => {
  const HALAMAN = [
    '<h1>Kosong</h1>',
    `<h1>Formulir</h1><div role="alert">Periksa kolom</div><form>
      <label>NIK * <input name="nik" required></label><label>Kata Sandi <input type="password"></label>
      <select aria-label="Agama"><option value="">-</option><option>Islam</option></select>
      <fieldset><legend>JK</legend><label><input type="radio" name="jk"> L</label><label><input type="radio" name="jk"> P</label></fieldset>
      <label><input type="checkbox"> Saya menyatakan data benar</label><label>KTP <input type="file"></label>
      <textarea aria-label="Alamat"></textarea><button type="button">Lanjut</button><button>Kirim</button></form>
      <a href="/layanan">Layanan</a><div role="tab">Tab</div>`,
    Array.from(
      { length: 220 },
      (_, i) => `<a href="/m/${i}">${'Menu sangat panjang '.repeat(10)}${i}</a>`,
    ).join(''),
    `<select aria-label="${'x'.repeat(300)}">${Array.from({ length: 70 }, (_, i) => `<option>${'o'.repeat(200)}${i}</option>`).join('')}</select>` +
      Array.from({ length: 50 }, () => `<h2>${'Judul '.repeat(40)}</h2>`).join(''),
  ];

  it.each(HALAMAN.map((h, i) => [i, h]))('halaman %i lolos PengamatanSchema.parse', (_i, html) => {
    document.title = 'Judul '.repeat(40);
    document.body.innerHTML = html as string;
    const { pengamatan } = bangunPengamatan(document, { seq: 5 });
    expect(() => PengamatanSchema.parse(pengamatan)).not.toThrow();
  });

  it('isian placeholder dari worker lolos skema (PlaceholderVaultSchema)', () => {
    document.body.innerHTML = '<label>Nama <input name="n"></label>';
    const input = document.querySelector('input')!;
    setNativeValue(input, 'nama contoh');
    const { pengamatan } = bangunPengamatan(document, {
      seq: 0,
      diisi: { [sidikElemen(input)]: '{{PEMOHON.NAMA}}' },
    });
    expect(PengamatanSchema.parse(pengamatan).elemen[0]!.isian).toBe('{{PEMOHON.NAMA}}');
  });
});

describe('kontrak: kelas kendali', () => {
  it('salinan runtime KELAS_BOLEH_KLIK_AI sama dengan kontrak; semua kelas ada di skema', () => {
    expect([...KELAS_BOLEH_KLIK_AI]).toEqual([...KELAS_KONTRAK]);
    expect(KelasKendaliSchema.options.filter(bolehDiklikAi)).toEqual([...KELAS_KONTRAK]);
  });
});

describe('kontrak: HasilAksiSchema', () => {
  it('setiap status/kode runner dipetakan ke kode kontrak yang sah', () => {
    const contoh: [HasilAksi, string][] = [
      [{ i: 0, jenis: 'isi', ref: 'e1', status: 'ok', aturan: 'A_OK' }, 'ok'],
      [
        { i: 1, jenis: 'klik', ref: 'e2', status: 'navigasi', aturan: 'K8_NAVIGASI', kelas: 'navigasi' },
        'ok',
      ],
      [
        { i: 2, jenis: 'klik', ref: 'e3', status: 'gagal', aturan: 'A_REF_BASI', kode: 'REF_BASI' },
        'REF_BASI',
      ],
      [
        {
          i: 3,
          jenis: 'klik',
          ref: 'e4',
          status: 'gagal',
          aturan: 'A_REF_TIDAK_DIKENAL',
          kode: 'REF_TIDAK_DIKENAL',
        },
        'REF_TIDAK_ADA',
      ],
      [
        {
          i: 4,
          jenis: 'klik',
          ref: 'e5',
          status: 'ditolak',
          aturan: 'K4_SUBMITTER',
          kode: 'KLIK_DITOLAK',
          kelas: 'kirim',
        },
        'KELAS_DITOLAK',
      ],
      [
        { i: 5, jenis: 'isi', ref: 'e6', status: 'ditolak', aturan: 'A_TERLARANG', kode: 'TERLARANG' },
        'TERLARANG',
      ],
      [
        {
          i: 6,
          jenis: 'klik',
          ref: 'e7',
          status: 'ditolak',
          aturan: 'A_HALAMAN_AKHIR',
          kode: 'HALAMAN_AKHIR',
        },
        'HALAMAN_AKHIR',
      ],
      [{ i: 7, jenis: 'isi', ref: 'e8', status: 'dilewati', aturan: 'A_DILEWATI' }, 'DILEWATI'],
      [
        {
          i: 8,
          jenis: 'pilih',
          ref: 'e9',
          status: 'gagal',
          aturan: 'A_OPSI_TIDAK_ADA',
          kode: 'OPSI_TIDAK_ADA',
        },
        'GALAT',
      ],
      [{ i: 9, jenis: 'isi', ref: 'e1', status: 'gagal', aturan: 'A_GALAT', kode: 'RUNNER_ERROR' }, 'GALAT'],
    ];
    for (const [h, kode] of contoh) {
      const k = HasilAksiSchema.parse(keHasilKontrak(h));
      expect(k.kode).toBe(kode);
      expect(k.indeks).toBe(h.i);
      expect(k.kelas).toBe(h.kelas);
    }
  });

  it('hasil nyata op aksi lolos skema setelah dipetakan', () => {
    document.body.innerHTML =
      '<label>Nama <input name="n"></label><form><button type="submit">Kirim</button></form>';
    const { peta } = bangunPengamatan(document, { seq: 0 });
    const { hasil } = jalankanAksi(
      document,
      [
        { jenis: 'isi', ref: 'e1', placeholder: '{{PEMOHON.NAMA}}', nilai: 'Nama Contoh' },
        { jenis: 'klik', ref: 'e2' },
        { jenis: 'klik', ref: 'e1' },
      ],
      peta,
    );
    expect(hasil.map((h) => HasilAksiSchema.parse(keHasilKontrak(h)).kode)).toEqual([
      'ok',
      'KELAS_DITOLAK',
      'DILEWATI',
    ]);
  });
});
