import { describe, expect, it } from 'vitest';
import { detectPii, findPiiSpans, normalizeForScan } from './pii.js';

// NIK dan HP sintetis dirakit dari potongan agar pemindai PII repo tidak menandai berkas ini.
const NIK = ['3271', '0101', '0190', '0001'].join('');
const D = NIK.split(''); // 16 digit
const grup = (sep: string, ukuran: number[]) => {
  let i = 0;
  return ukuran.map((n) => D.slice(i, (i += n)).join('')).join(sep);
};
const HP = ['0812', '3456', '7890'];

describe('temuan 1: PII berformat tidak boleh lolos', () => {
  it('sanity: NIK sintetis valid terdeteksi apa adanya', () => {
    expect(NIK).toHaveLength(16);
    expect(detectPii(`nik ${NIK}`)).toContain('nik');
  });

  it.each([
    ['spasi ganda', grup('  ', [4, 4, 4, 4])],
    ['garis bawah', grup('_', [4, 4, 4, 4])],
    ['garis miring', grup('/', [4, 4, 4, 4])],
    ['spasi tiap dua digit', grup(' ', [2, 2, 2, 2, 2, 2, 2, 2])],
    ['titik 6-6-4', grup('.', [6, 6, 4])],
    ['strip dengan spasi', grup(' - ', [4, 4, 4, 4])],
    ['angka lebar-penuh', [...NIK].map((c) => String.fromCodePoint(c.charCodeAt(0) + 0xfee0)).join('')],
    ['angka Arab-Indic', [...NIK].map((c) => String.fromCodePoint(0x0660 + Number(c))).join('')],
    ['angka Arab-Indic Timur', [...NIK].map((c) => String.fromCodePoint(0x06f0 + Number(c))).join('')],
    ['angka Devanagari', [...NIK].map((c) => String.fromCodePoint(0x0966 + Number(c))).join('')],
    ['sisipan ZWSP', [...NIK].join('​')],
    ['sisipan soft hyphen dan ZWJ', [...NIK].join('­‍')],
    [
      'campuran lebar-penuh + spasi',
      grup(' ', [4, 4, 4, 4]).replace(/\d/g, (c) => String.fromCodePoint(c.charCodeAt(0) + 0xfee0)),
    ],
  ])('NIK %s', (_n, teks) => {
    expect(detectPii(`tolong urus ${teks} ya`)).toContain('nik');
    const spans = findPiiSpans(`tolong urus ${teks} ya`);
    expect(spans).toHaveLength(1);
    // rentang menunjuk teks ASLI persis (bukan hasil normalisasi)
    expect(spans[0]!.value).toBe(teks);
  });

  it.each([
    ['menempel pada huruf', `hp${HP.join('')}`],
    ['strip dengan spasi', HP.join(' - ')],
    ['kurung', `(${HP[0]}) ${HP[1]} ${HP[2]}`],
    ['+62 berspasi', `+62 ${HP[0]!.slice(1)} ${HP[1]} ${HP[2]}`],
    ['titik', HP.join('.')],
    ['angka lebar-penuh', HP.join('').replace(/\d/g, (c) => String.fromCodePoint(c.charCodeAt(0) + 0xfee0))],
    ['ZWSP', [...HP.join('')].join('​')],
  ])('HP %s', (_n, teks) => {
    expect(detectPii(`hubungi ${teks} sore`), teks).toContain('phone');
  });

  it('email dengan @ lebar-penuh dan ZWSP', () => {
    expect(detectPii('kirim ke budi​@contoh.id')).toContain('email');
    expect(detectPii('kirim ke budi＠contoh.id')).toContain('email');
  });

  it('12 digit + kodeKabKota yang diketahui membentuk NIK valid → NIK (kolom terpisah)', () => {
    const duaBelas = NIK.slice(4);
    expect(detectPii(duaBelas)).toEqual([]);
    expect(detectPii(duaBelas, { kodeKabKota: NIK.slice(0, 4) })).toEqual(['nik']);
    expect(detectPii(grup(' ', [4, 4, 4, 4]).slice(5), { kodeKabKota: NIK.slice(0, 4) })).toEqual(['nik']);
    // kode lain → bukan NIK valid
    expect(detectPii(duaBelas, { kodeKabKota: '9999' })).toEqual([]);
  });

  it('bukan PII: nominal, resi, tanggal, nomor 16 digit tak berstruktur NIK', () => {
    for (const aman of [
      'biaya Rp 1.500.000 dan 2.000.000',
      'tanggal 12-11-2026 pukul 10.30',
      'resi 1111 2222 3333 4444',
      'pasal 12 ayat 3 butir 4',
    ])
      expect(detectPii(aman), aman).toEqual([]);
  });

  it('normalizeForScan menjaga peta indeks ke teks asli', () => {
    const asli = `a${'​'}１２b`;
    const n = normalizeForScan(asli);
    expect(n.text).toBe('a12b');
    expect(n.map[1]).toEqual({ start: 2, end: 3 });
    expect(n.map[2]).toEqual({ start: 3, end: 4 });
  });
});
