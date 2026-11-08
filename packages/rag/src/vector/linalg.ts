/** Aljabar linear kecil (tanpa dependensi native) untuk transformasi vektor. Semua dalam Float64. */

/** PRNG deterministik (mulberry32) agar hasil fit dapat direproduksi. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

export function dot(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] as number) * (b[i] as number);
  return s;
}

/**
 * Eigendekomposisi matriks simetris p x p (Jacobi siklik). `a` row-major dan dirusak.
 * Mengembalikan nilai eigen turun beserta vektor eigen (vectors[i] = vektor untuk values[i]).
 */
export function symmetricEigen(
  a: Float64Array,
  p: number,
): { values: Float64Array; vectors: Float64Array[] } {
  const v = new Float64Array(p * p);
  for (let i = 0; i < p; i++) v[i * p + i] = 1;
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    let diag = 0;
    for (let i = 0; i < p; i++) {
      diag += (a[i * p + i] as number) ** 2;
      for (let j = i + 1; j < p; j++) off += (a[i * p + j] as number) ** 2;
    }
    if (off <= 1e-26 * (diag + off) || off === 0) break;
    for (let i = 0; i < p - 1; i++) {
      for (let j = i + 1; j < p; j++) {
        const apq = a[i * p + j] as number;
        if (Math.abs(apq) < 1e-300) continue;
        const theta = ((a[j * p + j] as number) - (a[i * p + i] as number)) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < p; k++) {
          const akp = a[k * p + i] as number;
          const akq = a[k * p + j] as number;
          a[k * p + i] = c * akp - s * akq;
          a[k * p + j] = s * akp + c * akq;
        }
        for (let k = 0; k < p; k++) {
          const api = a[i * p + k] as number;
          const aqj = a[j * p + k] as number;
          a[i * p + k] = c * api - s * aqj;
          a[j * p + k] = s * api + c * aqj;
        }
        for (let k = 0; k < p; k++) {
          const vki = v[k * p + i] as number;
          const vkj = v[k * p + j] as number;
          v[k * p + i] = c * vki - s * vkj;
          v[k * p + j] = s * vki + c * vkj;
        }
      }
    }
  }
  const order = Array.from({ length: p }, (_, i) => i).sort(
    (x, y) => (a[y * p + y] as number) - (a[x * p + x] as number),
  );
  const values = new Float64Array(p);
  const vectors: Float64Array[] = [];
  order.forEach((idx, r) => {
    values[r] = a[idx * p + idx] as number;
    const col = new Float64Array(p);
    for (let k = 0; k < p; k++) col[k] = v[k * p + idx] as number;
    vectors.push(col);
  });
  return { values, vectors };
}

/** Ortonormalisasi kolom (Gram-Schmidt dua lintasan). Kolom yang runtuh menjadi nol. */
export function orthonormalize(cols: Float64Array[]): void {
  for (let j = 0; j < cols.length; j++) {
    const cj = cols[j] as Float64Array;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < j; i++) {
        const ci = cols[i] as Float64Array;
        const r = dot(ci, cj);
        if (r !== 0) for (let t = 0; t < cj.length; t++) cj[t] = (cj[t] as number) - r * (ci[t] as number);
      }
    }
    const nrm = Math.sqrt(dot(cj, cj));
    if (nrm > 1e-12) for (let t = 0; t < cj.length; t++) cj[t] = (cj[t] as number) / nrm;
    else cj.fill(0);
  }
}

/**
 * SVD terpangkas acak (Halko et al.) untuk X (n x d, row-major): mengembalikan nilai singular
 * turun `s` dan vektor singular kanan `v` (tiap panjang d), ortonormal. Ritz Rayleigh-Ritz membuat
 * V^T (X^T X) V persis diagonal, berapa pun akurasi subruang. Eksak bila p = min(n, d).
 */
export function truncatedSvd(
  x: Float64Array,
  n: number,
  d: number,
  p: number,
  opts: { powerIters?: number; seed?: number } = {},
): { s: Float64Array; v: Float64Array[] } {
  const q = opts.powerIters ?? 4;
  const rand = mulberry32(opts.seed ?? 0x5eed);
  const mulX = (omega: Float64Array[]): Float64Array[] => {
    const out = omega.map(() => new Float64Array(n));
    for (let r = 0; r < n; r++) {
      const row = x.subarray(r * d, (r + 1) * d);
      for (let j = 0; j < omega.length; j++) (out[j] as Float64Array)[r] = dot(row, omega[j] as Float64Array);
    }
    return out;
  };
  const mulXt = (cols: Float64Array[]): Float64Array[] => {
    const out = cols.map(() => new Float64Array(d));
    for (let r = 0; r < n; r++) {
      const row = x.subarray(r * d, (r + 1) * d);
      for (let j = 0; j < cols.length; j++) {
        const w = (cols[j] as Float64Array)[r] as number;
        if (w === 0) continue;
        const o = out[j] as Float64Array;
        for (let c = 0; c < d; c++) o[c] = (o[c] as number) + w * (row[c] as number);
      }
    }
    return out;
  };
  const omega = Array.from({ length: p }, () => {
    const c = new Float64Array(d);
    for (let i = 0; i < d; i++) c[i] = gaussian(rand);
    return c;
  });
  let y = mulX(omega);
  orthonormalize(y);
  for (let it = 0; it < q; it++) {
    const z = mulXt(y);
    orthonormalize(z);
    y = mulX(z);
    orthonormalize(y);
  }
  // B = Q^T X (p x d); C = B B^T (p x p).
  const b = mulXt(y);
  const c = new Float64Array(p * p);
  for (let i = 0; i < p; i++)
    for (let j = i; j < p; j++) {
      const val = dot(b[i] as Float64Array, b[j] as Float64Array);
      c[i * p + j] = val;
      c[j * p + i] = val;
    }
  const eig = symmetricEigen(c, p);
  const s = new Float64Array(p);
  const v: Float64Array[] = [];
  for (let i = 0; i < p; i++) {
    const sv = Math.sqrt(Math.max(eig.values[i] as number, 0));
    s[i] = sv;
    const vec = new Float64Array(d);
    const u = eig.vectors[i] as Float64Array;
    for (let t = 0; t < p; t++) {
      const w = u[t] as number;
      const bt = b[t] as Float64Array;
      for (let cc = 0; cc < d; cc++) vec[cc] = (vec[cc] as number) + w * (bt[cc] as number);
    }
    if (sv > 0) for (let cc = 0; cc < d; cc++) vec[cc] = (vec[cc] as number) / sv;
    v.push(vec);
  }
  return { s, v };
}
