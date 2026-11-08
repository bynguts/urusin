import { beforeEach, describe, expect, it } from 'vitest';
import { fakeEmbedder } from '../eval/fake-embedder.js';
import { runIngest } from '../ingest/ingest.js';
import type { Deps, FetchLike } from '../ingest/fetcher.js';
import type { SourceEntry } from '../ingest/sources.js';
import {
  cariPengetahuanTool,
  countChunks,
  countVectors,
  embedAndFit,
  loadActiveTransform,
  openDb,
  searchBm25,
  upsertChunks,
  vectorIdsForQuery,
  type Db,
} from '../index.js';

const NOW = '2026-11-08T00:00:00.000Z';
const mk = (id: string, judul: string, text: string, extra: Record<string, unknown> = {}) => ({
  id,
  text,
  sourceRef: { url: `https://contoh.go.id/${id}`, judul, instansi: 'Dinas Contoh' },
  verifiedAt: NOW,
  ...extra,
});
const CORPUS = [
  mk(
    'ktp',
    'Penggantian KTP-el hilang',
    'Penggantian KTP-el yang hilang memerlukan surat kehilangan dari kepolisian.',
  ),
  mk(
    'akta',
    'Akta kelahiran',
    'Pencatatan akta kelahiran memerlukan surat keterangan lahir dan KK orang tua.',
  ),
  mk('kk', 'KK baru Wonogiri', 'Pengurusan KK baru membutuhkan akta nikah.', { kodeWilayah: '3312' }),
  mk('pindah', 'Surat pindah', 'Surat pindah SKPWNI diurus di kantor kelurahan dan dinas kependudukan.'),
  mk('pajak', 'Pajak kendaraan', 'Pembayaran pajak kendaraan bermotor lewat Samsat.', { kodeWilayah: '33' }),
  mk('bpjs', 'BPJS Kesehatan', 'Pendaftaran peserta BPJS Kesehatan mandiri melalui kantor cabang.'),
];

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  upsertChunks(db, CORPUS);
});

describe('embedAndFit + vectorIdsForQuery', () => {
  it.each(['none', 'center', 'whiten'] as const)(
    'mode %s: simpan parameter aktif + vektor, kueri memakai transform yang sama',
    async (mode) => {
      const embed = fakeEmbedder();
      const r = await embedAndFit(db, embed, { mode, k: 4, shrinkage: 'auto', model: 'fake' });
      expect(r).toMatchObject({ chunks: 6, embedded: 6, version: 1, mode });
      expect(countVectors(db)).toBe(6);
      expect(loadActiveTransform(db)?.params.mode).toBe(mode);

      // Kueri = teks dokumen persis (judul + isi) => harus rank 1.
      const doc = CORPUS[1]!;
      const ids = await vectorIdsForQuery(db, embed, `${doc.sourceRef.judul}\n${doc.text}`);
      expect(ids?.[0]).toBe('akta');
    },
  );

  it('fit ulang menaikkan versi, memakai cache mentah, dan filter wilayah berlaku', async () => {
    const embed = fakeEmbedder();
    await embedAndFit(db, embed, { mode: 'center', model: 'fake' });
    const r2 = await embedAndFit(db, embed, { mode: 'whiten', k: 3, model: 'fake' });
    expect(r2).toMatchObject({ version: 2, embedded: 0, mode: 'whiten' });
    const ids = await vectorIdsForQuery(db, embed, 'pengurusan KK baru', { kodeKabKota: '3578' });
    expect(ids).not.toContain('kk'); // wilayah 3312 tidak terlihat bagi 3578
    expect(ids).toContain('ktp'); // nasional tetap terlihat
  });

  it('chunk dihapus ikut menghapus vektornya', async () => {
    await embedAndFit(db, fakeEmbedder(), { mode: 'center' });
    db.prepare('DELETE FROM chunks WHERE id = ?').run('ktp');
    expect(countVectors(db)).toBe(5);
  });
});

describe('jalur BM25-saja tidak berubah tanpa embedding', () => {
  it('tool tetap mode bm25, hasil sama dengan searchBm25, dan tabel vektor kosong', async () => {
    // Pipeline kosong = BM25 polos (bawaan tool kini menambah stem + perluasan).
    const out = cariPengetahuanTool.execute(db, { query: 'ktp hilang' }, { pipeline: {} });
    expect(out.mode).toBe('bm25');
    expect(out.hasil.map((h) => h.id)).toEqual(searchBm25(db, { query: 'ktp hilang' }).map((h) => h.id));
    expect(out.hasil[0]?.id).toBe('ktp');
    expect(await vectorIdsForQuery(db, null, 'ktp hilang')).toBeUndefined();
    // Embedder ada tetapi belum ada vektor/transform aktif => tetap undefined (BM25).
    expect(await vectorIdsForQuery(db, fakeEmbedder(), 'ktp hilang')).toBeUndefined();
    expect(countVectors(db)).toBe(0);
    expect(loadActiveTransform(db)).toBeNull();
  });

  it('embedder yang gagal pada kueri jatuh ke BM25', async () => {
    await embedAndFit(db, fakeEmbedder(), { mode: 'center' });
    const boom = () => Promise.reject(new Error('jaringan'));
    expect(await vectorIdsForQuery(db, boom, 'ktp hilang')).toBeUndefined();
  });
});

describe('runIngest + embedding', () => {
  const html = '<html><body><h1>Akta Kelahiran</h1><p>Persyaratan: surat keterangan lahir.</p></body></html>';
  const source: SourceEntry = {
    id: 'uji',
    url: 'https://disdukcapil.contoh.go.id/layanan',
    judul: 'Layanan Contoh',
    instansi: 'Dinas Contoh',
    jenis: 'halaman',
    domain: 'dukcapil',
    kodeWilayah: '3312',
    layanan: 'adminduk',
    status: 'confirmed',
    robots: 'ditemukan',
    lastFetched: null,
    ingest: true,
    catatan: '',
  };
  const deps = (): Deps => {
    let t = 1_000_000;
    const fetchFn: FetchLike = async (url) => ({
      status: url.endsWith('/layanan') ? 200 : 404,
      headers: { get: (n) => (n.toLowerCase() === 'content-type' ? 'text/html' : null) },
      text: async () => (url.endsWith('/layanan') ? html : ''),
    });
    return {
      fetch: fetchFn,
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
    };
  };

  it('tanpa embed: korpus masuk, tabel vektor tidak disentuh', async () => {
    const fresh = openDb(':memory:');
    await runIngest({ sources: [source], dryRun: false, db: fresh, deps: deps() });
    expect(countChunks(fresh)).toBeGreaterThan(0);
    expect(countVectors(fresh)).toBe(0);
    expect(loadActiveTransform(fresh)).toBeNull();
  });

  it('dengan embed: fit setelah semua chunk, lalu vektor tersimpan', async () => {
    const fresh = openDb(':memory:');
    const reports = await runIngest({
      sources: [source],
      dryRun: false,
      db: fresh,
      deps: deps(),
      embed: fakeEmbedder(),
      vectorMode: 'center',
    });
    expect(reports.at(-1)).toMatchObject({ id: 'vektor', action: 'ingested' });
    expect(countVectors(fresh)).toBe(countChunks(fresh));
    expect(loadActiveTransform(fresh)?.params.mode).toBe('center');
  });

  it('embed gagal: dilewati, korpus BM25 utuh', async () => {
    const fresh = openDb(':memory:');
    const reports = await runIngest({
      sources: [source],
      dryRun: false,
      db: fresh,
      deps: deps(),
      embed: () => Promise.reject(new Error('quota')),
    });
    expect(reports.at(-1)).toMatchObject({ id: 'vektor', action: 'skipped' });
    expect(countChunks(fresh)).toBeGreaterThan(0);
    expect(countVectors(fresh)).toBe(0);
  });
});
