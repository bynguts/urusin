/**
 * Pemutus sirkuit sederhana untuk panggilan penyedia: setelah `threshold` kegagalan beruntun, panggilan
 * berikutnya langsung gagal (tanpa menunggu timeout) selama `cooldownMs`, lalu satu percobaan dilepas.
 * Pemanggil (leg vektor, rerank) menangkap galat dan jatuh ke BM25 / urutan fusi.
 */
export class BreakerOpenError extends Error {
  constructor() {
    super('pemutus sirkuit terbuka: penyedia dilewati sementara');
    this.name = 'BreakerOpenError';
  }
}

export type Breaker = { run<T>(fn: () => Promise<T>): Promise<T>; readonly isOpen: boolean };

export function createBreaker(
  opts: { threshold?: number; cooldownMs?: number; now?: () => number } = {},
): Breaker {
  const threshold = opts.threshold ?? 3;
  const cooldownMs = opts.cooldownMs ?? 30_000;
  const now = opts.now ?? (() => Date.now());
  let failures = 0;
  let openedAt: number | null = null;
  return {
    get isOpen() {
      return openedAt !== null && now() - openedAt < cooldownMs;
    },
    async run<T>(fn: () => Promise<T>): Promise<T> {
      if (openedAt !== null) {
        if (now() - openedAt < cooldownMs) throw new BreakerOpenError();
        openedAt = null; // setengah terbuka: satu percobaan
        failures = threshold - 1;
      }
      try {
        const out = await fn();
        failures = 0;
        return out;
      } catch (e) {
        if (++failures >= threshold) openedAt = now();
        throw e;
      }
    },
  };
}

/** Harga USD per juta token dari env (mis. RERANK_PRICE_PER_MTOK); 0 bila tidak diset/tak valid. */
export function priceFromEnv(env: Record<string, string | undefined>, name: string): number {
  const v = Number(env[name]);
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

/** Biaya USD untuk sejumlah token. */
export const costUsd = (tokens: number, pricePerMTok: number): number => (tokens / 1_000_000) * pricePerMTok;
