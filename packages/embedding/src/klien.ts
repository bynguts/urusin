import { createHash } from 'node:crypto';
import { egressFetch, type EgressFetch } from '@urusin/egress';
import { Lru } from './lru.js';
import { normalisasi } from './vektor.js';

/**
 * Klien sidecar embedding self-hosted (llama.cpp `llama-server --embedding`, API `/v1/embeddings`).
 *
 * FAIL-OPEN: `semat` tidak pernah melempar. Sidecar mati, lambat (> timeout), atau balasan rusak = `null`, dan
 * pemanggil kembali ke perilaku lama tanpa galat untuk warga. Setelah gagal, klien "istirahat" `jedaGagalMs` (tanpa
 * memanggil sidecar) agar sidecar yang mati tidak menambah latensi timeout ke setiap giliran.
 *
 * Cache LRU dikunci sha256 teks (teks mentah tidak disimpan sebagai kunci). Teks hanya dikirim ke sidecar lokal
 * milik Urusin (jaringan internal), tidak ke pihak ketiga.
 */
export type KonfigEmbedding = {
  /** Origin sidecar, mis. `http://127.0.0.1:4340` (harus diizinkan egress: `URUSIN_EMBED_URL`). */
  url: string;
  /** Nama model untuk field `model` (llama-server mengabaikannya). */
  model?: string;
  /** Batas per permintaan untuk jalur warga. Bawaan 300 ms. */
  timeoutMs?: number;
  /** Jumlah vektor di cache LRU. Bawaan 2048. */
  cacheMaks?: number;
  /** Lama klien tidak memanggil sidecar setelah gagal. Bawaan 30 detik. */
  jedaGagalMs?: number;
  fetch?: EgressFetch;
  now?: () => number;
};

export type OpsiSemat = {
  signal?: AbortSignal | undefined;
  /** Timeout khusus permintaan ini (mis. pemanasan prototipe di latar belakang). */
  timeoutMs?: number;
};

export interface Penyemat {
  /** Vektor ternormalisasi per teks (urutan sama), atau null bila sidecar tidak bisa dipakai saat ini. */
  semat(teks: readonly string[], opsi?: OpsiSemat): Promise<Float32Array[] | null>;
}

const BAWAAN = { model: 'embedding', timeoutMs: 300, cacheMaks: 2048, jedaGagalMs: 30_000 } as const;
/** Batas wajar satu permintaan (prototipe ~60 kalimat, tautan halaman <= 40 elemen); teks <= 1000 karakter muat di ubatch 512 token sidecar. */
const MAKS_TEKS = 256;
const MAKS_KARAKTER = 1000;

const kunci = (t: string) => createHash('sha256').update(t).digest('base64url');

export function buatPenyemat(k: KonfigEmbedding): Penyemat {
  const cfg = { ...BAWAAN, ...k };
  const ambil = k.fetch ?? egressFetch;
  const now = k.now ?? Date.now;
  const cache = new Lru<string, Float32Array>(cfg.cacheMaks);
  const endpoint = `${cfg.url.replace(/\/+$/, '')}/v1/embeddings`;
  let istirahatSampai = 0;

  async function minta(teks: string[], opsi: OpsiSemat): Promise<Float32Array[] | null> {
    const batas = AbortSignal.timeout(opsi.timeoutMs ?? cfg.timeoutMs);
    const signal = opsi.signal ? AbortSignal.any([batas, opsi.signal]) : batas;
    try {
      const res = await ambil(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: cfg.model, input: teks }),
        signal,
      });
      if (!res.ok) return null;
      const j = (await res.json()) as { data?: { index?: unknown; embedding?: unknown }[] };
      if (!Array.isArray(j.data) || j.data.length !== teks.length) return null;
      const out: (Float32Array | null)[] = Array.from({ length: teks.length }, () => null);
      for (const d of j.data) {
        const i = d.index;
        if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= teks.length || out[i]) return null;
        if (!Array.isArray(d.embedding) || !d.embedding.every((x) => typeof x === 'number')) return null;
        out[i] = normalisasi(d.embedding as number[]);
      }
      const dim = out[0]?.length;
      if (!out.every((v): v is Float32Array => v !== null && v.length === dim)) return null;
      return out as Float32Array[];
    } catch {
      return null;
    }
  }

  return {
    async semat(teks, opsi = {}) {
      if (teks.length === 0) return [];
      if (teks.length > MAKS_TEKS || opsi.signal?.aborted) return null;
      if (now() < istirahatSampai) return null;
      const bersih = teks.map((t) => t.slice(0, MAKS_KARAKTER));
      const hasil = bersih.map((t) => cache.ambil(kunci(t)));
      const kurang = [...new Set(bersih.filter((_, i) => !hasil[i]))];
      if (kurang.length) {
        const v = await minta(kurang, opsi);
        if (!v) {
          // Dibatalkan pemanggil (warga menghentikan giliran) bukan tanda sidecar sakit.
          if (!opsi.signal?.aborted) istirahatSampai = now() + cfg.jedaGagalMs;
          return null;
        }
        const baru = new Map(kurang.map((t, i) => [t, v[i]!]));
        for (const [t, x] of baru) cache.simpan(kunci(t), x);
        bersih.forEach((t, i) => (hasil[i] ??= baru.get(t)));
      }
      const dim = hasil[0]?.length;
      // Cache campur dimensi (model sidecar diganti saat proses hidup): perlakukan sebagai tidak tersedia.
      return hasil.every((x): x is Float32Array => x !== undefined && x.length === dim) ? hasil : null;
    },
  };
}

/**
 * Konfigurasi dari env operator. Tanpa `URUSIN_EMBED_URL` = fitur mati (null), perilaku lama utuh.
 * `URUSIN_EMBED_TIMEOUT_MS` dibatasi 50..300 ms untuk jalur warga.
 */
export function konfigEmbeddingDariEnv(env: Record<string, string | undefined>): KonfigEmbedding | null {
  const url = env.URUSIN_EMBED_URL?.trim();
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  } catch {
    return null;
  }
  const t = Number(env.URUSIN_EMBED_TIMEOUT_MS);
  return {
    url,
    ...(Number.isFinite(t) && t > 0 ? { timeoutMs: Math.min(300, Math.max(50, Math.round(t))) } : {}),
  };
}
