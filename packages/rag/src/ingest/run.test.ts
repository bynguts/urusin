import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runKanal } from './kanal-verify.js';
import type { ProbeGet } from './kontak.js';
import { runKontak } from './kontak-run.js';
import { runPemda } from './pemda-run.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'urusin-run-'));
const NOW = new Date('2026-11-08T00:00:00.000Z');

describe('runKanal', () => {
  it('menulis verifiedAt untuk yang lolos dan null untuk yang gagal', async () => {
    const path = join(tmp(), 'kanal.json');
    const entry = (id: string, url: string) => ({
      id,
      layanan: id,
      instansi: 'Instansi',
      url,
      deskripsi: 'd',
      cek: 'layanan',
      verifiedAt: '2020-01-01T00:00:00.000Z',
    });
    writeFileSync(
      path,
      JSON.stringify({
        kanal: [entry('a', 'https://a.go.id/'), entry('b', 'https://b.go.id/')],
      }),
    );
    const get: ProbeGet = async (url) => ({
      status: url.includes('a.go.id') ? 200 : 500,
      body: '<p>layanan</p>',
      contentType: 'text/html',
      finalUrl: url,
    });
    const lines: string[] = [];
    await runKanal({ path, get, now: () => NOW, log: (l) => lines.push(l) });
    const out = JSON.parse(readFileSync(path, 'utf8')) as {
      kanal: { id: string; verifiedAt: string | null }[];
    };
    expect(out.kanal.map((k) => k.verifiedAt)).toEqual([NOW.toISOString(), null]);
    expect(lines[0]).toMatch(/^OK/);
    expect(lines[1]).toMatch(/^GAGAL .*HTTP 500/);
  });
});

describe('runKontak', () => {
  const kabkota = Array.from({ length: 12 }, (_, i) => ({
    kode: `32${String(i + 1).padStart(2, '0')}`,
    jenis: 'kota' as const,
    nama: `Kota Wil${'abcdefghijkl'[i]}`,
  }));
  const setup = () => {
    const dir = tmp();
    const wilayahPath = join(dir, 'kabkota.json');
    writeFileSync(wilayahPath, JSON.stringify({ kabkota }));
    return { wilayahPath, outPath: join(dir, 'sub', 'kontak.json') };
  };
  const calls: string[] = [];
  const deps = {
    // hanya "wila" (Kota Wila) yang punya situs; sisanya tidak resolve
    resolves: async (h: string) => h.includes('wila.') || h.includes('wilakota'),
    get: (async (url: string) => {
      calls.push(url);
      return {
        status: 200,
        body: '<title>t</title><p>Dinas Kependudukan Kota Wila</p>',
        contentType: 'text/html',
        finalUrl: url,
      };
    }) as ProbeGet,
    now: () => NOW,
  };

  it('memproses semua wilayah, menyimpan berkala dan di akhir; yang sudah ada dilewati tanpa refresh', async () => {
    const p = setup();
    const lines: string[] = [];
    const n = await runKontak({ ...p, deps, log: (l) => lines.push(l) });
    expect(n).toBe(12);
    expect(lines.length).toBe(2); // simpan pada kelipatan 10 dan di akhir
    const out = JSON.parse(readFileSync(p.outPath, 'utf8')) as {
      total: number;
      kontak: { status: string }[];
    };
    expect(out.total).toBe(12);
    expect(out.kontak.filter((k) => k.status === 'terverifikasi').length).toBe(1);

    const again = await runKontak({ ...p, deps, log: () => undefined });
    expect(again).toBe(0);
    const refreshed = await runKontak({ ...p, only: '3201', refresh: true, deps, log: () => undefined });
    expect(refreshed).toBe(1);
    const limited = await runKontak({ ...p, limit: 2, refresh: true, deps, log: () => undefined });
    expect(limited).toBe(2);
    // --belum: hanya 11 entri belum_terverifikasi yang diperiksa ulang; Kota Wila dipertahankan.
    const belum = await runKontak({ ...p, belum: true, deps, log: () => undefined });
    expect(belum).toBe(11);
  });
});

describe('runPemda', () => {
  const setup = () => {
    const dir = tmp();
    const wilayahPath = join(dir, 'kabkota.json');
    const kontakPath = join(dir, 'kontak.json');
    writeFileSync(
      wilayahPath,
      JSON.stringify({
        provinsi: [{ kode: '91', nama: 'Papua' }],
        kabkota: [
          { kode: '9171', jenis: 'kota', nama: 'Kota Jayapura' },
          { kode: '9103', jenis: 'kabupaten', nama: 'Kabupaten Jayapura' },
          { kode: '3201', jenis: 'kabupaten', nama: 'Kabupaten Bogor' },
        ],
      }),
    );
    // Kab. Bogor sudah punya situs Disdukcapil terverifikasi: tidak butuh cadangan pemda.
    writeFileSync(kontakPath, JSON.stringify({ kontak: [{ kode: '3201', status: 'terverifikasi' }] }));
    return { wilayahPath, kontakPath, outPath: join(dir, 'pemda.json') };
  };
  let naik = false;
  const deps = {
    resolves: async (h: string) => h === 'papua.go.id' || (naik && h === 'jayapurakota.go.id'),
    get: (async (url: string) => ({
      status: 200,
      body: url.includes('papua')
        ? '<p>Situs resmi Pemerintah Provinsi Papua</p>'
        : '<p>Situs resmi Pemerintah Kota Jayapura</p>',
      contentType: 'text/html',
      finalUrl: url,
    })) as ProbeGet,
    now: () => NOW,
  };

  it('provinsi + kab/kota tanpa situs Disdukcapil; --belum hanya mengulang yang belum terverifikasi', async () => {
    const p = setup();
    expect(await runPemda({ ...p, deps, log: () => undefined })).toBe(3);
    const baca = () =>
      JSON.parse(readFileSync(p.outPath, 'utf8')) as {
        total: number;
        pemda: { kode: string; status: string }[];
      };
    expect(baca().total).toBe(3);
    expect(
      baca()
        .pemda.filter((x) => x.status === 'terverifikasi')
        .map((x) => x.kode),
    ).toEqual(['91']);
    expect(await runPemda({ ...p, deps, log: () => undefined })).toBe(0);
    naik = true; // situs Pemkot Jayapura tadi turun, sekarang naik
    expect(await runPemda({ ...p, belum: true, deps, log: () => undefined })).toBe(2);
    expect(
      baca()
        .pemda.filter((x) => x.status === 'terverifikasi')
        .map((x) => x.kode),
    ).toEqual(['91', '9171']);
  });
});
