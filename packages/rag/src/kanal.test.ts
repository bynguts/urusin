import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cariPengetahuanTool, openDb, upsertChunks } from './index.js';
import { kanalFor, kontakFor, loadKanal, loadKontak, type Kanal, type KontakEntry } from './kanal.js';
import { mentionedService, outOfScopeNoun, outOfScopeServices, withoutService } from './out-of-scope.js';
import { placeTokens } from './place-names.js';

const kanal: Kanal[] = [
  {
    id: 'sim',
    layanan: 'SIM',
    instansi: 'Korlantas Polri',
    url: 'https://korlantas.polri.go.id/',
    deskripsi: 'SIM lewat Korlantas.',
    cek: 'sim',
    verifiedAt: '2026-11-08T00:00:00.000Z',
  },
  {
    id: 'skck',
    layanan: 'SKCK',
    instansi: 'Polri',
    url: 'https://skck.polri.go.id/',
    deskripsi: 'SKCK lewat Polri.',
    cek: 'skck',
    verifiedAt: null,
  },
];
const kontak: KontakEntry[] = [
  {
    kode: '3201',
    nama: 'Kabupaten Bogor',
    status: 'terverifikasi',
    website: 'https://disdukcapil.bogorkab.go.id',
    judulHalaman: 'Disdukcapil',
    alamat: 'Jl. Tegar Beriman No. 1',
    sourceUrl: 'https://disdukcapil.bogorkab.go.id/',
    verifiedAt: '2026-11-08T00:00:00.000Z',
  },
  {
    kode: '3202',
    nama: 'Kabupaten Sukabumi',
    status: 'terverifikasi',
    website: 'https://a.go.id',
    judulHalaman: 'x',
    sourceUrl: 'https://a.go.id/',
    verifiedAt: '2026-11-08T00:00:00.000Z',
  },
  { kode: '3203', nama: 'Kabupaten Cianjur', status: 'belum_terverifikasi' },
];

describe('kanalFor / kontakFor', () => {
  it('tautan dan tanggal tampil hanya bila terverifikasi', () => {
    expect(kanalFor('sim', kanal)).toMatchObject({
      url: 'https://korlantas.polri.go.id/',
      verifiedAt: expect.any(String),
    });
    expect(kanalFor('skck', kanal)).toEqual({
      layanan: 'SKCK',
      instansi: 'Polri',
      deskripsi: 'SKCK lewat Polri.',
    });
    expect(kanalFor('tidak-ada', kanal)).toBeUndefined();
  });
  it('kontak hanya untuk yang terverifikasi; alamat ikut bila ada', () => {
    expect(kontakFor('3201', kontak)?.alamat).toBe('Jl. Tegar Beriman No. 1');
    expect(kontakFor('3202', kontak)).not.toHaveProperty('alamat');
    expect(kontakFor('3203', kontak)).toBeUndefined();
    expect(kontakFor('9999', kontak)).toBeUndefined();
  });
  it('data bawaan repo valid dan memuat setiap layanan luar cakupan', () => {
    const k = loadKanal();
    for (const s of outOfScopeServices()) expect(k.some((x) => x.id === s.id)).toBe(true);
    expect(kanalFor('sim')).toBeDefined();
    expect(loadKontak().length).toBeGreaterThan(400);
    expect(kontakFor('0000')).toBeUndefined();
  });
  it('loadKanal/loadKontak menolak berkas tidak valid', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kanal-'));
    const bad = join(dir, 'k.json');
    writeFileSync(bad, JSON.stringify({ kanal: [{ ...kanal[0], url: 'https://contoh.com/' }] }));
    expect(() => loadKanal(bad)).toThrow();
    writeFileSync(bad, JSON.stringify({ kontak: [{ kode: '1', nama: 'x', status: 'belum_terverifikasi' }] }));
    expect(() => loadKontak(bad)).toThrow();
  });
});

describe('layanan luar cakupan', () => {
  it('mentionedService dan withoutService', () => {
    const g = mentionedService('perpanjang SIM A di Bogor');
    expect(g?.id).toBe('sim');
    expect(mentionedService('akta kelahiran')).toBeNull();
    expect(withoutService('perpanjang SIM A di Bogor', g!)).not.toMatch(/sim/i);
  });
  it('outOfScopeNoun tanpa layanan luar cakupan', () => {
    expect(outOfScopeNoun(openDb(':memory:'), 'akta kelahiran')).toBeNull();
  });
  it('placeTokens memuat nama wilayah', () => {
    expect(placeTokens().size).toBeGreaterThan(100);
  });
});

describe('hand-off pada tool', () => {
  const db = openDb(':memory:');
  upsertChunks(db, [
    {
      id: 'ktp',
      text: 'Penggantian KTP-el hilang butuh surat kehilangan.',
      sourceRef: { url: 'https://contoh.go.id/ktp', judul: 'Penggantian KTP-el', instansi: 'Dinas Contoh' },
      verifiedAt: '2026-11-08T00:00:00.000Z',
    },
  ]);
  it('layanan luar cakupan menyertakan kanal resmi', () => {
    const out = cariPengetahuanTool.execute(db, { query: 'syarat perpanjang SIM A' }, { minCoverage: 0.1 });
    expect(out.tanpaHasil).toBe(true);
    expect(out.kanal?.layanan).toMatch(/SIM/);
    expect(out.kanal?.url).toMatch(/^https:\/\/.*\.go\.id/);
  });
  it('kab/kota dikenali tanpa korpus: kontak Disdukcapil hanya bila terverifikasi', () => {
    const all = loadKontak();
    const verified = all.find((k) => k.status === 'terverifikasi')!;
    const out = cariPengetahuanTool.execute(db, { query: 'zzqq xxyy', kodeKabKota: verified.kode });
    expect(out.tanpaHasil).toBe(true);
    expect(out.kontak?.website).toMatch(/^https:\/\//);
    const unverified = all.find((k) => k.status === 'belum_terverifikasi')!;
    const none = cariPengetahuanTool.execute(db, { query: 'zzqq xxyy', kodeKabKota: unverified.kode });
    expect(none.kontak).toBeUndefined();
  });
  it('ada hasil: tidak ada hand-off', async () => {
    const out = await cariPengetahuanTool.executeAsync(db, { query: 'KTP-el hilang', kodeKabKota: '3201' });
    expect(out.tanpaHasil).toBe(false);
    expect(out.kanal).toBeUndefined();
    expect(out.kontak).toBeUndefined();
  });
});
