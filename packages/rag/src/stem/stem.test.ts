import { describe, expect, it } from 'vitest';
import { isStopword, rawTokens, stemText, stemToken, stemTokens } from './stem.js';

describe('stemToken: kosakata adminduk', () => {
  const cases: [string, string][] = [
    ['perekaman', 'rekam'],
    ['pencetakan', 'cetak'],
    ['kependudukan', 'duduk'],
    ['permohonan', 'mohon'],
    ['persyaratan', 'syarat'],
    ['persyaratannya', 'syarat'],
    ['pengurusan', 'urus'],
    ['diterbitkan', 'terbit'],
    ['penerbitan', 'terbit'],
    ['kehilangan', 'hilang'],
    ['pencatatan', 'catat'],
    ['perkawinan', 'kawin'],
    ['kelahiran', 'lahir'],
    ['kematian', 'mati'],
    ['perpindahan', 'pindah'],
    ['penggantian', 'ganti'],
    ['pembayaran', 'bayar'],
    ['pendaftaran', 'daftar'],
    ['pelaporan', 'lapor'],
    ['pengajuan', 'aju'],
    ['diajukan', 'aju'],
    ['pembuatan', 'buat'],
    ['membuat', 'buat'],
    ['kewarganegaraan', 'warganegara'],
    ['kecamatan', 'camat'],
  ];
  it.each(cases)('%s -> %s', (kata, akar) => {
    expect(stemToken(kata)).toBe(akar);
  });

  it('bentuk berbeda dari akar yang sama bertemu di satu stem', () => {
    const forms = ['pengurusan', 'mengurus', 'diurus', 'ngurus', 'ngurusin', 'urusan'];
    expect(new Set(forms.map(stemToken))).toEqual(new Set(['urus']));
  });

  it('gaya awam: pindahan, bikinin', () => {
    expect(stemToken('pindahan')).toBe('pindah');
    expect(stemToken('bikinin')).toBe('bikin');
  });
});

describe('stemToken: tidak boleh over-stemming', () => {
  it.each(['KTP-el', 'NIK', 'KK', 'SKPWNI', 'F1.06', 'F-1.06', 'eKTP'])('melindungi %s', (tok) => {
    expect(stemToken(tok)).toBe(tok.toLowerCase());
  });
  it.each(['ktp', 'bpjs', 'skck', 'stnk', 'samsat', 'bansos', 'dukcapil', 'akta', 'sim', 'kia', 'ikd'])(
    'akronim/istilah %s tidak berubah',
    (tok) => {
      expect(stemToken(tok)).toBe(tok);
    },
  );
  it('istilah di luar kamus tidak dipotong sembarangan', () => {
    expect(stemToken('kemendagri')).toBe('kemendagri');
    expect(stemToken('telunjuk')).toBe('telunjuk');
  });
  it('reduplikasi dilipat, bukan tanda hubung teknis', () => {
    expect(stemToken('anak-anak')).toBe('anak');
    expect(stemToken('ktp-el')).toBe('ktp-el');
  });
});

describe('stemTokens / stemText', () => {
  it('membuang stopword dan men-stem; token teknis utuh', () => {
    expect(stemTokens('Bagaimana persyaratan perekaman KTP-el di Surabaya?')).toEqual([
      'syarat',
      'rekam',
      'ktp-el',
      'surabaya',
    ]);
  });
  it('F1.06 satu token', () => {
    expect(rawTokens('Formulir F1.06 dan SKPWNI')).toEqual(['Formulir', 'F1.06', 'dan', 'SKPWNI']);
    expect(stemText('Formulir F1.06 dan SKPWNI')).toBe('formulir f1.06 skpwni');
  });
  it('kueri hanya stopword tidak menjadi kosong', () => {
    expect(stemTokens('yang di ke').length).toBeGreaterThan(0);
  });
  it('stopword gaya awam', () => {
    for (const w of ['gimana', 'dong', 'nggak', 'yang', 'tolong']) expect(isStopword(w)).toBe(true);
    for (const w of ['hilang', 'baru', 'pindah', 'ktp']) expect(isStopword(w)).toBe(false);
  });
  it('deterministik', () => {
    const q = 'ngurus akta anak';
    expect(stemText(q)).toBe(stemText(q));
    expect(stemText(q)).toBe('urus akta anak');
  });
});
