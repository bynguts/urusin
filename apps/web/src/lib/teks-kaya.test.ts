import { describe, expect, it } from 'vitest';
import { panjangTeksKaya, potongTeksKaya, uraiInline, uraiTeksKaya } from './teks-kaya.js';

describe('uraiInline', () => {
  it('tebal, miring, kode, dan tautan', () => {
    expect(uraiInline('Bawa **KTP-el** dan *KK* asli, cek `F-1.02` di https://contoh.go.id/a.')).toEqual([
      { jenis: 'teks', teks: 'Bawa ' },
      { jenis: 'tebal', isi: [{ jenis: 'teks', teks: 'KTP-el' }] },
      { jenis: 'teks', teks: ' dan ' },
      { jenis: 'miring', isi: [{ jenis: 'teks', teks: 'KK' }] },
      { jenis: 'teks', teks: ' asli, cek ' },
      { jenis: 'kode', teks: 'F-1.02' },
      { jenis: 'teks', teks: ' di ' },
      { jenis: 'tautan', teks: 'https://contoh.go.id/a', href: 'https://contoh.go.id/a' },
      { jenis: 'teks', teks: '.' },
    ]);
  });

  it('bintang aritmetika, penanda tak berpasangan, dan escape tetap teks', () => {
    expect(uraiInline('Pakai 2 * 3 berkas, 2*3*4')).toEqual([
      { jenis: 'teks', teks: 'Pakai 2 * 3 berkas, 2*3*4' },
    ]);
    expect(uraiInline('**belum ditutup')).toEqual([{ jenis: 'teks', teks: '**belum ditutup' }]);
    expect(uraiInline('\\*bukan miring\\*')).toEqual([{ jenis: 'teks', teks: '*bukan miring*' }]);
  });

  it('tebal yang memuat tautan dan miring bersarang', () => {
    expect(uraiInline('**Daftar di https://contoh.go.id sekarang**')).toEqual([
      {
        jenis: 'tebal',
        isi: [
          { jenis: 'teks', teks: 'Daftar di ' },
          { jenis: 'tautan', teks: 'https://contoh.go.id', href: 'https://contoh.go.id/' },
          { jenis: 'teks', teks: ' sekarang' },
        ],
      },
    ]);
    expect(uraiInline('*sangat **penting** ya*')).toEqual([
      {
        jenis: 'miring',
        isi: [
          { jenis: 'teks', teks: 'sangat ' },
          { jenis: 'tebal', isi: [{ jenis: 'teks', teks: 'penting' }] },
          { jenis: 'teks', teks: ' ya' },
        ],
      },
    ]);
  });

  it('HTML tetap teks, javascript: bukan tautan', () => {
    expect(uraiInline('<img src=x onerror=alert(1)> javascript:alert(1)')).toEqual([
      { jenis: 'teks', teks: '<img src=x onerror=alert(1)> javascript:alert(1)' },
    ]);
  });
});

describe('uraiTeksKaya', () => {
  it('paragraf dipisah baris kosong; baris baru tunggal tetap baris', () => {
    const b = uraiTeksKaya('Halo.\nBaris dua.\n\nParagraf baru.');
    expect(b).toEqual([
      {
        jenis: 'paragraf',
        baris: [[{ jenis: 'teks', teks: 'Halo.' }], [{ jenis: 'teks', teks: 'Baris dua.' }]],
      },
      { jenis: 'paragraf', baris: [[{ jenis: 'teks', teks: 'Paragraf baru.' }]] },
    ]);
  });

  it('daftar bertitik dan bernomor, bersarang satu tingkat, lanjutan butir', () => {
    const b = uraiTeksKaya(
      'Siapkan:\n- **KTP-el**\n- KK\n  - asli\n  - fotokopi\n\n3. Datang\n4. Ambil antrean\n   di loket',
    );
    expect(b).toHaveLength(3);
    expect(b[0]).toEqual({ jenis: 'paragraf', baris: [[{ jenis: 'teks', teks: 'Siapkan:' }]] });
    expect(b[1]).toEqual({
      jenis: 'daftar',
      urut: false,
      mulai: 1,
      butir: [
        { isi: [{ jenis: 'tebal', isi: [{ jenis: 'teks', teks: 'KTP-el' }] }], anak: null },
        {
          isi: [{ jenis: 'teks', teks: 'KK' }],
          anak: {
            jenis: 'daftar',
            urut: false,
            mulai: 1,
            butir: [
              { isi: [{ jenis: 'teks', teks: 'asli' }], anak: null },
              { isi: [{ jenis: 'teks', teks: 'fotokopi' }], anak: null },
            ],
          },
        },
      ],
    });
    expect(b[2]).toEqual({
      jenis: 'daftar',
      urut: true,
      mulai: 3,
      butir: [
        { isi: [{ jenis: 'teks', teks: 'Datang' }], anak: null },
        { isi: [{ jenis: 'teks', teks: 'Ambil antrean di loket' }], anak: null },
      ],
    });
  });

  it('judul, kutipan, garis, dan blok kode', () => {
    const b = uraiTeksKaya('## Syarat\n> catatan\n> penting\n---\n```\n<b>x</b>\n```');
    expect(b).toEqual([
      { jenis: 'judul', isi: [{ jenis: 'teks', teks: 'Syarat' }] },
      {
        jenis: 'kutipan',
        baris: [[{ jenis: 'teks', teks: 'catatan' }], [{ jenis: 'teks', teks: 'penting' }]],
      },
      { jenis: 'garis' },
      { jenis: 'kodeblok', teks: '<b>x</b>' },
    ]);
  });

  it('baris yang diawali tebal bukan butir daftar', () => {
    expect(uraiTeksKaya('**Penting:** bawa KK')[0]).toMatchObject({ jenis: 'paragraf' });
  });
});

describe('potongTeksKaya', () => {
  const blok = uraiTeksKaya('Bawa **KTP asli** ya.\n\n- satu\n- dua');

  it('panjang tanpa penanda Markdown', () => {
    expect(panjangTeksKaya(blok)).toBe('Bawa KTP asli ya.'.length + 'satu'.length + 'dua'.length);
  });

  it('struktur utuh, dipotong di akhir kata', () => {
    expect(potongTeksKaya(blok, 7)).toEqual([
      {
        jenis: 'paragraf',
        baris: [
          [
            { jenis: 'teks', teks: 'Bawa ' },
            { jenis: 'tebal', isi: [{ jenis: 'teks', teks: 'KTP' }] },
          ],
        ],
      },
    ]);
    expect(potongTeksKaya(blok, 0)).toEqual([]);
    expect(potongTeksKaya(blok, 10_000)).toEqual(blok);
  });

  it('daftar muncul per butir', () => {
    const p = potongTeksKaya(blok, 'Bawa KTP asli ya.'.length + 2);
    expect(p[1]).toEqual({
      jenis: 'daftar',
      urut: false,
      mulai: 1,
      butir: [{ isi: [{ jenis: 'teks', teks: 'satu' }], anak: null }],
    });
  });
});
