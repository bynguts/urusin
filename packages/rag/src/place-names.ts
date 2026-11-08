import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stemTokens } from './stem/stem.js';

/** `data/wilayah/kabkota.json` di akar repo; src/ dan dist/ sama dalamnya. */
const PATH = new URL('../../../data/wilayah/kabkota.json', import.meta.url);

let cached: ReadonlySet<string> | undefined;

/**
 * Token (ter-stem) nama provinsi/kab/kota. Nama tempat di kueri ("... ke Surabaya") bukan penanda
 * di luar cakupan, jadi tidak dihitung saat menilai cakupan. Kosong bila berkas tidak ada.
 */
export function placeTokens(): ReadonlySet<string> {
  if (!cached) {
    try {
      const j = JSON.parse(readFileSync(fileURLToPath(PATH), 'utf8')) as {
        provinsi?: { nama: string }[];
        kabkota?: { nama: string }[];
      };
      const names = [...(j.provinsi ?? []), ...(j.kabkota ?? [])].map((x) => x.nama);
      cached = new Set(stemTokens(names.join(' ')));
    } catch {
      cached = new Set();
    }
  }
  return cached;
}
