#!/usr/bin/env node
// Bangkitkan src/wilayah-data.ts dari data/wilayah/kabkota.json (514 kab/kota Kepmendagri),
// data/wilayah/kontak-dukcapil.json (hanya kontak terverifikasi), dan data/wilayah/kanal-layanan.json (kontak
// layanan resmi). Data ditanam sebagai modul TS supaya ikut
// ter-build ke dist: image produksi (pnpm deploy) tidak membawa folder data/ di akar repo.
// Jalankan ulang setiap kali berkas JSON itu berubah: `pnpm --filter @urusin/registry gen:wilayah`.
//   node packages/registry/scripts/gen-wilayah.mjs --check   # gagal (exit 1) bila wilayah-data.ts menyimpang dari
//                                                           # keluaran generator (mis. disunting tangan); dipakai CI.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';

const root = new URL('../../../data/wilayah/', import.meta.url);
const target = new URL('../src/wilayah-data.ts', import.meta.url);
const kabkota = JSON.parse(readFileSync(new URL('kabkota.json', root), 'utf8'));
const kontak = JSON.parse(readFileSync(new URL('kontak-dukcapil.json', root), 'utf8'));
const kanal = JSON.parse(readFileSync(new URL('kanal-layanan.json', root), 'utf8'));

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

const kan = kanal.entri.map((e) => `  ${json(e)},`);

const out = `// BERKAS HASIL GENERATOR (packages/registry/scripts/gen-wilayah.mjs). Jangan diubah tangan.
// Sumber: data/wilayah/kabkota.json, data/wilayah/kontak-dukcapil.json (status terverifikasi saja),
// dan data/wilayah/kanal-layanan.json (kontak layanan resmi beserta URL sumber dan tanggal cek).

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

/** Kontak layanan resmi per kab/kota; tiap nilai membawa halaman sumber .go.id dan tanggal cek. */
export const DATA_KANAL_LAYANAN: readonly {
  kode: string;
  layanan: 'adminduk' | 'skck';
  instansi: string;
  jenis: 'telepon' | 'whatsapp' | 'email' | 'jam_layanan' | 'layanan_online';
  nilai: string;
  url?: string;
  sumberUrl: string;
  dicekPada: string;
}[] = [
${kan.join('\n')}
];
`;
const targetPath = fileURLToPath(target);
const teks = await prettier.format(out, {
  ...(await prettier.resolveConfig(targetPath)),
  filepath: targetPath,
});

if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== teks) {
    console.error(
      'wilayah-data.ts menyimpang dari keluaran generator. Jangan sunting tangan; ubah JSON di data/wilayah lalu ' +
        'jalankan `pnpm --filter @urusin/registry gen:wilayah`.',
    );
    process.exit(1);
  }
  console.log('wilayah-data.ts identik dengan keluaran generator');
} else {
  writeFileSync(target, teks);
  console.log(
    `wilayah-data.ts: ${kab.length} kab/kota, ${kon.length} kontak terverifikasi, ${kan.length} kontak layanan`,
  );
}
