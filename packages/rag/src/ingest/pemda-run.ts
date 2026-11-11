import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ProbeDeps } from './kontak.js';
import { pemdaFile, probePemda, type Pemda, type WilayahPemda } from './pemda.js';

export type PemdaRunOpts = {
  wilayahPath: string;
  kontakPath: string;
  outPath: string;
  only?: string | undefined;
  refresh?: boolean | undefined;
  /** Hanya periksa ulang entri `belum_terverifikasi` (mis. situs yang tadi lambat atau sedang turun). */
  belum?: boolean | undefined;
  deps: ProbeDeps;
  log: (line: string) => void;
};

type KabKotaFile = {
  provinsi: { kode: string; nama: string }[];
  kabkota: { kode: string; jenis: 'kabupaten' | 'kota'; nama: string }[];
};

/**
 * Isi berkas pemda: semua provinsi, dan kab/kota yang situs Disdukcapil-nya belum terverifikasi (yang sudah punya
 * situs Disdukcapil tidak butuh cadangan). Entri yang sudah ada dilewati kecuali `refresh`; disimpan tiap 10 entri.
 */
export async function runPemda(o: PemdaRunOpts): Promise<number> {
  const data = JSON.parse(readFileSync(o.wilayahPath, 'utf8')) as KabKotaFile;
  const kontak = (
    JSON.parse(readFileSync(o.kontakPath, 'utf8')) as { kontak: { kode: string; status: string }[] }
  ).kontak;
  const adaDukcapil = new Set(kontak.filter((k) => k.status === 'terverifikasi').map((k) => k.kode));
  const wilayah: WilayahPemda[] = [
    ...data.provinsi.map((p) => ({ kode: p.kode, jenis: 'provinsi' as const, nama: p.nama })),
    ...data.kabkota.filter((k) => !adaDukcapil.has(k.kode)),
  ];
  let prev: Pemda[] = [];
  try {
    prev = (JSON.parse(readFileSync(o.outPath, 'utf8')) as { pemda: Pemda[] }).pemda;
  } catch {
    /* berkas belum ada */
  }
  const byKode = new Map(prev.map((p) => [p.kode, p]));
  let n = 0;
  const save = (): void => {
    const file = pemdaFile(wilayah, byKode);
    mkdirSync(dirname(o.outPath), { recursive: true });
    writeFileSync(o.outPath, JSON.stringify(file, null, 2) + '\n');
    o.log(`${file.terverifikasi}/${file.total} terverifikasi (diproses ${n})`);
  };
  for (const w of wilayah.filter((x) => !o.only || x.kode.startsWith(o.only))) {
    const lama = byKode.get(w.kode);
    if (lama && !o.refresh && !(o.belum && lama.status === 'belum_terverifikasi')) continue;
    byKode.set(w.kode, await probePemda(w, o.deps));
    n++;
    if (n % 10 === 0) save();
  }
  save();
  return n;
}
