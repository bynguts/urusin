import { describe, expect, it } from 'vitest';
import { isAllowedUrl } from './allowlist.js';
import { defaultGlossary, expandQuery, parseGlossary } from './glossary.js';

const g = defaultGlossary();

describe('glosarium adminduk', () => {
  it('berkas bawaan terbaca dan lolos skema', () => {
    expect(g).not.toBeNull();
    expect(g!.entries.length).toBeGreaterThanOrEqual(25);
  });
  it('setiap entri punya sourceRef di allowlist resmi dan id unik', () => {
    const ids = new Set<string>();
    for (const e of g!.entries) {
      expect(isAllowedUrl(e.sourceRef.url)).toBe(true);
      expect(ids.has(e.id)).toBe(false);
      ids.add(e.id);
    }
  });
  it('menolak entri tanpa sourceRef', () => {
    expect(() =>
      parseGlossary({
        version: 1,
        catatan: '',
        entries: [{ id: 'x', pemicu: ['a'], resmi: ['b'], verifiedAt: null }],
      }),
    ).toThrow();
  });
});

describe('expandQuery', () => {
  const terms = (q: string) => expandQuery(q, g).terms;
  const flat = (q: string) => terms(q).join(' | ');
  it('bikin ktp -> perekaman/pencetakan KTP-el', () => {
    expect(terms('bikin ktp')).toEqual(expect.arrayContaining(['perekaman', 'pencetakan', 'ktp-el']));
  });
  it('ktp hilang -> penggantian + surat kehilangan kepolisian', () => {
    const t = terms('bikin ktp hilang gimana');
    expect(t).toEqual(
      expect.arrayContaining(['penggantian', 'kehilangan', 'surat kehilangan', 'kepolisian']),
    );
  });
  it('akta lahir -> akta kelahiran', () => {
    expect(terms('ngurus akta anak')).toEqual(expect.arrayContaining(['kelahiran']));
    expect(terms('akta lahir')).toEqual(expect.arrayContaining(['kelahiran', 'pencatatan']));
  });
  it('pindah domisili / pindahan -> SKPWNI', () => {
    for (const q of ['pindah domisili ke surabaya', 'pindahan', 'mau pindahan rumah'])
      expect(terms(q)).toEqual(expect.arrayContaining(['skpwni', 'perpindahan']));
  });
  it('akronim: kk, kia, ikd, stnk, pajak motor, skck, sim, bpjs, bansos, dtks, dtsen, nib', () => {
    expect(terms('kk')).toContain('kartu keluarga');
    expect(terms('kia')).toContain('kartu identitas anak');
    expect(terms('ikd')).toContain('identitas kependudukan digital');
    expect(terms('stnk')).toEqual(expect.arrayContaining(['pkb', 'samsat']));
    expect(terms('pajak motor')).toEqual(expect.arrayContaining(['pkb', 'samsat']));
    expect(flat('skck')).toContain('catatan kepolisian');
    expect(flat('sim')).toContain('izin mengemudi');
    expect(flat('bpjs')).toContain('jaminan kesehatan');
    expect(flat('bansos')).toContain('bantuan sosial');
    expect(flat('dtks')).toContain('data terpadu');
    expect(flat('dtsen')).toContain('data tunggal');
    expect(terms('nib')).toEqual(expect.arrayContaining(['nomor induk berusaha', 'perizinan berusaha']));
  });
  it('pemicu dicocokkan sesudah stem + stopword: "ktp yang hilang", "ktp-nya hilang"', () => {
    expect(terms('ktp yang hilang')).toContain('penggantian');
    expect(terms('ktp saya ilang')).toContain('penggantian');
  });
  it('istilah yang sudah ada di kueri tidak diulang; kueri tak dikenal -> kosong', () => {
    expect(terms('ktp hilang penggantian')).not.toContain('penggantian');
    expect(expandQuery('resep rendang padang', g)).toEqual({ terms: [], matched: [] });
  });
  it('mengembalikan id entri (bukan teks kueri) dan deterministik', () => {
    const a = expandQuery('ktp hilang', g);
    expect(a.matched).toContain('ktp-hilang');
    expect(expandQuery('ktp hilang', g)).toEqual(a);
  });
  it('tanpa glosarium -> tanpa perluasan', () => {
    expect(expandQuery('ktp hilang', null)).toEqual({ terms: [], matched: [] });
  });
});
