import { describe, expect, it } from 'vitest';
import { cariPengetahuanTool, openDb, upsertChunks } from './index.js';
import { outOfScopeNoun } from './out-of-scope.js';

const mk = (id: string, judul: string, text: string) => ({
  id,
  text,
  sourceRef: { url: `https://contoh.go.id/${id}`, judul, instansi: 'Dinas Contoh' },
  verifiedAt: '2026-11-08T00:00:00.000Z',
});

const db = openDb(':memory:');
upsertChunks(db, [
  mk(
    'ktp',
    'Penggantian KTP-el',
    'Penggantian KTP-el hilang butuh surat kehilangan, bukan untuk SIM atau perpanjang sim.',
  ),
  mk('kk', 'Kartu Keluarga', 'Kartu keluarga baru perpanjang syarat sim persyaratan dokumen.'),
  mk('paspor', 'Layanan paspor', 'Paspor diurus di kantor imigrasi.'),
]);

describe('layanan luar cakupan', () => {
  it('istilah luar cakupan yang tidak ada di judul manapun terdeteksi', () => {
    expect(outOfScopeNoun(db, 'Syarat perpanjang SIM A')).toBe('sim');
    expect(outOfScopeNoun(db, 'cara bikin SKCK di polres')).toBe('skck');
  });
  it('istilah yang muncul di judul korpus bukan luar cakupan', () => {
    expect(outOfScopeNoun(db, 'cara membuat paspor baru')).toBeNull();
  });
  it('kueri biasa tidak terdeteksi', () => {
    expect(outOfScopeNoun(db, 'KTP hilang')).toBeNull();
    expect(outOfScopeNoun(db, 'simpan berkas')).toBeNull();
  });
  it('gerbang abstain: di_luar_cakupan meski kata umum cocok dengan chunk', () => {
    const out = cariPengetahuanTool.execute(db, { query: 'syarat perpanjang SIM A' }, { minCoverage: 0.1 });
    expect(out.tanpaHasil).toBe(true);
    expect(out.alasan).toBe('di_luar_cakupan');
  });
  it('gerbang mati (minCoverage 0) tidak memblokir', () => {
    const out = cariPengetahuanTool.execute(db, { query: 'syarat perpanjang SIM A' }, { minCoverage: 0 });
    expect(out.tanpaHasil).toBe(false);
  });
});
