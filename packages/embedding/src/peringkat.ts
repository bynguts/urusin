import type { Penyemat } from './klien.js';
import type { ProfilModel } from './profil.js';
import { kosinus } from './vektor.js';

export type Peringkat = { indeks: number; skor: number };

/**
 * Urutkan kandidat (label menu/tautan) menurut kemiripan dengan kueri (tujuan layanan), menurun. null bila sidecar
 * tidak tersedia. Satu permintaan untuk kueri + semua kandidat (label yang sama di halaman lain kena cache).
 */
export async function peringkatKandidat(
  penyemat: Penyemat,
  o: {
    kueri: string;
    kandidat: readonly string[];
    instruksi: string;
    profil: ProfilModel;
    signal?: AbortSignal | undefined;
  },
): Promise<Peringkat[] | null> {
  if (o.kandidat.length === 0) return [];
  const v = await penyemat.semat(
    [o.profil.kueri(o.instruksi, o.kueri), ...o.kandidat.map((k) => o.profil.dokumen(k))],
    { signal: o.signal },
  );
  if (!v) return null;
  const [q, ...d] = v;
  return d.map((x, indeks) => ({ indeks, skor: kosinus(q!, x) })).sort((a, b) => b.skor - a.skor);
}
