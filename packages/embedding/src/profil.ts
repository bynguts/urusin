/**
 * Awalan kueri/dokumen sesuai kartu model. Sidecar hanya menyematkan teks apa adanya; awalan dipasang di sisi klien
 * dan HARUS cocok dengan model yang dibakar ke image (deploy/embedding/Dockerfile). Ganti model = ganti profil
 * dan ukur ulang ambang (packages/embedding/eval).
 */
export type ProfilModel = {
  nama: string;
  kueri: (instruksi: string, teks: string) => string;
  dokumen: (teks: string) => string;
};

export const PROFIL_MODEL = {
  /** microsoft/harrier-oss-v1-* (Qwen3/Gemma3, pooling token terakhir). */
  harrier: {
    nama: 'harrier',
    kueri: (i, t) => `Instruct: ${i}\nQuery: ${t}`,
    dokumen: (t) => t,
  },
  /** Qwen/Qwen3-Embedding-*. */
  qwen3: {
    nama: 'qwen3',
    kueri: (i, t) => `Instruct: ${i}\nQuery:${t}`,
    dokumen: (t) => t,
  },
  /** google/embeddinggemma-300m. */
  gemma: {
    nama: 'gemma',
    kueri: (_i, t) => `task: search result | query: ${t}`,
    dokumen: (t) => `title: none | text: ${t}`,
  },
} as const satisfies Record<string, ProfilModel>;

export type NamaProfil = keyof typeof PROFIL_MODEL;

/** Profil model yang dibakar ke image sidecar produksi (pemenang bake-off, packages/embedding/eval/HASIL.md). */
export const PROFIL_PRODUKSI: NamaProfil = 'gemma';

export function profilModel(nama: string | undefined): ProfilModel {
  return nama && Object.hasOwn(PROFIL_MODEL, nama)
    ? PROFIL_MODEL[nama as NamaProfil]
    : PROFIL_MODEL[PROFIL_PRODUKSI];
}
