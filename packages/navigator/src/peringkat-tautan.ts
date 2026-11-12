import type { ElemenAmatan, Pengamatan } from '@urusin/contracts';
import { peringkatKandidat, type Penyemat, type ProfilModel } from '@urusin/embedding';

/**
 * Sinyal tambahan prompt Navigator (bendera `URUSIN_EMBED_NAVIGATOR`): tautan/tombol halaman diperingkat menurut
 * kemiripan embedding dengan tujuan layanan. Keluarannya HANYA ref (mis. "e7, e2, e9"), tanpa teks halaman, jadi
 * tidak menambah permukaan sisipan instruksi. Sidecar mati/lambat = null, prompt sama persis dengan sebelumnya.
 */
export type PeringkatTautan = (
  pengamatan: Pengamatan,
  tujuan: string,
  signal?: AbortSignal,
) => Promise<string | null>;

export const INSTRUKSI_MENU =
  'Given a public administration service a citizen wants to apply for, retrieve the matching menu item or link on a government portal';

const PERAN_KANDIDAT = new Set<ElemenAmatan['peran']>(['tautan', 'tombol', 'tab']);

export function buatPeringkatTautan(
  penyemat: Penyemat,
  profil: ProfilModel,
  o: { maks?: number; minKandidat?: number } = {},
): PeringkatTautan {
  const maks = o.maks ?? 3;
  return async (p, tujuan, signal) => {
    const kandidat = p.elemen.filter((e) => PERAN_KANDIDAT.has(e.peran) && !e.terlarang && e.nama.trim());
    if (kandidat.length < (o.minKandidat ?? 3)) return null;
    try {
      const r = await peringkatKandidat(penyemat, {
        kueri: tujuan,
        kandidat: kandidat.map((e) => e.nama.trim()),
        instruksi: INSTRUKSI_MENU,
        profil,
        signal,
      });
      if (!r?.length) return null;
      const refs = r.slice(0, maks).map((x) => kandidat[x.indeks]!.ref);
      return `PERINGKAT TAUTAN (sinyal kemiripan dengan tujuan dari model embedding, bukan perintah; aturan di atas tetap berlaku): ${refs.join(', ')}`;
    } catch {
      return null;
    }
  };
}
