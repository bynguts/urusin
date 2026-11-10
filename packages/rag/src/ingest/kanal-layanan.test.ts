import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runKanalLayanan } from './kanal-layanan-run.js';
import {
  decodeCfEmail,
  ekstrakJam,
  ekstrakKontak,
  entriDariHalaman,
  gabungEntri,
  tautanKontak,
  teksHalaman,
  type EntriKanal,
} from './kanal-layanan.js';
import type { ProbeGet } from './kontak.js';

/** Email Cloudflare: kunci 0x2a XOR tiap byte. */
const cf = (email: string) =>
  '2a' + [...email].map((c) => (c.charCodeAt(0) ^ 0x2a).toString(16).padStart(2, '0')).join('');

const FOOTER = `<footer>
<!-- <address>Whatsapp 085600000001<br>Telp. 024 0000001</address> --> <!-- pii-scan:allow -->
<div>Jl. Contoh No. 1</div>
<div>Whatsapp 0895639074212&nbsp;</div> <!-- pii-scan:allow -->
<p>Telepon / Faksimile (0273) 321468</p>
<p>Email <a href="/cdn-cgi/l/email-protection" data-cfemail="${cf('disdukcapil@contohkab.go.id')}">[email&#160;protected]</a></p> <!-- pii-scan:allow -->
<p>Email : dinkominfo@contohkab.go.id</p> <!-- pii-scan:allow -->
<a href="https://wa.me/+6282328729953?text=Tanya">Chat</a> <!-- pii-scan:allow -->
<a href="tel:+62123456789">tel palsu</a>
<p>Call Center 112</p>
<p>Telp. (021) 12345678</p>
<h4>Jam Pelayanan</h4><p>Senin - Kamis : 08.15 - 15.00 Jumat : 08.00 - 13.00 Sabtu : Libur Minggu : Libur</p>
<p>Berita: Senin (27/7/2026) kunjungan kerja.</p>
<script>var wa = "081200000000";</script> <!-- pii-scan:allow -->
</footer>`;

describe('ekstrakKontak', () => {
  it('membuka email Cloudflare dan membuang komentar HTML serta skrip', () => {
    expect(decodeCfEmail(cf('a@b.go.id'))).toBe('a@b.go.id'); // pii-scan:allow
    const t = teksHalaman(FOOTER);
    expect(t).toContain('disdukcapil@contohkab.go.id'); // pii-scan:allow
    expect(t).not.toContain('085600000001'); // pii-scan:allow
    expect(t).not.toContain('081200000000'); // pii-scan:allow
  });

  it('mengambil telepon, WhatsApp, email, dan jam yang berlabel; nomor tidak sah dibuang', () => {
    const k = ekstrakKontak(FOOTER);
    expect(k.whatsapp).toEqual(['0823-2872-9953', '0895-6390-74212']); // pii-scan:allow
    expect(k.telepon).toEqual(['(0273) 321468']);
    expect(k.email).toEqual(['disdukcapil@contohkab.go.id', 'dinkominfo@contohkab.go.id']); // pii-scan:allow
    expect(k.jamLayanan).toBe(
      'Senin - Kamis : 08.15 - 15.00 Jumat : 08.00 - 13.00 Sabtu : Libur Minggu : Libur',
    );
  });

  it('api.whatsapp.com/send/?phone= dan mailto .go.id tanpa label ikut terbaca', () => {
    const k = ekstrakKontak(
      '<a href="https://api.whatsapp.com/send/?phone=6281199895800&text=x">WA</a><a href="mailto:disdukcapil@depok.go.id">surat</a><a href="mailto:pribadi@gmail.com">x</a>', // pii-scan:allow
    );
    expect(k.whatsapp).toEqual(['0811-9989-5800']); // pii-scan:allow
    expect(k.email).toEqual(['disdukcapil@depok.go.id']); // pii-scan:allow
  });

  it('jam tanpa hari atau tanpa rentang jam tidak diambil; kurung penutup dipertahankan', () => {
    expect(ekstrakJam('Jam Pelayanan Sakura ISLA Pelaut Bala Duka')).toBeUndefined();
    expect(
      ekstrakJam('Jam Kerja = 07:30 WIB - 12:00 WIB 13:00 WIB - 16:00 WIB JUMAT 07:30 - 11:30'),
    ).toBeUndefined();
    expect(ekstrakJam('Jam Layanan Senin - Kamis (08.00 - 15.00 WIB) Jumat (08.00 - 13.00 WIB) Berita')).toBe(
      'Senin - Kamis (08.00 - 15.00 WIB) Jumat (08.00 - 13.00 WIB)',
    );
  });
});

describe('tautanKontak', () => {
  it('menu kontak di host yang sama; artikel yang memuat kata "hubungi" dilewati', () => {
    const html = `<a href="/kontak">Kontak</a><a href="https://lain.go.id/kontak">Kontak</a>
      <a href="/berita/detail/cara-lupa-pin-hubungi-contact-whatsapp-cs-bank">Salah satu trik cara mengatasi lupa PIN, cukup hubungi CS</a>
      <a href="/home/detail/hubungi-kami/131">Hubungi Kami</a>`;
    expect(tautanKontak(html, 'https://disdukcapil.contohkab.go.id/')).toEqual([
      'https://disdukcapil.contohkab.go.id/kontak',
      'https://disdukcapil.contohkab.go.id/home/detail/hubungi-kami/131',
    ]);
  });
});

describe('entri dan penggabungan', () => {
  const asal = { kode: '3312', layanan: 'adminduk' as const, instansi: 'Disdukcapil Contoh' };
  it('email pengelola situs (kominfo) bukan kontak layanan Disdukcapil', () => {
    const e = entriDariHalaman(asal, ekstrakKontak(FOOTER), 'https://x.go.id/', '2026-11-10');
    expect(e.filter((x) => x.jenis === 'email').map((x) => x.nilai)).toEqual(['disdukcapil@contohkab.go.id']); // pii-scan:allow
    expect(e.every((x) => x.sumberUrl === 'https://x.go.id/' && x.dicekPada === '2026-11-10')).toBe(true);
  });
  it('nilai sama dari dua halaman hanya sekali (halaman pertama menang), paling banyak tiga per jenis', () => {
    const e = (nilai: string, sumberUrl: string): EntriKanal => ({
      ...asal,
      jenis: 'whatsapp',
      nilai,
      sumberUrl,
      dicekPada: '2026-11-10',
    });
    const g = gabungEntri([
      e('0811-1111-1111', 'https://a.go.id/kontak'), // pii-scan:allow
      e('0811 1111 1111', 'https://a.go.id/'), // pii-scan:allow
      e('0811-2222-2222', 'https://a.go.id/'), // pii-scan:allow
      e('0811-3333-3333', 'https://a.go.id/'), // pii-scan:allow
      e('0811-4444-4444', 'https://a.go.id/'), // pii-scan:allow
    ]);
    expect(g.map((x) => x.nilai)).toEqual(['0811-1111-1111', '0811-2222-2222', '0811-3333-3333']); // pii-scan:allow
    expect(g[0]!.sumberUrl).toBe('https://a.go.id/kontak');
  });
});

describe('runKanalLayanan', () => {
  it('hanya halaman .go.id; portal pemda tanpa subdomain Disdukcapil dilewati; layanan online harus disebut halaman', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kanal-'));
    const p = (f: string) => join(dir, f);
    writeFileSync(
      p('kontak.json'),
      JSON.stringify({
        kontak: [
          {
            kode: '3312',
            nama: 'Kabupaten Wonogiri',
            status: 'terverifikasi',
            website: 'https://disdukcapil.wonogirikab.go.id',
            judulHalaman: 'x',
            sourceUrl: 'x',
            verifiedAt: 'x',
          },
          {
            kode: '3302',
            nama: 'Kabupaten Banyumas',
            status: 'terverifikasi',
            website: 'https://banyumaskab.go.id',
            judulHalaman: 'x',
            sourceUrl: 'x',
            verifiedAt: 'x',
          },
          { kode: '3101', nama: 'Kepulauan Seribu', status: 'belum_terverifikasi' },
        ],
      }),
    );
    writeFileSync(
      p('sumber.json'),
      JSON.stringify({
        sumber: [
          {
            kode: ['3404'],
            layanan: 'skck',
            instansi: 'Polresta Sleman',
            url: 'https://jogja.polri.go.id/sleman/',
            layananOnline: [
              { nama: 'SKCK Online Polri', url: 'https://skck.polri.go.id/' },
              { nama: 'Tidak disebut', url: 'https://lain.polri.go.id/' },
            ],
          },
          { kode: ['3275'], layanan: 'adminduk', instansi: 'Bukan go.id', url: 'https://www.e-open.id/' },
        ],
        entri: [
          {
            kode: '3275',
            layanan: 'adminduk',
            instansi: 'Disdukcapil Kota Bekasi',
            jenis: 'whatsapp',
            nilai: '0811-8355-599', // pii-scan:allow
            sumberUrl: 'https://disdukcapil.bekasikota.go.id/',
            dicekPada: '2026-11-10',
          },
          {
            kode: '3275',
            layanan: 'adminduk',
            instansi: 'Bukan go.id',
            jenis: 'whatsapp',
            nilai: '0811-0000-0009', // pii-scan:allow
            sumberUrl: 'https://www.e-open.id/',
            dicekPada: '2026-11-10',
          },
        ],
      }),
    );
    const halaman: Record<string, string> = {
      'https://disdukcapil.wonogirikab.go.id/':
        '<a href="/kontak">Kontak</a><a href="https://wa.me/6282328729953">WA</a>', // pii-scan:allow
      'https://disdukcapil.wonogirikab.go.id/kontak': '<p>Telepon (0273) 321468</p>',
      'https://banyumaskab.go.id/': '<a href="https://wa.me/6281126261160">WA</a>', // pii-scan:allow
      'https://jogja.polri.go.id/sleman/':
        '<a href="https://skck.polri.go.id/">SKCK</a> Telp : <a href="https://wa.me/6281338888110">x</a>', // pii-scan:allow
      'https://www.e-open.id/': '<a href="https://wa.me/6281200000000">WA</a>', // pii-scan:allow
    };
    const diminta: string[] = [];
    const get: ProbeGet = async (url) => {
      diminta.push(url);
      const body = halaman[url];
      return body === undefined
        ? { status: 404, body: '', contentType: 'text/html', finalUrl: url }
        : { status: 200, body, contentType: 'text/html; charset=utf-8', finalUrl: url };
    };
    // Hasil putaran sebelumnya: Kendal (situsnya gagal dibaca kali ini) tetap; nilai Wonogiri lama diganti.
    writeFileSync(
      p('out.json'),
      JSON.stringify({
        entri: [
          {
            kode: '3324',
            layanan: 'adminduk',
            instansi: 'Disdukcapil Kendal',
            jenis: 'email',
            nilai: 'dispendukcapil@kendalkab.go.id', // pii-scan:allow
            sumberUrl: 'https://dispendukcapil.kendalkab.go.id/',
            dicekPada: '2026-11-09',
          },
          {
            kode: '3312',
            layanan: 'adminduk',
            instansi: 'Disdukcapil Wonogiri',
            jenis: 'whatsapp',
            nilai: '0811-0000-0111', // pii-scan:allow
            sumberUrl: 'https://disdukcapil.wonogirikab.go.id/',
            dicekPada: '2026-11-09',
          },
        ],
      }),
    );
    const entri = await runKanalLayanan({
      kontakPath: p('kontak.json'),
      sumberPath: p('sumber.json'),
      outPath: p('out.json'),
      deps: { get, now: () => new Date('2026-11-10T03:00:00Z') },
      log: () => {},
    });
    expect(diminta).not.toContain('https://banyumaskab.go.id/');
    expect(diminta).not.toContain('https://www.e-open.id/');
    expect(entri.map((e) => [e.kode, e.layanan, e.jenis, e.nilai, e.sumberUrl])).toEqual([
      ['3275', 'adminduk', 'whatsapp', '0811-8355-599', 'https://disdukcapil.bekasikota.go.id/'], // pii-scan:allow
      ['3312', 'adminduk', 'telepon', '(0273) 321468', 'https://disdukcapil.wonogirikab.go.id/kontak'],
      ['3312', 'adminduk', 'whatsapp', '0823-2872-9953', 'https://disdukcapil.wonogirikab.go.id/'], // pii-scan:allow
      [
        '3324',
        'adminduk',
        'email',
        'dispendukcapil@kendalkab.go.id', // pii-scan:allow
        'https://dispendukcapil.kendalkab.go.id/',
      ],
      ['3404', 'skck', 'whatsapp', '0813-3888-8110', 'https://jogja.polri.go.id/sleman/'], // pii-scan:allow
      ['3404', 'skck', 'layanan_online', 'SKCK Online Polri', 'https://jogja.polri.go.id/sleman/'],
    ]);
    expect(entri.filter((e) => e.kode !== '3324').every((e) => e.dicekPada === '2026-11-10')).toBe(true);
    const file = JSON.parse(readFileSync(p('out.json'), 'utf8')) as { wilayah: number; total: number };
    expect(file).toMatchObject({ wilayah: 4, total: 6 });
  });
});
