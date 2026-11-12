import {
  buatPenyemat,
  konfigEmbeddingDariEnv,
  profilModel,
  type Penyemat,
  type ProfilModel,
} from '@urusin/embedding';
import { buatKlasifikasiIntent, type KlasifikasiIntentEmbedding } from '@urusin/harness';

/**
 * Sidecar embedding self-hosted (deploy/compose.prod.yml layanan `embedding`). Fitur MATI tanpa `URUSIN_EMBED_URL`;
 * hidup pun fail-open: sidecar mati/lambat = perilaku lama (kata kunci lalu LLM, prompt Navigator tanpa peringkat).
 * Lalu lintas lewat @urusin/egress (origin persis `URUSIN_EMBED_URL` diizinkan sebagai origin internal).
 */
export type Embedding = { penyemat: Penyemat; profil: ProfilModel };

export function embeddingDariEnv(env: Record<string, string | undefined>): Embedding | null {
  const k = konfigEmbeddingDariEnv(env);
  if (!k) return null;
  return { penyemat: buatPenyemat(k), profil: profilModel(env.URUSIN_EMBED_PROFIL) };
}

/** Jalur cepat intent; prototipe dipanaskan di latar belakang sejak boot (tanpa menunggu). */
export function intentEmbedding(e: Embedding | null): KlasifikasiIntentEmbedding | undefined {
  if (!e) return undefined;
  const k = buatKlasifikasiIntent(e.penyemat, { profil: e.profil });
  void k.panaskan();
  return k;
}

/** Peringkat tautan Navigator: hanya bila `URUSIN_EMBED_NAVIGATOR=1` (bendera, mati bawaan). */
export function navigatorEmbeddingAktif(env: Record<string, string | undefined>): boolean {
  return env.URUSIN_EMBED_NAVIGATOR?.trim() === '1';
}
