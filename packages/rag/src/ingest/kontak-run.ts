import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { kontakFile, probeKontak, type KabKota, type Kontak, type ProbeDeps } from './kontak.js';

export type KontakRunOpts = {
  wilayahPath: string;
  outPath: string;
  only?: string | undefined;
  refresh?: boolean | undefined;
  /** Hanya periksa ulang entri `belum_terverifikasi` (yang terverifikasi dipertahankan). */
  belum?: boolean | undefined;
  limit?: number | undefined;
  deps: ProbeDeps;
  log: (line: string) => void;
};

/** Isi berkas kontak; entri yang sudah ada dilewati kecuali `refresh`. Disimpan tiap 10 entri dan di akhir. */
export async function runKontak(o: KontakRunOpts): Promise<number> {
  const wilayah = (JSON.parse(readFileSync(o.wilayahPath, 'utf8')) as { kabkota: KabKota[] }).kabkota;
  let prev: Kontak[] = [];
  try {
    prev = (JSON.parse(readFileSync(o.outPath, 'utf8')) as { kontak: Kontak[] }).kontak;
  } catch {
    /* berkas belum ada */
  }
  const byKode = new Map(prev.map((k) => [k.kode, k]));
  let n = 0;
  const save = (): void => {
    const file = kontakFile(wilayah, byKode);
    mkdirSync(dirname(o.outPath), { recursive: true });
    writeFileSync(o.outPath, JSON.stringify(file, null, 2) + '\n');
    o.log(`${file.terverifikasi}/${file.total} terverifikasi (diproses ${n})`);
  };
  const todo = wilayah.filter((k) => !o.only || k.kode.startsWith(o.only)).slice(0, o.limit);
  for (const k of todo) {
    const lama = byKode.get(k.kode);
    if (lama && !o.refresh && !(o.belum && lama.status === 'belum_terverifikasi')) continue;
    byKode.set(k.kode, await probeKontak(k, o.deps));
    n++;
    if (n % 10 === 0) save();
  }
  save();
  return n;
}
