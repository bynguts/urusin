#!/usr/bin/env node
// Bandingkan dua hasil eval persona per persona per kriteria.
//   node scripts/eval-persona/banding.mjs hasil/baseline/bawaan/skor.json,hasil/baseline/bawaan-tambahan/skor.json \
//     hasil/baseline/wilayah-dulu/skor.json
import { readFileSync } from 'node:fs';
import { KRITERIA } from './lib/juri.mjs';
import { bandingkan, tabelBanding } from './lib/banding.mjs';

const [a, b] = process.argv.slice(2);
if (!a || !b) {
  console.error(
    'pakai: node scripts/eval-persona/banding.mjs <sebelum/skor.json[,...]> <sesudah/skor.json[,...]>',
  );
  process.exit(2);
}
// Satu sisi boleh gabungan beberapa skor.json dipisah koma (mis. baseline + persona tambahan).
const baca = (daftar) => ({
  hasil: daftar.split(',').flatMap((f) => JSON.parse(readFileSync(f, 'utf8')).hasil),
});
const kriteria = Object.keys(KRITERIA);
console.log(tabelBanding(bandingkan(baca(a), baca(b), kriteria), kriteria));
