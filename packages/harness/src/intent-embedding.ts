import {
  buatKlasifikasiPrototipe,
  PROFIL_MODEL,
  PROFIL_PRODUKSI,
  type Ambang,
  type Penyemat,
  type ProfilModel,
} from '@urusin/embedding';
import type { IntentJenis } from './intent.js';
import { INSTRUKSI_INTENT, PROTOTIPE_INTENT } from './intent-prototipe.js';

/**
 * Jalur cepat intent lewat embedding self-hosted: dipakai HANYA bila `klasifikasiKataKunci` tidak menemukan satu
 * jenis. Yakin = jenis diambil tanpa round-trip LLM (7-10 detik di proxy produksi); tidak yakin, sidecar mati,
 * atau lambat = null dan klasifikasi tetap ke LLM seperti sebelumnya (fail-open).
 */
export type KlasifikasiIntentEmbedding = {
  klasifikasi(teks: string, signal?: AbortSignal): Promise<IntentJenis | null>;
  /** Vektorkan prototipe sekarang (dipanggil saat boot agar giliran pertama sudah bisa memakai jalur cepat). */
  panaskan(): Promise<boolean>;
};

/**
 * Ambang ketat dari bake-off (packages/embedding/eval/HASIL.md): dipilih di separuh set eval dengan target
 * presisi >= 97%, dilaporkan di separuh lainnya. Berlaku untuk model + prototipe + instruksi yang diukur saja.
 */
export const AMBANG_INTENT: Readonly<Ambang> = Object.freeze({ skor: 0.45, margin: 0.05 });

export function buatKlasifikasiIntent(
  penyemat: Penyemat,
  o: { profil?: ProfilModel; ambang?: Ambang } = {},
): KlasifikasiIntentEmbedding {
  const k = buatKlasifikasiPrototipe<IntentJenis>(penyemat, {
    prototipe: PROTOTIPE_INTENT,
    instruksi: INSTRUKSI_INTENT,
    profil: o.profil ?? PROFIL_MODEL[PROFIL_PRODUKSI],
    ambang: o.ambang ?? AMBANG_INTENT,
  });
  return {
    panaskan: () => k.panaskan(),
    async klasifikasi(teks, signal) {
      try {
        return (await k.klasifikasi(teks, signal))?.label ?? null;
      } catch {
        return null;
      }
    },
  };
}
