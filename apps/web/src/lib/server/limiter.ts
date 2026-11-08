/**
 * Pembatas laju jendela-tetap di memori (satu proses). Jumlah kunci dibatasi: saat penuh, jendela yang sudah
 * lewat dibuang dulu; bila masih penuh, kunci baru ditolak (gagal-tertutup lebih aman daripada tumbuh tanpa batas).
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private readonly maxKeys = 50_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Catat satu permintaan. `ok=false` bila melewati batas; `retryAfterSec` untuk header Retry-After. */
  consume(key: string): { ok: boolean; retryAfterSec: number } {
    const t = this.now();
    let e = this.hits.get(key);
    if (!e || e.resetAt <= t) {
      if (!e && this.hits.size >= this.maxKeys) {
        this.sweep(t);
        if (this.hits.size >= this.maxKeys)
          return { ok: false, retryAfterSec: Math.ceil(this.windowMs / 1000) };
      }
      e = { count: 0, resetAt: t + this.windowMs };
      this.hits.set(key, e);
    }
    e.count++;
    return { ok: e.count <= this.limit, retryAfterSec: Math.max(1, Math.ceil((e.resetAt - t) / 1000)) };
  }

  private sweep(t: number): void {
    for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k);
  }
}
