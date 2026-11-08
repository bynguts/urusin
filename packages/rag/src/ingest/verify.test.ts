import { describe, expect, it } from 'vitest';
import { cariPengetahuanTool, openDb, upsertChunks, ChunkRejectedError, buildMatch } from '../index.js';
import { MIN_INTERVAL_MS, USER_AGENT, type Deps, type FetchLike } from './fetcher.js';
import { runIngest } from './ingest.js';
import type { SourceEntry } from './sources.js';
import { sourceFreshness, PERINGATAN_BERUBAH } from './state.js';
import { runVerify } from './verify.js';

const src: SourceEntry = {
  id: 'uji',
  url: 'https://disdukcapil.contoh.go.id/layanan',
  judul: 'Layanan Contoh',
  instansi: 'Dinas Contoh',
  jenis: 'halaman',
  domain: 'dukcapil',
  kodeWilayah: null,
  layanan: 'adminduk',
  status: 'confirmed',
  robots: 'ditemukan',
  lastFetched: null,
  ingest: true,
  catatan: '',
};

const page = (extra = '') =>
  `<html><body><h1>Akta Kelahiran</h1><script>var t=${Math.random()}</script><p>Syarat akta kelahiran: surat keterangan lahir.${extra}</p></body></html>`;

type Route = { status?: number; body?: string; etag?: string; lastModified?: string };
function harness(initial: Record<string, Route>) {
  const routes = { ...initial };
  const calls: { url: string; at: number; headers: Record<string, string> }[] = [];
  let t = Date.parse('2026-11-01T00:00:00Z');
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({ url, at: t, headers: init.headers });
    const r = routes[url] ?? { status: 404 };
    const inm = init.headers['if-none-match'];
    if (inm && r.etag && inm === r.etag)
      return { status: 304, headers: { get: () => null }, text: async () => '' };
    return {
      status: r.status ?? 200,
      headers: {
        get: (n) =>
          n.toLowerCase() === 'content-type'
            ? 'text/html'
            : n.toLowerCase() === 'etag'
              ? (r.etag ?? null)
              : n.toLowerCase() === 'last-modified'
                ? (r.lastModified ?? null)
                : null,
      },
      text: async () => r.body ?? '',
    };
  };
  const deps: Deps = {
    fetch: fetchFn,
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
  };
  return { deps, routes, calls, advance: (ms: number) => (t += ms) };
}

const ROBOTS = { 'https://disdukcapil.contoh.go.id/robots.txt': { body: 'User-agent: *\nAllow: /' } };

describe('ingest merekam status sumber dan mewajibkan verifiedAt', () => {
  it('ingest mencatat etag + hash; chunk punya verifiedAt non-null', async () => {
    const h = harness({ ...ROBOTS, [src.url]: { body: page(), etag: '"v1"' } });
    const db = openDb(':memory:');
    await runIngest({ sources: [src], dryRun: false, db, deps: h.deps });
    const row = db
      .prepare('SELECT etag, content_hash, changed FROM source_state WHERE source_id = ?')
      .get('uji') as {
      etag: string;
      content_hash: string;
      changed: number;
    };
    expect(row).toMatchObject({ etag: '"v1"', changed: 0 });
    expect(row.content_hash).toMatch(/^[0-9a-f]{64}$/);
    const nulls = db.prepare('SELECT COUNT(*) AS n FROM chunks WHERE verified_at IS NULL').get() as {
      n: number;
    };
    expect(nulls.n).toBe(0);
  });
  it('verifiedAt null ditolak oleh skema dan oleh trigger DB (migrasi aditif)', () => {
    const db = openDb(':memory:');
    const c = {
      id: 'x',
      text: 't',
      sourceRef: { url: 'https://a.go.id/x', judul: 'J', instansi: 'I' },
      verifiedAt: null,
    };
    expect(() => upsertChunks(db, [c])).toThrow(ChunkRejectedError);
    expect(() => upsertChunks(db, [c], { requireVerified: true })).toThrow(ChunkRejectedError);
    expect(() =>
      db
        .prepare(
          "INSERT INTO chunks(id, judul, text, instansi, url, verified_at) VALUES ('y','j','t','i','https://a.go.id/y',NULL)",
        )
        .run(),
    ).toThrow(/verified_at wajib/);
  });
});

describe('runVerify', () => {
  const setup = async () => {
    const h = harness({ ...ROBOTS, [src.url]: { body: page(), etag: '"v1"' } });
    const db = openDb(':memory:');
    await runIngest({ sources: [src], dryRun: false, db, deps: h.deps });
    return { h, db };
  };

  it('304 / hash sama -> unchanged, verifiedAt diperbarui, header kondisional dikirim, UA jujur', async () => {
    const { h, db } = await setup();
    h.advance(86_400_000);
    h.calls.length = 0;
    const r = await runVerify({ db, sources: [src], deps: h.deps });
    expect(r).toEqual([{ id: 'uji', url: src.url, action: 'unchanged' }]);
    const get = h.calls.find((c) => c.url === src.url)!;
    expect(get.headers['if-none-match']).toBe('"v1"');
    expect(get.headers['user-agent']).toBe(USER_AGENT);
    const v = db.prepare('SELECT verified_at FROM chunks LIMIT 1').get() as { verified_at: string };
    expect(Date.parse(v.verified_at)).toBeGreaterThanOrEqual(Date.parse('2026-11-02T00:00:00Z'));
  });

  it('isi berbeda -> changed, hasil pencarian memberi peringatan, teks chunk tidak diubah', async () => {
    const { h, db } = await setup();
    h.routes[src.url] = { body: page(' Biaya Rp 5.000.'), etag: '"v2"' };
    const r = await runVerify({ db, sources: [src], deps: h.deps });
    expect(r[0]).toMatchObject({ action: 'changed', reason: PERINGATAN_BERUBAH });
    expect(sourceFreshness(db).changed).toEqual(['uji']);
    const out = cariPengetahuanTool.execute(db, { query: 'akta kelahiran' });
    expect(out.hasil[0]?.peringatan).toBe(PERINGATAN_BERUBAH);
    expect(out.hasil.map((x) => x.text).join(' ')).not.toContain('Biaya');
    // ingest ulang membersihkan tanda
    await runIngest({ sources: [src], dryRun: false, db, deps: h.deps });
    expect(sourceFreshness(db).changed).toEqual([]);
  });

  it('hanya markup dinamis yang berubah (skrip) -> tetap unchanged', async () => {
    const { h, db } = await setup();
    h.routes[src.url] = { body: page() }; // skrip acak berbeda, tanpa etag
    const r = await runVerify({ db, sources: [src], deps: h.deps });
    expect(r[0]?.action).toBe('unchanged');
  });

  it('robots melarang -> blocked, tidak mengambil halaman', async () => {
    const { h, db } = await setup();
    h.routes['https://disdukcapil.contoh.go.id/robots.txt'] = { body: 'User-agent: *\nDisallow: /layanan' };
    const fresh = harness({
      'https://disdukcapil.contoh.go.id/robots.txt': { body: 'User-agent: *\nDisallow: /layanan' },
    });
    h.calls.length = 0;
    const r = await runVerify({ db, sources: [src], deps: fresh.deps });
    expect(r[0]?.action).toBe('blocked');
    expect(fresh.calls.map((c) => c.url)).toEqual(['https://disdukcapil.contoh.go.id/robots.txt']);
  });

  it('HTTP 500 -> error; sumber tak dikenal -> skipped; --only tanpa ingest -> galat', async () => {
    const { h, db } = await setup();
    h.routes[src.url] = { status: 500 };
    expect((await runVerify({ db, sources: [src], deps: h.deps }))[0]?.action).toBe('error');
    expect((await runVerify({ db, sources: [], deps: h.deps }))[0]?.action).toBe('skipped');
    await expect(runVerify({ db, sources: [src], only: 'zzz', deps: h.deps })).rejects.toThrow();
  });

  it('sourceFreshness: umur sumber tertua dalam hari', async () => {
    const { db } = await setup();
    db.prepare("UPDATE source_state SET verified_at = '2026-10-01T00:00:00.000Z'").run();
    const f = sourceFreshness(db, Date.parse('2026-11-08T00:00:00Z'));
    expect(f.oldestAgeDays).toBe(38);
    expect(sourceFreshness(openDb(':memory:')).oldestAgeDays).toBeNull();
  });

  it('dua sumber di satu host dipisahkan >= 2 detik', async () => {
    const other = { ...src, id: 'uji2', url: 'https://disdukcapil.contoh.go.id/lain' };
    const h = harness({
      ...ROBOTS,
      [src.url]: { body: page() },
      [other.url]: { body: page(' lain') },
    });
    const db = openDb(':memory:');
    await runIngest({ sources: [src, other], dryRun: false, db, deps: h.deps });
    h.calls.length = 0;
    await runVerify({ db, sources: [src, other], deps: h.deps });
    const at = h.calls.filter((c) => c.url !== ROBOTS_URL).map((c) => c.at);
    expect(at[1]! - at[0]!).toBeGreaterThanOrEqual(MIN_INTERVAL_MS);
  });
});

const ROBOTS_URL = 'https://disdukcapil.contoh.go.id/robots.txt';

describe('stopword di jalur pencarian lama (F2)', () => {
  it('buildMatch membuang stopword tetapi tidak mengosongkan kueri', () => {
    expect(buildMatch('bagaimana cara ktp hilang yang di')).toBe(
      '"cara" OR "ktp" OR "hilang" OR "penggantian" OR "ktp-el" OR "kehilangan"',
    );
    expect(buildMatch('yang di ke')).toBe('"yang" OR "di" OR "ke"');
  });
});
