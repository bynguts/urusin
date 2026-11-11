import { beforeEach, describe, expect, it } from 'vitest';
import {
  bagianPrior,
  BAGIAN_PRIOR,
  DEFAULT_PIPELINE,
  openDb,
  retrieve,
  upsertChunks,
  type Db,
} from './index.js';

// Korpus mini: IDF tidak representatif, jadi gerbang cakupan abstain dimatikan (yang diuji urutan).
const DEPS = { minCoverage: 0 };

// Bentuk standar pelayanan Disdukcapil (judul layanan sama, bagian dari chunkByHeading): judul bagian pelengkap yang
// pendek ("› biaya") membuat BM25 kolom judul mengunggulkannya di atas persyaratan (QA warga: KTP-el rusak Wonogiri
// dijawab "belum ada sumber resmi").
const LAYANAN = 'Penerbitan KTP-el Perubahan Data, Hilang dan Rusak (Standar Pelayanan Disdukcapil Contoh)';
const bagian = (i: number, nama: string, text: string) => ({
  id: `contoh-ktp-el#${i}`,
  text,
  sourceRef: {
    url: 'https://contoh.go.id/ktp-el',
    judul: `${LAYANAN} › ${nama}`,
    instansi: 'Disdukcapil Contoh',
  },
  verifiedAt: '2026-11-08T00:00:00.000Z',
  kodeWilayah: '9901',
  layanan: 'adminduk',
});
const SP = [
  bagian(0, 'persyaratan', 'Persyaratan: 1. Penduduk melampirkan KTP-el rusak (jika KTP-el rusak).'),
  bagian(
    1,
    'sistem, mekanisme, dan prosedur',
    'Prosedur: pemohon mengisi formulir F-1.02 lalu menyerahkan berkas.',
  ),
  bagian(2, 'jangka waktu', 'Jangka Waktu: 1 hari.'),
  bagian(3, 'biaya', 'Biaya: Gratis.'),
  bagian(4, 'produk pelayanan', 'Produk Pelayanan: KTP-el'),
  bagian(5, 'dasar hukum', 'Dasar Hukum: UU 24/2013 tentang Administrasi Kependudukan; KTP-el.'),
];

describe('bagian standar pelayanan: persyaratan dan prosedur didahulukan', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb();
    upsertChunks(db, SP);
  });

  it('bagianPrior: hanya bagian pelengkap yang tidak ditanyakan yang diturunkan', () => {
    expect(bagianPrior(`${LAYANAN} › biaya`, 'ganti KTP rusak')).toBe(BAGIAN_PRIOR);
    expect(bagianPrior(`${LAYANAN} › biaya`, 'berapa biaya ganti KTP')).toBe(1);
    expect(bagianPrior(`${LAYANAN} › jangka waktu`, 'KTP lama saya rusak')).toBe(BAGIAN_PRIOR);
    expect(bagianPrior(`${LAYANAN} › persyaratan`, 'ganti KTP rusak')).toBe(1);
    expect(bagianPrior('Klampid - Pengajuan KTP Karena Chip Rusak', 'ganti KTP rusak')).toBe(1);
  });

  it('kueri ganti KTP rusak mengembalikan persyaratan dan prosedur di urutan teratas', async () => {
    for (const query of ['cara ganti KTP rusak', 'penggantian KTP-el rusak']) {
      const r = await retrieve(db, { query, kodeKabKota: '9901', k: 2 }, DEFAULT_PIPELINE, DEPS);
      expect(r.alasan).toBeUndefined();
      expect(r.hits.map((h) => h.id).sort()).toEqual(['contoh-ktp-el#0', 'contoh-ktp-el#1']);
    }
  });

  it('bagian pelengkap tetap teratas bila memang ditanyakan', async () => {
    const r = await retrieve(
      db,
      { query: 'berapa biaya ganti KTP-el rusak', kodeKabKota: '9901', k: 1 },
      DEFAULT_PIPELINE,
      DEPS,
    );
    expect(r.hits[0]?.id).toBe('contoh-ktp-el#3');
  });
});
