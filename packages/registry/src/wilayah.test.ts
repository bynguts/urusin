import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  NAMA_WILAYAH,
  SEMUA_WILAYAH,
  cariWilayah,
  kontakDukcapil,
  menyebutWilayah,
  temukanWilayah,
  namaPendekWilayah,
  penandaWilayah,
  routeByKode,
  wilayahByKode,
} from './index.js';
import { DATA_KONTAK_DUKCAPIL } from './wilayah-data.js';

const baca = (f: string) =>
  JSON.parse(readFileSync(new URL(`../../../data/wilayah/${f}`, import.meta.url), 'utf8')) as {
    kabkota: { kode: string; nama: string }[];
    kontak: { kode: string; status: string; website?: string; sourceUrl?: string; verifiedAt?: string }[];
  };

describe('data wilayah tertanam', () => {
  it('sama persis dengan data/wilayah/kabkota.json (514 kab/kota); jalankan gen:wilayah bila beda', () => {
    const j = baca('kabkota.json');
    expect(SEMUA_WILAYAH).toHaveLength(514);
    expect(SEMUA_WILAYAH.map((w) => [w.kodeKabKota, w.nama])).toEqual(j.kabkota.map((k) => [k.kode, k.nama]));
    expect(SEMUA_WILAYAH.every((w) => w.provinsi.length > 0)).toBe(true);
  });
  it('kontak = semua entri terverifikasi di kontak-dukcapil.json', () => {
    const j = baca('kontak-dukcapil.json');
    const ok = j.kontak.filter((k) => k.status === 'terverifikasi');
    expect(DATA_KONTAK_DUKCAPIL.map((k) => [k.kode, k.website])).toEqual(ok.map((k) => [k.kode, k.website]));
    expect(kontakDukcapil('1101')).toBeUndefined(); // Aceh Selatan belum terverifikasi
    expect(kontakDukcapil('3312')?.website).toMatch(/wonogirikab\.go\.id/);
  });
  it('router default memakai nama resmi untuk kode di luar seed (bukan "Kab/Kota XXXX")', () => {
    expect(routeByKode('1101').entry.nama).toBe('Kabupaten Aceh Selatan');
    for (const w of SEMUA_WILAYAH) expect(routeByKode(w.kodeKabKota).entry.nama).toBe(w.nama);
    expect(NAMA_WILAYAH.size).toBe(514);
  });
  it('kode tanpa entri registry tetapi berkontak terverifikasi: sumber resmi = situs Disdukcapil-nya', () => {
    const r = routeByKode('1104');
    expect(r.terdaftar).toBe(false);
    expect(r.entry.sourceRef[0]?.url).toMatch(/acehtengahkab\.go\.id/);
    expect(routeByKode('1101').entry.sourceRef).toEqual([]);
  });
});

describe('cariWilayah', () => {
  it.each([
    ['Kota Surabaya', '3578'],
    ['surabaya', '3578'],
    ['Wonogiri', '3312'],
    ['Kab. Wonogiri', '3312'],
    ['kab bekasi', '3216'],
    ['Kabupaten Bekasi', '3216'],
    ['Kota Bekasi', '3275'],
    ['3312', '3312'],
    ['33.12', '3312'],
    ['Kota Adm. Jakarta Pusat', '3171'],
    ['Jakarta Pusat', '3171'],
    ['Kepulauan Seribu', '3101'],
  ])('%s → %s', (q, kode) => {
    const r = cariWilayah(q);
    expect(r.status).toBe('cocok');
    if (r.status === 'cocok') expect(r.wilayah.kodeKabKota).toBe(kode);
  });
  it('Bekasi tanpa kab/kota: ambigu antara Kota dan Kabupaten Bekasi', () => {
    const r = cariWilayah('Bekasi');
    expect(r.status).toBe('ambigu');
    if (r.status === 'ambigu') expect(r.pilihan.map((w) => w.kodeKabKota).sort()).toEqual(['3216', '3275']);
  });
  it('Jakarta: ambigu (lima kota administrasi)', () => {
    const r = cariWilayah('Jakarta');
    expect(r.status).toBe('ambigu');
    if (r.status === 'ambigu') expect(r.pilihan.length).toBeGreaterThanOrEqual(5);
  });
  it('jenis yang salah ("Kab. Surabaya") tidak ditebak: ditawarkan sebagai pilihan', () => {
    const r = cariWilayah('Kab. Surabaya');
    expect(r).toMatchObject({ status: 'ambigu', pilihan: [{ kodeKabKota: '3578' }] });
  });
  it.each(['Cikarang', 'Atlantis', 'xx', '9999', ''])(
    '%j tidak dikenal (kecamatan/kota kecil dipetakan model)',
    (q) => expect(cariWilayah(q).status).toBe('tidak_dikenal'),
  );
});

describe('nama dan penanda', () => {
  it('nama pendek', () => {
    expect(namaPendekWilayah('Kabupaten Wonogiri')).toBe('Kab. Wonogiri');
    expect(namaPendekWilayah('Kota Surabaya')).toBe('Kota Surabaya');
    expect(namaPendekWilayah('Kota Administrasi Jakarta Pusat')).toBe('Jakarta Pusat');
  });
  it('penandaWilayah: nama inti tanpa awalan, dan kodenya', () => {
    expect(penandaWilayah(wilayahByKode('3216')!)).toEqual(['bekasi', '3216']);
  });
  it('menyebutWilayah: nama inti atau kode, utuh per kata', () => {
    const bks = wilayahByKode('3216')!;
    expect(menyebutWilayah('KTP saya Kab. Bekasi', bks)).toBe(true);
    expect(menyebutWilayah('ya, bekasi', bks)).toBe(true);
    expect(menyebutWilayah('saya di Cikarang', bks)).toBe(false);
    expect(menyebutWilayah('bekasiraya', bks)).toBe(false);
  });

  it('nama terpanjang menang: Luwu Utara bukan Luwu, Bone Bolango bukan Bone, Padang Pariaman bukan Kota Padang', () => {
    const kode = (t: string) => temukanWilayah(t).map((x) => x.wilayah.kodeKabKota);
    const luwu = SEMUA_WILAYAH.find((w) => w.nama === 'Kabupaten Luwu')!;
    const luwuUtara = SEMUA_WILAYAH.find((w) => w.nama === 'Kabupaten Luwu Utara')!;
    expect(kode('KTP saya Luwu Utara')).toEqual([luwuUtara.kodeKabKota]);
    expect(menyebutWilayah('KTP saya Luwu Utara', luwu)).toBe(false);
    expect(menyebutWilayah('KTP saya Luwu', luwu)).toBe(true);
    const bone = SEMUA_WILAYAH.find((w) => w.nama === 'Kabupaten Bone')!;
    expect(menyebutWilayah('saya di Bone Bolango', bone)).toBe(false);
    const padang = SEMUA_WILAYAH.find((w) => w.nama === 'Kota Padang')!;
    expect(menyebutWilayah('Kabupaten Padang Pariaman', padang)).toBe(false);
    expect(menyebutWilayah('Kota Padang', padang)).toBe(true);
  });

  it('jenis yang disebut menyaring nama ganda; "ke" ditandai untuk tujuan', () => {
    expect(temukanWilayah('KTP Kota Bekasi').map((x) => x.wilayah.kodeKabKota)).toEqual(['3275']);
    expect(
      temukanWilayah('KTP Bekasi')
        .map((x) => x.wilayah.kodeKabKota)
        .sort(),
    ).toEqual(['3216', '3275']);
    const [asal, tujuan] = temukanWilayah('dari Wonogiri pindah ke Kota Surabaya');
    expect(asal).toMatchObject({ teks: 'wonogiri', sebelum: 'dari', jenisDisebut: null });
    expect(tujuan).toMatchObject({ teks: 'surabaya', sebelum: 'ke', jenisDisebut: 'kota' });
  });

  it('kode hanya berdiri sendiri atau setelah "kode": "tahun 1971" bukan kode wilayah', () => {
    const w1971 = wilayahByKode('1971');
    expect(w1971).toBeDefined();
    expect(menyebutWilayah('anak saya lahir tahun 1971', w1971!)).toBe(false);
    expect(menyebutWilayah('1971', w1971!)).toBe(true);
    expect(menyebutWilayah('kode 1971', w1971!)).toBe(true);
    expect(menyebutWilayah('33.12', wilayahByKode('3312')!)).toBe(true);
  });
});
