import { readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PERISTIWA_BUNDEL } from './peristiwa.js';
import { FAKTA_HUKUM, REF_PERPRES_TEKS, REF_PMD7_2026, REF_UU24 } from './regulasi.js';
import { rencanaWilayah } from './rencana-wilayah.js';

const fakta = (id: string) => {
  const f = FAKTA_HUKUM.find((x) => x.id === id);
  if (!f) throw new Error(`fakta tidak ada: ${id}`);
  return f;
};

describe('FAKTA_HUKUM', () => {
  it('setiap fakta punya pasal dan sumber resmi (https, .go.id)', () => {
    expect(new Set(FAKTA_HUKUM.map((f) => f.id)).size).toBe(FAKTA_HUKUM.length);
    for (const f of FAKTA_HUKUM) {
      expect(f.pasal.length, f.id).toBeGreaterThan(0);
      expect(f.sourceRef.length, f.id).toBeGreaterThan(0);
      for (const r of f.sourceRef) {
        const u = new URL(r.url);
        expect(u.protocol, f.id).toBe('https:');
        expect(u.hostname.endsWith('.go.id'), `${f.id}: ${r.url}`).toBe(true);
      }
    }
  });

  it('KIA ikut Permendagri 7/2026: Permendagri 2/2016 sudah dicabut', () => {
    const f = fakta('kia-aturan-berlaku');
    expect(f.teks).toMatch(/Permendagri 7\/2026/);
    expect(f.teks).toMatch(/2\/2016 sudah dicabut/);
    expect(f.sourceRef).toContain(REF_PMD7_2026);
  });

  it('syarat KIA mengikuti usia anak', () => {
    const bersamaAkta = fakta('kia-balita-bersama-akta');
    expect(bersamaAkta.teks).toMatch(/di bawah 5 tahun/);
    expect(bersamaAkta.teks).toMatch(/cukup fotokopi KK/);
    expect(bersamaAkta.teks).not.toMatch(/pas foto|akta kelahiran dan/);
    expect(bersamaAkta.pasal).toMatch(/Ps\. 6 ayat \(1\)/);

    const sudahAkta = fakta('kia-balita-sudah-akta');
    expect(sudahAkta.teks).toMatch(/fotokopi kutipan akta kelahiran dan fotokopi KK/);
    expect(sudahAkta.teks).toMatch(/tanpa pas foto/);
    expect(sudahAkta.pasal).toMatch(/Ps\. 6 ayat \(2\)/);

    const besar = fakta('kia-5-17');
    expect(besar.teks).toMatch(/5 sampai 17 tahun/);
    expect(besar.teks).toMatch(/1 lembar pas foto berwarna 2x3 cm/);
    expect(besar.teks).toMatch(/KTP-el asli orang tua tidak lagi disyaratkan/);
    expect(besar.pasal).toMatch(/Ps\. 6 ayat \(3\)/);

    for (const f of [bersamaAkta, sudahAkta, besar]) expect(f.sourceRef).toContain(REF_PMD7_2026);
    expect(fakta('kia-daring').teks).toMatch(/IKD/);
  });

  it('KTP-el hilang wajib surat polisi; KTP-el rusak tidak', () => {
    const hilang = fakta('ktp-hilang');
    expect(hilang.teks).toMatch(/wajib surat keterangan hilang dari kepolisian/);
    expect(hilang.pasal).toMatch(/Ps\. 21 huruf a/);
    expect(hilang.sourceRef).toContain(REF_PERPRES_TEKS);
    expect(fakta('ktp-rusak').teks).toMatch(/tidak perlu surat kehilangan dari kepolisian/);
    expect(fakta('ktp-luar-domisili').teks).toMatch(/layanan resmi.*tidak ada perubahan data/);
  });

  it('pindah: SKPWNI dokumen nasional, SKDWNI bukan; 100 hari kerja; dibantu tujuan; satu kab/kota satu langkah', () => {
    expect(fakta('pindah-skp').teks).toMatch(/SKDWNI bukan dokumen nasional/);
    expect(fakta('pindah-tujuan').teks).toMatch(/KTP-el lama ditarik di daerah tujuan/);
    expect(fakta('pindah-masa-berlaku').teks).toMatch(/100 hari kerja/);
    expect(fakta('pindah-bantu-tujuan').pasal).toBe('Permendagri 108/2019 Ps. 31');
    expect(fakta('pindah-satu-kabkota').pasal).toBe('Permendagri 108/2019 Ps. 29');
  });

  it('batas waktu, biaya, KUA, dan dasar SPTJM', () => {
    expect(fakta('lahir-60-hari').teks).toMatch(/paling lambat 60 hari/);
    expect(fakta('lahir-terlambat').teks).toMatch(/tidak perlu penetapan pengadilan/);
    expect(fakta('mati-30-hari').teks).toMatch(/ketua RT.*paling lambat 30 hari/);
    expect(fakta('gratis').pasal).toBe('UU 24/2013 Ps. 79A');
    for (const id of ['lahir-60-hari', 'lahir-terlambat', 'mati-30-hari', 'gratis'])
      expect(fakta(id).sourceRef).toContain(REF_UU24);
    expect(fakta('kawin-kua').teks).toMatch(/Dukcapil tidak menerbitkan kutipan akta perkawinan/);
    expect(fakta('sptjm').pasal).toBe('Perpres 96/2018 Ps. 34');
    expect(fakta('sptjm').teks).toMatch(/9\/2016 sudah dicabut/);
  });
});

/** Kalimat yang menyebut "pengadilan" hanya boleh menyangkal (akta terlambat) atau soal jenazah tidak ditemukan. */
const pengadilanSah = (kalimat: string) =>
  /tanpa penetapan pengadilan|tidak perlu penetapan pengadilan|jenazah tidak ditemukan|pengadilan agama/i.test(
    kalimat,
  );
const kalimatPengadilan = (teks: string) =>
  teks.split(/(?<=[.;])\s+|\n/).filter((k) => /pengadilan/i.test(k) && !pengadilanSah(k));

describe('tidak ada fakta usang di isi pengetahuan', () => {
  const rencana = ['kelahiran', 'kematian', 'perkawinan', 'pindah'].flatMap((slug) =>
    [null, '3312', '3578', '3216'].map((ktp) => rencanaWilayah(slug, { ktp, tujuan: '3216' })),
  );
  const isiRegistry = JSON.stringify({ PERISTIWA_BUNDEL, FAKTA_HUKUM, rencana });

  it('akta kelahiran terlambat tidak pernah disebut wajib penetapan pengadilan', () => {
    expect(kalimatPengadilan(isiRegistry.replace(/","/g, '"\n"'))).toEqual([]);
  });

  // Teks pengetahuan di luar registry: korpus contoh, prompt, glosarium, dan dokumen.
  const root = new URL('../../../', import.meta.url);
  const berkas = [
    'packages/harness/src/demo.ts',
    'packages/harness/src/prompt.ts',
    'data/glossary/adminduk.json',
    'data/sources.json',
    ...readdirSync(new URL('docs/', root), { recursive: true })
      .map((f) => `docs/${String(f).replace(/\\/g, '/')}`)
      .filter((f) => f.endsWith('.md') && statSync(new URL(f, root)).isFile()),
  ];
  it.each(berkas)(
    '%s: tanpa klaim pengadilan untuk akta terlambat, tanpa SKDWNI/Permendagri 2/2016 sebagai aturan berlaku',
    (f) => {
      const teks = readFileSync(new URL(f, root), 'utf8');
      expect(kalimatPengadilan(teks)).toEqual([]);
      for (const k of teks.split(/(?<=[.;])\s+|\n/)) {
        if (/Permendagri (No\. )?2(\/| Tahun )2016|9\/2016/.test(k)) expect(k, f).toMatch(/dicabut|mencabut/);
        if (/SKDWNI/.test(k)) expect(k, f).toMatch(/bukan dokumen nasional|nama layanan|Wonogiri/);
      }
    },
  );
});
