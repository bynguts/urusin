import { describe, expect, it } from 'vitest';
import { chunkByHeading } from './chunk.js';
import { buildChunkContextHeader } from './context.js';

describe('buildChunkContextHeader', () => {
  it('judul › bagian › instansi › wilayah › layanan', () => {
    expect(
      buildChunkContextHeader({
        judulHalaman: 'Layanan Disdukcapil',
        heading: 'Persyaratan',
        instansi: 'Dinas Kependudukan Kota Surabaya',
        wilayah: 'Kota Surabaya',
        layanan: 'adminduk',
      }),
    ).toBe('Layanan Disdukcapil › Persyaratan › Dinas Kependudukan Kota Surabaya › Kota Surabaya › adminduk');
  });
  it('bagian kosong dan duplikat dibuang', () => {
    expect(
      buildChunkContextHeader({ judulHalaman: 'A', heading: 'a', instansi: ' B ', layanan: undefined }),
    ).toBe('A › B');
  });
  it('dibatasi 500 karakter', () => {
    expect(buildChunkContextHeader({ judulHalaman: 'x'.repeat(900), instansi: 'y' }).length).toBe(500);
  });
});

describe('chunkByHeading: sadar struktur', () => {
  const doc = [
    '# Akta Kelahiran',
    'Layanan pencatatan kelahiran.',
    'Persyaratan:',
    '- Surat keterangan lahir',
    '- KK orang tua',
    'Prosedur',
    '1. Datang ke kantor',
    '2. Serahkan berkas',
    'Biaya: ',
    'Gratis',
    'Dasar Hukum',
    'UU 24/2013',
  ].join('\n');
  it('memecah per blok syarat / prosedur / biaya / dasar hukum di dalam heading', () => {
    const cs = chunkByHeading(doc);
    expect(cs.map((c) => c.heading)).toEqual([
      'Akta Kelahiran',
      'Akta Kelahiran › persyaratan',
      'Akta Kelahiran › prosedur',
      'Akta Kelahiran › biaya',
      'Akta Kelahiran › dasar hukum',
    ]);
    expect(cs[1]!.text).toContain('KK orang tua');
    expect(cs[1]!.text).not.toContain('Datang ke kantor');
  });
  it('kalimat biasa yang kebetulan memuat kata "waktu" tidak dipecah', () => {
    const cs = chunkByHeading('# A\nPelayanan selesai dalam waktu tiga hari kerja.\nBerkas dibawa langsung.');
    expect(cs).toHaveLength(1);
  });
  it('daftar tidak terpotong di tengah bila masih muat dalam 2x batas', () => {
    const items = Array.from({ length: 10 }, (_, i) => `- butir ${i} ${'x'.repeat(40)}`).join('\n');
    const cs = chunkByHeading(`# Syarat\n${items}`, 300);
    expect(cs).toHaveLength(1);
  });
});
