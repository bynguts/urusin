import { beforeEach, describe, expect, it } from 'vitest';
import {
  ChunkRejectedError,
  buildMatch,
  cariPengetahuanTool,
  countChunks,
  isAllowedUrl,
  openDb,
  reciprocalRankFusion,
  searchBm25,
  searchHybrid,
  tryLoadSqliteVec,
  upsertChunks,
  type Db,
} from './index.js';

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
    'nas-ktp',
    'Penggantian KTP-el hilang',
    'Penggantian KTP-el yang hilang memerlukan surat kehilangan dari kepolisian.',
  ),
  mk(
    'nas-akta',
    'Akta kelahiran',
    'Pencatatan akta kelahiran memerlukan surat keterangan lahir dan KK orang tua.',
  ),
  mk('wng-kk', 'KK baru Wonogiri', 'Pengurusan KK baru di Telunjuk Sakti Wonogiri membutuhkan akta nikah.', {
    kodeWilayah: '3312',
    layanan: 'kk',
  }),
  mk('sby-kk', 'KK baru Surabaya', 'Pengurusan KK baru di Klampid Surabaya membutuhkan akta nikah.', {
    kodeWilayah: '3578',
    layanan: 'kk',
  }),
  mk('jt-pajak', 'Samsat Jawa Tengah', 'Pembayaran pajak kendaraan di Jawa Tengah lewat Samsat.', {
    kodeWilayah: '33',
  }),
];

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  upsertChunks(db, CORPUS);
});

describe('store', () => {
  it('menyimpan chunk', () => {
    expect(countChunks(db)).toBe(5);
  });
  it('upsert idempoten dan indeks FTS ikut diperbarui', () => {
    upsertChunks(db, [mk('nas-ktp', 'Judul baru', 'Teks pengganti tentang paspor.')]);
    expect(countChunks(db)).toBe(5);
    expect(searchBm25(db, { query: 'paspor' }).map((h) => h.id)).toEqual(['nas-ktp']);
    expect(searchBm25(db, { query: 'kepolisian' })).toEqual([]);
  });
  it('menolak chunk tanpa sourceRef', () => {
    const { sourceRef: _s, ...bad } = CORPUS[0]!;
    expect(() => upsertChunks(db, [bad])).toThrow(ChunkRejectedError);
  });
  it('menolak chunk tanpa verifiedAt atau dengan verifiedAt null', () => {
    const { verifiedAt: _v, ...bad } = CORPUS[0]!;
    expect(() => upsertChunks(db, [bad])).toThrow(ChunkRejectedError);
    expect(() => upsertChunks(db, [mk('x', 'X', 'teks x', { verifiedAt: null })])).toThrow(
      ChunkRejectedError,
    );
  });
  it('menolak origin di luar allowlist dan atomik', () => {
    const bad = {
      ...mk('evil', 'E', 'teks'),
      sourceRef: { url: 'https://contoh.com/a', judul: 'E', instansi: 'X' },
    };
    expect(() => upsertChunks(db, [mk('ok2', 'O', 'teks ok'), bad])).toThrow(ChunkRejectedError);
    expect(countChunks(db)).toBe(5);
  });
  it('allowlist: https + .go.id saja', () => {
    expect(isAllowedUrl('https://a.b.go.id/x')).toBe(true);
    expect(isAllowedUrl('http://a.go.id/')).toBe(false);
    expect(isAllowedUrl('https://go.id.evil.com/')).toBe(false);
    expect(isAllowedUrl('https://evilgo.id/')).toBe(false);
    expect(isAllowedUrl(['https://', 'user', String.fromCharCode(64), 'a.go.id/'].join(''))).toBe(false);
    expect(isAllowedUrl('bukan url')).toBe(false);
  });
});

describe('searchBm25', () => {
  it('menemukan chunk relevan dengan kutipan', () => {
    const [top] = searchBm25(db, { query: 'akta kelahiran anak' });
    expect(top?.id).toBe('nas-akta');
    expect(top?.kutipan).toEqual({
      url: 'https://contoh.go.id/nas-akta',
      judul: 'Akta kelahiran',
      instansi: 'Dinas Contoh',
    });
    expect(top?.verifiedAt).toBe(NOW);
  });
  it('sinonim awam: KTP hilang menemukan penggantian KTP-el', () => {
    expect(searchBm25(db, { query: 'KTP hilang' })[0]?.id).toBe('nas-ktp');
  });
  it('tanpa kode wilayah hanya korpus nasional', () => {
    const ids = searchBm25(db, { query: 'KK baru akta nikah' }).map((h) => h.id);
    expect(ids).not.toContain('wng-kk');
    expect(ids).not.toContain('sby-kk');
  });
  it('filter wilayah: Surabaya tidak melihat Wonogiri dan sebaliknya', () => {
    const sby = searchBm25(db, { query: 'KK baru akta nikah', kodeKabKota: '3578' }).map((h) => h.id);
    expect(sby).toContain('sby-kk');
    expect(sby).not.toContain('wng-kk');
    const wng = searchBm25(db, { query: 'KK baru akta nikah', kodeKabKota: '3312' }).map((h) => h.id);
    expect(wng).toContain('wng-kk');
    expect(wng).not.toContain('sby-kk');
  });
  it('chunk provinsi terlihat bagi kab/kota di provinsi itu', () => {
    expect(searchBm25(db, { query: 'pajak kendaraan', kodeKabKota: '3312' }).map((h) => h.id)).toEqual([
      'jt-pajak',
    ]);
    expect(searchBm25(db, { query: 'pajak kendaraan', kodeKabKota: '3578' })).toEqual([]);
  });
  it('filter layanan', () => {
    const ids = searchBm25(db, { query: 'akta nikah', kodeKabKota: '3312', layanan: 'kk' }).map((h) => h.id);
    expect(ids).toEqual(['wng-kk']);
  });
  it('kueri adversarial tidak merusak sintaks FTS', () => {
    const qs = ['"', 'a" OR "b', 'NEAR(a b)', '*', 'col:x', '-', '(', 'x"; DROP TABLE chunks;--'];
    for (const q of qs) expect(() => searchBm25(db, { query: q })).not.toThrow();
    expect(countChunks(db)).toBe(5);
  });
  it('kueri tanpa token atau di luar cakupan -> kosong', () => {
    expect(searchBm25(db, { query: '!!!' })).toEqual([]);
    expect(searchBm25(db, { query: 'resep rendang padang' })).toEqual([]);
  });
  it('buildMatch mengutip token', () => {
    expect(buildMatch('akta lahir')).toBe('"akta" OR "lahir" OR "kelahiran"');
  });
  it('batas k', () => {
    expect(searchBm25(db, { query: 'akta', k: 1 }).length).toBeLessThanOrEqual(1);
  });
});

describe('reciprocalRankFusion', () => {
  it('rumus 1/(k+rank) dengan k=60', () => {
    const r = reciprocalRankFusion([
      [{ id: 'a' }, { id: 'b' }],
      [{ id: 'b' }, { id: 'c' }],
    ]);
    expect(r.map((x) => x.id)).toEqual(['b', 'a', 'c']);
    expect(r[0]!.skor).toBeCloseTo(1 / 62 + 1 / 61, 10);
    expect(r[1]!.skor).toBeCloseTo(1 / 61, 10);
  });
  it('daftar kosong', () => {
    expect(reciprocalRankFusion([])).toEqual([]);
  });
});

describe('searchHybrid', () => {
  it('tanpa leg vektor = BM25', () => {
    expect(searchHybrid(db, { query: 'akta kelahiran' }).map((h) => h.id)).toEqual(
      searchBm25(db, { query: 'akta kelahiran' }).map((h) => h.id),
    );
  });
  it('menggabungkan leg vektor, termasuk id yang tidak ada di BM25', () => {
    const hits = searchHybrid(db, { query: 'akta kelahiran', k: 3 }, ['jt-pajak', 'nas-akta']);
    expect(hits.map((h) => h.id)).toContain('jt-pajak');
    expect(hits[0]?.id).toBe('nas-akta');
  });
  it('sqlite-vec opsional: tidak terpasang -> false tanpa melempar', async () => {
    await expect(tryLoadSqliteVec(db)).resolves.toBe(false);
  });
});

describe('cari_pengetahuan', () => {
  it('mengembalikan hasil valid dengan mode bm25', () => {
    const out = cariPengetahuanTool.execute(db, { query: 'KTP hilang' });
    expect(cariPengetahuanTool.outputSchema.safeParse(out).success).toBe(true);
    expect(out.mode).toBe('bm25');
    expect(out.tanpaHasil).toBe(false);
    expect(out.hasil[0]?.kutipan.url).toContain('https://');
  });
  it('tanpa hasil -> tanpaHasil true (hand-off)', () => {
    const out = cariPengetahuanTool.execute(db, { query: 'resep rendang' });
    expect(out).toMatchObject({ tanpaHasil: true, hasil: [] });
  });
  it('mode hybrid bila ada leg vektor', () => {
    expect(cariPengetahuanTool.execute(db, { query: 'akta' }, { vectorIds: ['nas-akta'] }).mode).toBe(
      'hybrid',
    );
  });
  it('menolak input tidak valid', () => {
    expect(() => cariPengetahuanTool.execute(db, { query: '' })).toThrow();
    expect(() => cariPengetahuanTool.execute(db, { query: 'x', kodeKabKota: '33' })).toThrow();
    expect(() => cariPengetahuanTool.execute(db, { query: 'x', k: 99 })).toThrow();
  });
  it('filter wilayah lewat tool', () => {
    const out = cariPengetahuanTool.execute(db, { query: 'KK baru', kodeKabKota: '3578' });
    expect(out.hasil[0]?.id).toBe('sby-kk');
    expect(out.hasil.map((h) => h.id)).not.toContain('wng-kk');
  });
});
