import { describe, expect, it } from 'vitest';
import { cariPengetahuanTool, openDb } from '../index.js';
import { dropBoilerplate } from './chunk.js';
import type { Deps, FetchLike } from './fetcher.js';
import { runIngest } from './ingest.js';
import { klampidEndpoint, klampidHash, sanitizeKlampid } from './klampid.js';
import type { SourceEntry } from './sources.js';

const svc = (over: Record<string, unknown>) => ({
  _id: 'id-' + Math.random().toString(36).slice(2),
  name: 'X',
  description: 'X',
  category: 'PENDAFTARAN PENDUDUK',
  visibilityStatus: 'Dipublikasikan',
  availabilityStatus: 'Tersedia',
  guides: [],
  ...over,
});

const RESPONSE = {
  data: {
    allPublicFrontServices: [
      svc({ name: 'Pindah Datang', description: 'Pindah dari luar kota ke Surabaya' }),
      svc({
        name: 'Pindah Datang',
        description: 'Pindah dari luar kota ke Surabaya',
        guides: [{ title: 'Panduan Pindah' }],
      }),
      svc({
        name: 'Akta Kelahiran',
        description: 'Akta Kelahiran',
        category: 'PENCATATAN SIPIL',
        guides: [{ title: 'Panduan Akta Kelahiran' }],
      }),
      svc({ name: 'Test', description: 'uji' }),
      svc({ name: 'Lontong Balap', description: 'enak' }),
      svc({ name: 'Beta Tester', description: 'uji' }),
      svc({ name: 'Layanan Draft', availabilityStatus: 'Tidak Tersedia' }),
      svc({ name: 'Layanan Tersembunyi', visibilityStatus: 'Draft' }),
      svc({ name: 'Kategori Asing', category: 'LAINNYA' }),
      svc({
        name: 'Buka Blokir',
        category: 'PEMUTAKHIRAN DATA PENDUDUK',
        description: '<b>Buka blokir</b> data',
      }),
    ],
  },
};

const src: SourceEntry = {
  id: 'klampid-katalog',
  url: 'https://wargaklampid-dispendukcapil.surabaya.go.id/',
  judul: 'Klampid New Generation - katalog layanan publik',
  instansi: 'Dinas Kependudukan dan Pencatatan Sipil Kota Surabaya',
  jenis: 'halaman',
  domain: 'dukcapil',
  kodeWilayah: '3578',
  layanan: 'adminduk',
  status: 'confirmed',
  robots: 'tidak-ada',
  lastFetched: null,
  ingest: true,
  adapter: 'klampid',
  catatan: '',
};

describe('adapter Klampid', () => {
  it('sanitasi: hanya Tersedia/Dipublikasikan, allowlist kategori, buang baris uji, dedupe', () => {
    const out = sanitizeKlampid(RESPONSE);
    expect(out.map((s) => s.name)).toEqual(['Buka Blokir', 'Akta Kelahiran', 'Pindah Datang']);
    expect(out.find((s) => s.name === 'Pindah Datang')?.guides).toEqual(['Panduan Pindah']);
    expect(out[0]?.description).toBe('Buka blokir data');
  });
  it('respons tak sesuai skema ditolak', () => {
    expect(() => sanitizeKlampid({ data: {} })).toThrow();
  });
  it('hash stabil dan peka terhadap perubahan isi', () => {
    const a = sanitizeKlampid(RESPONSE);
    expect(klampidHash(a)).toBe(klampidHash(sanitizeKlampid(RESPONSE)));
    expect(klampidHash(a)).not.toBe(klampidHash(a.slice(1)));
  });
  it('endpoint memakai GET ?query= pada origin sumber', () => {
    const u = new URL(klampidEndpoint(src.url));
    expect(u.origin + u.pathname).toBe('https://wargaklampid-dispendukcapil.surabaya.go.id/new-api');
    expect(u.searchParams.get('query')).toContain('allPublicFrontServices');
  });

  it('ingest: satu chunk per layanan, wilayah 3578, verifiedAt non-null, bisa dicari', async () => {
    const calls: string[] = [];
    let t = Date.parse('2026-11-08T00:00:00Z');
    const fetchFn: FetchLike = async (url) => {
      calls.push(url);
      const json = url.includes('/new-api');
      return {
        status: json ? 200 : 404,
        headers: { get: (n) => (n.toLowerCase() === 'content-type' ? 'application/json' : null) },
        text: async () => (json ? JSON.stringify(RESPONSE) : ''),
      };
    };
    const deps: Deps = { fetch: fetchFn, now: () => t, sleep: async (ms) => void (t += ms) };
    const db = openDb(':memory:');
    const r = await runIngest({ sources: [src], dryRun: false, db, deps });
    expect(r[0]).toMatchObject({ action: 'ingested', chunks: 3 });
    const rows = db.prepare('SELECT verified_at, kode_wilayah FROM chunks').all() as {
      verified_at: string;
      kode_wilayah: string;
    }[];
    expect(rows.every((x) => x.verified_at && x.kode_wilayah === '3578')).toBe(true);
    const out = cariPengetahuanTool.execute(db, {
      query: 'pindah dari luar kota ke surabaya',
      kodeKabKota: '3578',
    });
    expect(out.hasil[0]?.text).toContain('Pindah Datang');
  });
});

describe('dropBoilerplate', () => {
  it('membuang menu/tanggal/tautan pendek dan duplikat; menjaga isi layanan', () => {
    const kept = dropBoilerplate([
      { heading: '', text: 'Selengkapnya' },
      { heading: '', text: '728 View  04 November 2026' },
      { heading: '', text: 'Klik disini' },
      { heading: 'Syarat', text: 'Persyaratan: surat keterangan lahir dan KK orang tua.' },
      { heading: 'Syarat', text: 'Persyaratan: surat keterangan lahir dan KK orang tua.' },
    ]);
    expect(kept).toHaveLength(1);
  });
});
