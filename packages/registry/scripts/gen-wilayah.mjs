#!/usr/bin/env node
// Bangkitkan src/wilayah-data.ts dari data/wilayah/kabkota.json (514 kab/kota Kepmendagri) dan
// data/wilayah/kontak-dukcapil.json (hanya kontak terverifikasi). Data ditanam sebagai modul TS supaya ikut
// ter-build ke dist: image produksi (pnpm deploy) tidak membawa folder data/ di akar repo.
// Jalankan ulang setiap kali kedua berkas JSON berubah: `pnpm --filter @urusin/registry gen:wilayah`.
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../../../data/wilayah/', import.meta.url);
const kabkota = JSON.parse(readFileSync(new URL('kabkota.json', root), 'utf8'));
const kontak = JSON.parse(readFileSync(new URL('kontak-dukcapil.json', root), 'utf8'));

const json = (v) => JSON.stringify(v);
const provinsi = kabkota.provinsi.map((p) => `  [${json(p.kode)}, ${json(p.nama)}],`);
const kab = kabkota.kabkota.map((k) => `  [${json(k.kode)}, ${json(k.nama)}],`);
const kon = kontak.kontak
  .filter((k) => k.status === 'terverifikasi')
  .map((k) => {
    const o = { kode: k.kode, website: k.website, sourceUrl: k.sourceUrl, verifiedAt: k.verifiedAt };
    if (k.alamat) o.alamat = k.alamat;
    return `  ${json(o)},`;
  });

const out = `// BERKAS HASIL GENERATOR (packages/registry/scripts/gen-wilayah.mjs). Jangan diubah tangan.
// Sumber: data/wilayah/kabkota.json dan data/wilayah/kontak-dukcapil.json (status terverifikasi saja).

/** [kode 2 digit, nama provinsi] */
export const DATA_PROVINSI: readonly (readonly [string, string])[] = [
${provinsi.join('\n')}
];

/** [kode 4 digit, nama resmi kab/kota] — ${kabkota.kabkota.length} entri. */
export const DATA_KABKOTA: readonly (readonly [string, string])[] = [
${kab.join('\n')}
];

/** Situs Disdukcapil yang lolos verifikasi otomatis (.go.id, menyebut kependudukan dan nama wilayah). */
export const DATA_KONTAK_DUKCAPIL: readonly {
  kode: string;
  website: string;
  sourceUrl: string;
  verifiedAt: string;
  alamat?: string;
}[] = [
${kon.join('\n')}
];
`;
writeFileSync(new URL('../src/wilayah-data.ts', import.meta.url), out);
console.log(`wilayah-data.ts: ${kab.length} kab/kota, ${kon.length} kontak terverifikasi`);
