import { describe, expect, it } from 'vitest';
import type { ProbeGet } from './kontak.js';
import { candidatePemdaHosts, namaPendekProvinsi, pemdaFile, probePemda, verifyPemda } from './pemda.js';

const kotaJpr = { kode: '9171', jenis: 'kota' as const, nama: 'Kota Jayapura' };
const kabJpr = { kode: '9103', jenis: 'kabupaten' as const, nama: 'Kabupaten Jayapura' };
const papua = { kode: '91', jenis: 'provinsi' as const, nama: 'Papua' };
const PORTAL = '<title>Pemerintah Kota Jayapura</title><p>Website resmi Pemerintah Kota Jayapura</p>';
const now = () => new Date('2026-11-11T00:00:00Z');
const ok =
  (finalUrl: string, body: string, status = 200, contentType = 'text/html'): ProbeGet =>
  async () => ({ status, body, contentType, finalUrl });

describe('kandidat host pemda', () => {
  it('kab/kota: portal <nama>kab/kota.go.id dulu, tanpa duplikat', () => {
    const h = candidatePemdaHosts(kotaJpr);
    expect(h[0]).toBe('jayapurakota.go.id');
    expect(h).toContain('jayapura.go.id');
    expect(new Set(h).size).toBe(h.length);
    expect(candidatePemdaHosts(kabJpr)[0]).toBe('jayapurakab.go.id');
  });
  it('provinsi: situs Dinas Dukcapil dulu, lalu portal; alias domain dipakai', () => {
    const h = candidatePemdaHosts(papua);
    expect(h.slice(0, 2)).toEqual(['disdukcapil.papuaprov.go.id', 'dukcapil.papuaprov.go.id']);
    expect(h).toContain('papua.go.id');
    expect(candidatePemdaHosts({ jenis: 'provinsi', nama: 'Daerah Istimewa Yogyakarta' })).toContain(
      'jogjaprov.go.id',
    );
    expect(namaPendekProvinsi('Daerah Khusus Ibukota Jakarta')).toBe('Jakarta');
    expect(candidatePemdaHosts({ jenis: 'provinsi', nama: 'Sumatera Utara' })).toContain('sumutprov.go.id');
  });
});

describe('verifyPemda', () => {
  it('portal kota lolos hanya bila menyebut "Kota <nama>" utuh di domain .go.id', () => {
    expect(verifyPemda('https://jayapurakota.go.id/', PORTAL, kotaJpr)).toBe('pemda');
    // Kota dan Kabupaten Jayapura tidak boleh tertukar.
    expect(verifyPemda('https://jayapurakota.go.id/', PORTAL, kabJpr)).toBeNull();
    expect(verifyPemda('https://contoh.com/', PORTAL, kotaJpr)).toBeNull();
    expect(verifyPemda('bukan url', PORTAL, kotaJpr)).toBeNull();
    expect(verifyPemda('https://a.go.id/', '<p>Kota Jayapura indah</p>', kotaJpr)).toBeNull();
  });
  it('provinsi: situs Dinas Dukcapil dikenali dari host/judul; portal provinsi sebagai pemda', () => {
    const dinas = '<title>Dinas Kependudukan dan Pencatatan Sipil</title><p>Pemerintah Provinsi Papua</p>';
    expect(verifyPemda('https://disdukcapil.papuaprov.go.id/', dinas, papua)).toBe('dukcapil');
    expect(verifyPemda('https://papua.go.id/', '<p>Portal resmi Pemerintah Provinsi Papua</p>', papua)).toBe(
      'pemda',
    );
    expect(
      verifyPemda('https://jakarta.go.id/', '<p>Pemerintah Provinsi DKI Jakarta</p>', {
        jenis: 'provinsi',
        nama: 'Daerah Khusus Ibukota Jakarta',
      }),
    ).toBe('pemda');
    // Situs yang hanya menyebut "Pemerintah Aceh" (tanpa kata provinsi) tetap dikenali.
    expect(
      verifyPemda('https://acehprov.go.id/', '<p>Situs resmi Pemerintah Aceh</p>', {
        jenis: 'provinsi',
        nama: 'Aceh',
      }),
    ).toBe('pemda');
  });
});

describe('probePemda dan berkas', () => {
  it('host pertama yang resolve dan lolos verifikasi dicatat beserta sumber dan tanggal', async () => {
    const r = await probePemda(kotaJpr, {
      resolves: async (h) => h === 'jayapurakota.go.id',
      get: ok('https://jayapurakota.go.id/beranda', PORTAL),
      now,
    });
    expect(r).toEqual({
      kode: '9171',
      nama: 'Kota Jayapura',
      status: 'terverifikasi',
      jenis: 'pemda',
      website: 'https://jayapurakota.go.id',
      judulHalaman: 'Pemerintah Kota Jayapura',
      sourceUrl: 'https://jayapurakota.go.id/beranda',
      verifiedAt: '2026-11-11T00:00:00.000Z',
    });
  });
  it('tidak resolve, bukan 200/HTML, galat jaringan: belum_terverifikasi', async () => {
    const miss = { kode: '9171', nama: 'Kota Jayapura', status: 'belum_terverifikasi' };
    const yes = async () => true;
    expect(
      await probePemda(kotaJpr, { resolves: async () => false, get: ok('https://x.go.id/', PORTAL), now }),
    ).toEqual(miss);
    expect(
      await probePemda(kotaJpr, { resolves: yes, get: ok('https://x.go.id/', PORTAL, 503), now }),
    ).toEqual(miss);
    expect(
      await probePemda(kotaJpr, {
        resolves: yes,
        get: ok('https://x.go.id/', PORTAL, 200, 'application/pdf'),
        now,
      }),
    ).toEqual(miss);
    const boom: ProbeGet = () => Promise.reject(new Error('ECONNRESET'));
    expect(await probePemda(kotaJpr, { resolves: yes, get: boom, now })).toEqual(miss);
  });
  it('pemdaFile menghitung yang terverifikasi dan mengisi yang belum diperiksa', () => {
    const f = pemdaFile([papua, kotaJpr], new Map());
    expect(f.total).toBe(2);
    expect(f.terverifikasi).toBe(0);
    expect(f.pemda[1]).toEqual({ kode: '9171', nama: 'Kota Jayapura', status: 'belum_terverifikasi' });
  });
});
