import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb, countChunks, searchBm25 } from '../index.js';
import { chunkByHeading } from './chunk.js';
import { htmlToText, htmlTitle } from './extract.js';
import { MIN_INTERVAL_MS, PoliteFetcher, USER_AGENT, type Deps, type FetchLike } from './fetcher.js';
import { runIngest } from './ingest.js';
import { Robots } from './robots.js';
import { loadSources, type SourceEntry } from './sources.js';

const HTML = `<html><head><title>Layanan &amp; Syarat</title><style>.x{}</style></head><body>
<nav>Menu Utama</nav><h1>Akta Kelahiran</h1><script>alert(1)</script>
<p>Persyaratan:</p><ul><li>Surat keterangan lahir</li><li>KK orang tua</li></ul>
<h2>Tabel</h2><table><tr><td>Berkas</td><td>Keterangan</td></tr><tr><td>KK</td><td>Asli &nbsp;dan fotokopi</td></tr></table>
<footer>hak cipta</footer></body></html>`;

const src = (over: Partial<SourceEntry> = {}): SourceEntry => ({
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
  ...over,
});

type Call = { url: string; at: number; ua: string };
function fakeDeps(routes: Record<string, { status?: number; body: string; type?: string }>) {
  let t = 1_000_000;
  const calls: Call[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({ url, at: t, ua: init.headers['user-agent'] ?? '' });
    const r = routes[url] ?? { status: 404, body: '' };
    return {
      status: r.status ?? 200,
      headers: {
        get: (n) => (n.toLowerCase() === 'content-type' ? (r.type ?? 'text/html; charset=utf-8') : null),
      },
      text: async () => r.body,
    };
  };
  const deps: Deps = {
    fetch: fetchFn,
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
  };
  return { deps, calls, advance: (ms: number) => (t += ms) };
}

describe('Robots', () => {
  const r = new Robots(
    [
      'User-agent: *',
      'Disallow: /privat',
      'Allow: /privat/umum',
      'Disallow: /*.pdf$',
      '',
      'User-agent: urusinbot',
      'Disallow: /khusus',
    ].join('\n'),
    'urusinbot',
  );
  it('grup spesifik mengalahkan *', () => {
    expect(r.isAllowed('/khusus/a')).toBe(false);
    expect(r.isAllowed('/privat')).toBe(true);
  });
  it('wildcard, Allow terpanjang, dan akhiran $', () => {
    const star = new Robots(
      ['User-agent: *', 'Disallow: /privat', 'Allow: /privat/umum', 'Disallow: /*.pdf$'].join('\n'),
      'urusinbot',
    );
    expect(star.isAllowed('/privat/rahasia')).toBe(false);
    expect(star.isAllowed('/privat/umum/x')).toBe(true);
    expect(star.isAllowed('/a/b.pdf')).toBe(false);
    expect(star.isAllowed('/a/b.pdf?x=1')).toBe(true);
    expect(star.isAllowed('/layanan')).toBe(true);
  });
  it('robots kosong = boleh', () => {
    expect(new Robots('', 'urusinbot').isAllowed('/apa-saja')).toBe(true);
  });
  it('Disallow: / memblokir semua', () => {
    expect(new Robots('User-agent: *\nDisallow: /', 'urusinbot').isAllowed('/x')).toBe(false);
  });
});

describe('PoliteFetcher', () => {
  it('jeda >= 2 detik per host (jam palsu) dan UA jujur', async () => {
    const { deps, calls } = fakeDeps({
      'https://a.go.id/robots.txt': { body: 'User-agent: *\nAllow: /' },
      'https://a.go.id/1': { body: 'x' },
      'https://a.go.id/2': { body: 'y' },
    });
    const f = new PoliteFetcher(deps);
    await f.get('https://a.go.id/1');
    await f.get('https://a.go.id/2');
    expect(calls.map((c) => c.url)).toEqual([
      'https://a.go.id/robots.txt',
      'https://a.go.id/1',
      'https://a.go.id/2',
    ]);
    for (let i = 1; i < calls.length; i++)
      expect(calls[i]!.at - calls[i - 1]!.at).toBeGreaterThanOrEqual(MIN_INTERVAL_MS);
    expect(calls.every((c) => c.ua === USER_AGENT)).toBe(true);
    expect(USER_AGENT).not.toMatch(/@/);
  });
  it('host berbeda tidak saling menunggu', async () => {
    const { deps, calls } = fakeDeps({
      'https://a.go.id/1': { body: 'x' },
      'https://b.go.id/1': { body: 'x' },
    });
    const f = new PoliteFetcher(deps);
    await f.get('https://a.go.id/1');
    await f.get('https://b.go.id/1');
    const a1 = calls.find((c) => c.url === 'https://a.go.id/1')!;
    const b1 = calls.find((c) => c.url === 'https://b.go.id/1')!;
    expect(b1.at - a1.at).toBeLessThan(MIN_INTERVAL_MS * 3);
  });
  it('robots yang melarang: halaman tidak diambil', async () => {
    const { deps, calls } = fakeDeps({
      'https://a.go.id/robots.txt': { body: 'User-agent: *\nDisallow: /layanan' },
      'https://a.go.id/layanan': { body: 'rahasia' },
    });
    await expect(new PoliteFetcher(deps).get('https://a.go.id/layanan')).rejects.toThrow(/robots/);
    expect(calls.map((c) => c.url)).toEqual(['https://a.go.id/robots.txt']);
  });
});

describe('extract + chunk', () => {
  it('HTML -> teks tanpa script/nav/footer, tabel sebaris', () => {
    const t = htmlToText(HTML);
    expect(t).toContain('# Akta Kelahiran');
    expect(t).toContain('- Surat keterangan lahir');
    expect(t).toContain('KK | Asli dan fotokopi');
    expect(t).not.toMatch(/alert|Menu Utama|hak cipta|<|&amp;/);
    expect(htmlTitle(HTML)).toBe('Layanan & Syarat');
  });
  it('chunk per heading, tabel utuh', () => {
    const cs = chunkByHeading(htmlToText(HTML));
    expect(cs.map((c) => c.heading)).toEqual(['Akta Kelahiran', 'Tabel']);
    expect(cs[1]!.text).toContain('Berkas | Keterangan');
  });
  it('bagian panjang dipecah', () => {
    const long = '# H\n' + Array.from({ length: 200 }, (_, i) => `baris ${i} ${'x'.repeat(40)}`).join('\n');
    expect(chunkByHeading(long, 500).length).toBeGreaterThan(5);
  });
});

describe('runIngest', () => {
  it('dry-run: tanpa jaringan, tanpa DB; melewati sumber non-korpus dan unverified', async () => {
    const reports = await runIngest({
      sources: [
        src(),
        src({ id: 'p', ingest: false }),
        src({ id: 'u', status: 'unverified' }),
        src({ id: 'f', jenis: 'pdf' }),
      ],
      dryRun: true,
    });
    expect(reports.map((r) => [r.id, r.action, r.reason])).toEqual([
      ['uji', 'planned', undefined],
      ['p', 'skipped', 'bukan-sumber-korpus'],
      ['u', 'skipped', 'unverified'],
      ['f', 'skipped', 'pdf-belum-didukung'],
    ]);
  });
  it('--only memilih satu sumber; id tidak dikenal -> galat', async () => {
    const two = [src({ id: 'a' }), src({ id: 'b' })];
    expect((await runIngest({ sources: two, only: 'b', dryRun: true })).map((r) => r.id)).toEqual(['b']);
    await expect(runIngest({ sources: two, only: 'zzz', dryRun: true })).rejects.toThrow();
  });
  it('ingest nyata (fetch palsu) menulis chunk bersumber dan bisa dicari', async () => {
    const { deps } = fakeDeps({
      'https://disdukcapil.contoh.go.id/robots.txt': { body: 'User-agent: *\nAllow: /' },
      'https://disdukcapil.contoh.go.id/layanan': { body: HTML },
    });
    const db = openDb(':memory:');
    const reports = await runIngest({ sources: [src()], dryRun: false, db, deps });
    expect(reports[0]).toMatchObject({ action: 'ingested', chunks: 2 });
    expect(countChunks(db)).toBe(2);
    const hit = searchBm25(db, { query: 'surat keterangan lahir', kodeKabKota: '3312' })[0]!;
    expect(hit.kutipan.url).toBe('https://disdukcapil.contoh.go.id/layanan');
    expect(hit.verifiedAt).toBe(new Date(1_000_000 + 2000).toISOString());
    expect(searchBm25(db, { query: 'surat keterangan lahir', kodeKabKota: '3578' })).toEqual([]);
    // ingest ulang menggantikan, bukan menggandakan
    await runIngest({ sources: [src()], dryRun: false, db, deps });
    expect(countChunks(db)).toBe(2);
  });
  it('robots melarang -> blocked, tidak ada chunk', async () => {
    const { deps, calls } = fakeDeps({
      'https://disdukcapil.contoh.go.id/robots.txt': { body: 'User-agent: *\nDisallow: /' },
      'https://disdukcapil.contoh.go.id/layanan': { body: HTML },
    });
    const db = openDb(':memory:');
    const reports = await runIngest({ sources: [src()], dryRun: false, db, deps });
    expect(reports[0]).toMatchObject({ action: 'blocked', reason: 'robots.txt' });
    expect(countChunks(db)).toBe(0);
    expect(calls.some((c) => c.url.endsWith('/layanan'))).toBe(false);
  });
  it('HTTP non-200 dan tipe konten tak didukung tidak menulis apa pun', async () => {
    const db = openDb(':memory:');
    const a = fakeDeps({ 'https://disdukcapil.contoh.go.id/layanan': { status: 503, body: '' } });
    expect((await runIngest({ sources: [src()], dryRun: false, db, deps: a.deps }))[0]).toMatchObject({
      action: 'error',
    });
    const b = fakeDeps({
      'https://disdukcapil.contoh.go.id/layanan': { body: '%PDF', type: 'application/pdf' },
    });
    expect((await runIngest({ sources: [src()], dryRun: false, db, deps: b.deps }))[0]).toMatchObject({
      action: 'skipped',
    });
    expect(countChunks(db)).toBe(0);
  });
  it('origin di luar allowlist ditolak saat penulisan', async () => {
    const { deps } = fakeDeps({ 'https://contoh.com/x': { body: HTML } });
    const db = openDb(':memory:');
    const r = await runIngest({ sources: [src({ url: 'https://contoh.com/x' })], dryRun: false, db, deps });
    expect(r[0]!.action).toBe('error');
    expect(countChunks(db)).toBe(0);
  });
});

describe('data/sources.json', () => {
  const sources = loadSources(fileURLToPath(new URL('../../../../data/sources.json', import.meta.url)));
  it('lolos skema; id unik', () => {
    expect(new Set(sources.map((s) => s.id)).size).toBe(sources.length);
  });
  it('sumber confirmed memakai origin resmi dan punya tanggal probe', () => {
    for (const s of sources.filter((x) => x.status === 'confirmed')) {
      expect(s.url.startsWith('https://'), s.id).toBe(true);
      expect(s.lastFetched, s.id).not.toBeNull();
    }
  });
  it('mencakup sumber yang diminta', () => {
    const ids = sources.map((s) => s.id);
    for (const id of [
      'wonogiri-layanan',
      'klampid-katalog',
      'semarang-data-dukung',
      'uu-23-2006',
      'uu-27-2022',
      'cek-dpt',
      'cek-bansos',
      'ombudsman-pengaduan',
    ]) {
      expect(ids).toContain(id);
    }
  });
  it('file mentah tidak memuat PII', () => {
    const raw = readFileSync(new URL('../../../../data/sources.json', import.meta.url), 'utf8');
    expect(raw).not.toMatch(/\d{12,}|\+62|wa\.me/);
  });
});
