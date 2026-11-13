import { FAKTA_HUKUM } from '@urusin/registry';
import { describe, expect, it } from 'vitest';
import { DEMO_CHUNKS } from './demo.js';
import { buildSystemPrompt } from './prompt.js';

describe('fakta hukum di sistem prompt dan korpus contoh', () => {
  const prompt = buildSystemPrompt();

  it('memuat setiap FAKTA_HUKUM beserta pasalnya, tanpa URL', () => {
    for (const f of FAKTA_HUKUM) expect(prompt).toContain(`${f.teks} (${f.pasal})`);
    expect(prompt).not.toMatch(/https?:\/\//);
  });

  it('format balasan: Markdown ringan untuk balasan panjang, tanpa tabel/HTML, balasan pendek tetap polos', () => {
    expect(prompt).toMatch(/balasan pendek cukup 1-2 kalimat biasa tanpa format/);
    expect(prompt).toMatch(/daftar bernomor \("1\. "\).*daftar butir \("- "\).*\*\*dua bintang\*\*/);
    expect(prompt).toMatch(/Jangan memakai tabel, HTML/);
  });

  it('pindah: SKPWNI di asal, KK dan KTP-el baru dari tujuan; SKDWNI bukan dokumen nasional', () => {
    expect(prompt).toMatch(/SKPWNI diurus di asal; Disdukcapil tujuan menerbitkan KK dan KTP-el baru/);
    expect(prompt).toMatch(/SKDWNI bukan dokumen nasional/);
  });

  it('korpus contoh: KTP hilang wajib surat polisi, KIA ikut usia, lapor lahir 60 hari tanpa pengadilan', () => {
    const teks = (id: string) => DEMO_CHUNKS.find((c) => c.id === id)!.text;
    expect(teks('demo-ktp-1')).toMatch(/hilang: surat keterangan kehilangan dari kepolisian/);
    expect(teks('demo-ktp-1')).toMatch(/rusak .*tanpa surat kepolisian/);
    expect(teks('demo-kia-1')).toMatch(/Permendagri 7\/2026/);
    expect(teks('demo-kia-1')).toMatch(/5 sampai 17 tahun menambah 1 pas foto berwarna 2x3/);
    expect(teks('demo-akta-lahir-1')).toMatch(/paling lambat 60 hari.*tanpa penetapan pengadilan/);
    expect(teks('demo-kematian-1')).toMatch(/paling lambat 30 hari/);
    expect(teks('demo-pindah-1')).not.toMatch(/keterangan datang/);
    for (const c of DEMO_CHUNKS)
      if (/Pasal|Permendagri/.test(c.text)) expect(new URL(c.sumber.url).hostname, c.id).toMatch(/\.go\.id$/);
  });
});
