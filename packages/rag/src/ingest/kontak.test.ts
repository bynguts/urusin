import { describe, expect, it } from 'vitest';
import type { Kanal } from '../kanal.js';
import { verifyKanal } from './kanal-verify.js';
import {
  candidateHosts,
  cleanAlamat,
  extractAlamat,
  kontakFile,
  pageTitle,
  probeKontak,
  shortName,
  verifyPage,
  type KabKota,
  type Kontak,
  type ProbeGet,
} from './kontak.js';

const bogor: KabKota = { kode: '3201', jenis: 'kabupaten', nama: 'Kabupaten Bogor' };
const HTML = `<html><head><title> Disdukcapil Bogor </title><script>x()</script></head><body>
<p>Dinas Kependudukan dan Pencatatan Sipil Kabupaten Bogor</p>
<p>Alamat : Jl. Tegar Beriman No. 1 Cibinong Telp 021-1234</p></body></html>`;

describe('nama dan kandidat host', () => {
  it('shortName membuang awalan dan tanda kurung', () => {
    expect(shortName('Kabupaten Aceh Selatan')).toBe('Aceh Selatan');
    expect(shortName('Kota Batu (Jatim)')).toBe('Batu');
  });
  it('candidateHosts membangun host .go.id unik untuk kab dan kota', () => {
    const kab = candidateHosts(bogor);
    expect(kab[0]).toBe('disdukcapil.bogorkab.go.id');
    expect(kab).toContain('capil.bogor.go.id');
    expect(new Set(kab).size).toBe(kab.length);
    expect(candidateHosts({ jenis: 'kota', nama: 'Kota Bandung' })[0]).toBe('disdukcapil.bandungkota.go.id');
  });
});

describe('verifyPage / pageTitle / extractAlamat', () => {
  it('lolos bila domain .go.id, memuat kependudukan dan nama wilayah', () => {
    expect(verifyPage('https://disdukcapil.bogorkab.go.id/', HTML, bogor)).toBe(true);
  });
  it('ditolak: domain bukan .go.id, URL rusak, tanpa kata kependudukan, atau tanpa nama wilayah', () => {
    expect(verifyPage('https://contoh.com/', HTML, bogor)).toBe(false);
    expect(verifyPage('bukan url', HTML, bogor)).toBe(false);
    expect(verifyPage('https://a.go.id/', '<p>Bogor toko</p>', bogor)).toBe(false);
    expect(verifyPage('https://a.go.id/', '<p>Dukcapil Depok</p>', bogor)).toBe(false);
    expect(verifyPage('https://a.go.id/', HTML, { nama: 'Kota X' })).toBe(false);
  });
  it('pageTitle mengambil judul tanpa skrip; kosong bila tidak ada', () => {
    expect(pageTitle(HTML)).toBe('Disdukcapil Bogor');
    expect(pageTitle('<p>tanpa judul</p>')).toBe('');
  });
  it('extractAlamat hanya bila pola jelas', () => {
    expect(extractAlamat(HTML)).toBe('Jl. Tegar Beriman No. 1 Cibinong');
    expect(extractAlamat('<p>Alamat : kantor di sana</p>')).toBeUndefined();
    expect(extractAlamat('<p>tanpa apa-apa</p>')).toBeUndefined();
  });
});

describe('cleanAlamat', () => {
  it('memotong telepon, hak cipta, ikon, dan label lain dari alamat', () => {
    expect(cleanAlamat(`Jl. Raya Soreang KM. 17 Whatsapp/Telp ${['0812', '0000', '0000'].join('')} -`)).toBe(
      'Jl. Raya Soreang KM. 17',
    );
    expect(cleanAlamat('Jl. Sultan Agung No. 23 Sidoarjo Call Center (031) - 8960188')).toBe(
      'Jl. Sultan Agung No. 23 Sidoarjo',
    );
    expect(cleanAlamat('Jl. Ir. H. Juanda No.1 Indramayu 45218 Lokasi')).toBe(
      'Jl. Ir. H. Juanda No.1 Indramayu 45218',
    );
    expect(cleanAlamat('Jl. Lintas Tebo Km. 12, Jambi 37571 \u{1F552}')).toBe(
      'Jl. Lintas Tebo Km. 12, Jambi 37571',
    );
    expect(cleanAlamat('Jalan Kyai Mawardi No. 1 Sukoharjo')).toBe('Jalan Kyai Mawardi No. 1 Sukoharjo');
    expect(cleanAlamat('Jl. Sucipto No.57 Situbondo 0338 671738')).toBe('Jl. Sucipto No.57 Situbondo');
  });
});

describe('probeKontak', () => {
  const ok =
    (finalUrl: string, body = HTML, status = 200, contentType = 'text/html'): ProbeGet =>
    async () => ({ status, body, contentType, finalUrl });
  const now = () => new Date('2026-11-08T00:00:00.000Z');
  const miss = { kode: '3201', nama: 'Kabupaten Bogor', status: 'belum_terverifikasi' };

  it('terverifikasi dari host pertama yang resolve dan lolos', async () => {
    const hosts: string[] = [];
    const r = await probeKontak(bogor, {
      resolves: async (h) => {
        hosts.push(h);
        return h === 'disdukcapil.bogor.go.id';
      },
      get: ok('https://disdukcapil.bogor.go.id/'),
      now,
    });
    expect(r).toMatchObject({
      status: 'terverifikasi',
      website: 'https://disdukcapil.bogor.go.id',
      judulHalaman: 'Disdukcapil Bogor',
      alamat: 'Jl. Tegar Beriman No. 1 Cibinong',
      verifiedAt: '2026-11-08T00:00:00.000Z',
    });
    expect(hosts.length).toBe(2);
  });
  it('tanpa alamat bila halaman tidak memuatnya', async () => {
    const body = '<title>Capil</title><p>Dinas Kependudukan Bogor</p>';
    const r = await probeKontak(bogor, {
      resolves: async () => true,
      get: ok('https://x.go.id/', body),
      now,
    });
    expect(r.status).toBe('terverifikasi');
    expect('alamat' in r).toBe(false);
  });
  it('belum_terverifikasi: DNS tidak ada, bukan 200, bukan HTML, halaman salah, atau fetch gagal', async () => {
    const yes = async () => true;
    expect(
      await probeKontak(bogor, { resolves: async () => false, get: ok('https://x.go.id/'), now }),
    ).toEqual(miss);
    expect(await probeKontak(bogor, { resolves: yes, get: ok('https://x.go.id/', HTML, 404), now })).toEqual(
      miss,
    );
    expect(
      await probeKontak(bogor, { resolves: yes, get: ok('https://x.go.id/', HTML, 200, 'text/plain'), now }),
    ).toEqual(miss);
    expect(await probeKontak(bogor, { resolves: yes, get: ok('https://x.com/'), now })).toEqual(miss);
    const boom: ProbeGet = async () => {
      throw new Error('timeout');
    };
    expect(await probeKontak(bogor, { resolves: yes, get: boom, now })).toEqual(miss);
  });
});

describe('kontakFile', () => {
  it('mengikuti urutan wilayah dan menghitung yang terverifikasi', () => {
    const v: Kontak = {
      kode: '3201',
      nama: 'Kabupaten Bogor',
      status: 'terverifikasi',
      website: 'https://a.go.id',
      judulHalaman: 't',
      sourceUrl: 'https://a.go.id/',
      verifiedAt: '2026-11-08T00:00:00.000Z',
    };
    const f = kontakFile([bogor, { kode: '3202', jenis: 'kota', nama: 'Kota Y' }], new Map([['3201', v]]));
    expect(f.total).toBe(2);
    expect(f.terverifikasi).toBe(1);
    expect(f.kontak[1]).toEqual({ kode: '3202', nama: 'Kota Y', status: 'belum_terverifikasi' });
  });
});

describe('verifyKanal', () => {
  const k: Kanal = {
    id: 'sim',
    layanan: 'SIM',
    instansi: 'Korlantas',
    url: 'https://korlantas.polri.go.id/',
    deskripsi: 'd',
    cek: 'sim|korlantas',
    verifiedAt: null,
  };
  const get =
    (over: Partial<Awaited<ReturnType<ProbeGet>>>): ProbeGet =>
    async () => ({
      status: 200,
      body: '<p>Layanan SIM</p>',
      contentType: 'text/html',
      finalUrl: k.url,
      ...over,
    });

  it('lolos bila 200, HTML, domain resmi dan kata kunci ada', async () => {
    expect(await verifyKanal(k, get({}))).toEqual({ ok: true, why: '' });
  });
  it('gagal dengan alasan yang jelas', async () => {
    expect((await verifyKanal(k, get({ status: 503 }))).why).toBe('HTTP 503');
    expect((await verifyKanal(k, get({ contentType: 'application/pdf' }))).why).toBe('bukan HTML');
    expect((await verifyKanal(k, get({ finalUrl: 'https://evil.example.com/' }))).why).toMatch(
      /domain tidak resmi/,
    );
    expect((await verifyKanal(k, get({ body: '<p>lain</p>' }))).why).toBe('kata kunci tidak ditemukan');
    const boom = await verifyKanal(k, async () => {
      throw new TypeError('x');
    });
    expect(boom).toEqual({ ok: false, why: 'TypeError' });
  });
  it('verifikasiVia mencocokkan isi mentah (termasuk tautan di atribut)', async () => {
    const via = { ...k, cek: 'skck\\.polri\\.go\\.id', verifikasiVia: 'https://www.polri.go.id/' };
    const body = '<a href="https://skck.polri.go.id/">x</a>';
    expect((await verifyKanal(via, get({ body }))).ok).toBe(true);
    const { verifikasiVia: _drop, ...noVia } = via;
    expect((await verifyKanal(noVia, get({ body }))).ok).toBe(false);
  });
});
