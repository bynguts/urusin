/** Vektor ternormalisasi L2 (float32). Vektor nol atau berisi non-finite = tidak sah (null). */
export function normalisasi(v: readonly number[]): Float32Array | null {
  let n = 0;
  for (const x of v) {
    if (!Number.isFinite(x)) return null;
    n += x * x;
  }
  if (n === 0) return null;
  const s = 1 / Math.sqrt(n);
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i]! * s;
  return out;
}

/** Kosinus dua vektor ternormalisasi (= hasil kali titik). Dimensi beda = galat pemrograman. */
export function kosinus(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new RangeError(`dimensi beda: ${a.length} vs ${b.length}`);
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}
