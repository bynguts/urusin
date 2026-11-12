import type { Penyemat } from './klien.js';
import type { ProfilModel } from './profil.js';
import { kosinus } from './vektor.js';

export type Ambang = {
  /** Kosinus minimum ke prototipe terdekat. */
  skor: number;
  /** Selisih minimum skor label teratas dan label kedua. */
  margin: number;
};

export type HasilKlasifikasi<K extends string> = { label: K; skor: number; margin: number };

export type KlasifikasiPrototipe<K extends string> = {
  /**
   * Label dengan prototipe terdekat bila YAKIN (skor >= ambang.skor DAN margin >= ambang.margin); selain itu null.
   * null juga saat sidecar tidak tersedia atau prototipe belum siap. Tidak pernah melempar.
   */
  klasifikasi(teks: string, signal?: AbortSignal): Promise<HasilKlasifikasi<K> | null>;
  /** Skor mentah per label (urut menurun) tanpa ambang; null bila tidak tersedia. Untuk eval/diagnostik. */
  skor(teks: string, signal?: AbortSignal): Promise<[K, number][] | null>;
  /** Vektorkan prototipe (sekali per proses). true bila siap. */
  panaskan(): Promise<boolean>;
};

/**
 * Klasifikasi tetangga terdekat ke kalimat prototipe: skor label = kosinus maksimum ke prototipe label itu.
 * Prototipe divektorkan di latar belakang dengan timeout longgar; selama belum siap, `klasifikasi` = null (pemanggil
 * memakai jalur lama) dan tidak menunggu.
 */
export function buatKlasifikasiPrototipe<K extends string>(
  penyemat: Penyemat,
  o: {
    prototipe: Readonly<Partial<Record<K, readonly string[]>>>;
    instruksi: string;
    profil: ProfilModel;
    ambang: Ambang;
    /** Timeout pemanasan prototipe (latar belakang). Bawaan 30 detik (CPU ARM, ~60 kalimat). */
    timeoutPemanasanMs?: number;
  },
): KlasifikasiPrototipe<K> {
  const baris = (Object.entries(o.prototipe) as [K, readonly string[]][]).flatMap(([label, xs]) =>
    xs.map((t) => ({ label, t })),
  );
  let siap: { label: K; v: Float32Array }[] | null = null;
  let berjalan: Promise<boolean> | null = null;

  function panaskan(): Promise<boolean> {
    if (siap) return Promise.resolve(true);
    berjalan ??= penyemat
      .semat(
        baris.map((b) => o.profil.dokumen(b.t)),
        { timeoutMs: o.timeoutPemanasanMs ?? 30_000 },
      )
      .then((v) => {
        if (v) siap = baris.map((b, i) => ({ label: b.label, v: v[i]! }));
        return !!v;
      })
      // Penyemat seharusnya tidak melempar; tetap dijaga agar pemanasan latar belakang tidak jadi rejection liar.
      .catch(() => false)
      .finally(() => {
        berjalan = null;
      });
    return berjalan;
  }

  async function skor(teks: string, signal?: AbortSignal): Promise<[K, number][] | null> {
    if (!siap) {
      void panaskan();
      return null;
    }
    const proto = siap;
    const v = (await penyemat.semat([o.profil.kueri(o.instruksi, teks)], { signal }))?.[0];
    if (!v || v.length !== proto[0]?.v.length) return null;
    const terbaik = new Map<K, number>();
    for (const p of proto) terbaik.set(p.label, Math.max(terbaik.get(p.label) ?? -1, kosinus(v, p.v)));
    return [...terbaik.entries()].sort((a, b) => b[1] - a[1]);
  }

  return {
    panaskan,
    skor,
    async klasifikasi(teks, signal) {
      const s = await skor(teks, signal);
      const [satu, dua] = s ?? [];
      if (!satu) return null;
      const margin = satu[1] - (dua?.[1] ?? -1);
      if (satu[1] < o.ambang.skor || margin < o.ambang.margin) return null;
      return { label: satu[0], skor: satu[1], margin };
    },
  };
}
