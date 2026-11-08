import { truncatedSvd } from './linalg.js';

export type TransformMode = 'none' | 'center' | 'whiten';

export type FitOptions = {
  mode: TransformMode;
  /** Jumlah komponen whitening (default 256); di-clamp ke min(n-1, d). */
  k?: number | undefined;
  /** Shrinkage lambda [0,1] ke identitas berskala, atau 'auto' (Ledoit-Wolf). Default 'auto'. */
  shrinkage?: number | 'auto' | undefined;
};

/** Parameter transformasi; JSON-serializable (hanya angka dan string). */
export type TransformParams = {
  mode: TransformMode;
  dim: number;
  /** Dimensi keluaran: dim untuk none/center, k untuk whiten. */
  k: number;
  /** Rata-rata korpus mu (panjang dim); kosong untuk 'none'. */
  mean: number[];
  /** Matriks whitening row-major k x dim: W[j*dim + i] = komponen j dibagi sqrt(eigen terkecilkan). */
  W: number[];
  fittedOn: number;
  /** Lambda shrinkage yang dipakai (hasil resolusi 'auto'). */
  shrinkage: number;
  version: 1;
};

const EPS = 1e-10;
const LW_MAX_ROWS = 1500;
const DEFAULT_K = 256;

function assertDims(vectors: readonly Float32Array[]): number {
  const d = vectors[0]?.length ?? 0;
  if (d === 0) throw new Error('fitTransform: tidak ada vektor');
  for (const v of vectors) {
    if (v.length !== d) throw new Error('fitTransform: dimensi vektor tidak seragam');
    for (let i = 0; i < d; i++)
      if (!Number.isFinite(v[i] as number)) throw new Error('fitTransform: nilai non-finit');
  }
  return d;
}

/** Shrinkage Ledoit-Wolf ke m*I lewat matriks Gram (tanpa membentuk matriks kovarians d x d). */
export function ledoitWolfShrinkage(x: Float64Array, n: number, d: number): number {
  const m = Math.min(n, LW_MAX_ROWS);
  if (m < 2) return 1;
  const stride = n / m;
  const rows: Float64Array[] = [];
  for (let i = 0; i < m; i++) {
    const r = Math.floor(i * stride);
    rows.push(x.subarray(r * d, (r + 1) * d));
  }
  // Pusatkan ulang pada subsampel agar rumus konsisten.
  const mu = new Float64Array(d);
  for (const r of rows) for (let c = 0; c < d; c++) mu[c] = (mu[c] as number) + (r[c] as number) / m;
  const xs = rows.map((r) => Float64Array.from(r, (v, c) => v - (mu[c] as number)));
  let sumG2 = 0;
  let sumDiag2 = 0;
  let trS = 0;
  for (let i = 0; i < m; i++) {
    const xi = xs[i] as Float64Array;
    for (let j = i; j < m; j++) {
      const xj = xs[j] as Float64Array;
      let g = 0;
      for (let c = 0; c < d; c++) g += (xi[c] as number) * (xj[c] as number);
      sumG2 += (i === j ? 1 : 2) * g * g;
      if (i === j) {
        sumDiag2 += g * g;
        trS += g;
      }
    }
  }
  trS /= m;
  const mean = trS / d;
  const frobS2 = sumG2 / (m * m);
  const d2 = (frobS2 - mean * mean * d) / d;
  if (d2 <= 0) return 1;
  const b2bar = (sumDiag2 - sumG2 / m) / (m * m * d);
  const b2 = Math.min(Math.max(b2bar, 0), d2);
  return b2 / d2;
}

export function fitTransform(vectors: Float32Array[], opts: FitOptions): TransformParams {
  const d = assertDims(vectors);
  const n = vectors.length;
  const base = { dim: d, fittedOn: n, version: 1 as const };
  if (opts.mode === 'none') {
    return { ...base, mode: 'none', k: d, mean: [], W: [], shrinkage: 0 };
  }
  const mean = new Float64Array(d);
  for (const v of vectors) for (let i = 0; i < d; i++) mean[i] = (mean[i] as number) + (v[i] as number) / n;
  if (opts.mode === 'center') {
    return { ...base, mode: 'center', k: d, mean: Array.from(mean), W: [], shrinkage: 0 };
  }

  if (n < 2) throw new Error('fitTransform(whiten): butuh minimal 2 vektor');
  const x = new Float64Array(n * d);
  vectors.forEach((v, r) => {
    for (let i = 0; i < d; i++) x[r * d + i] = (v[i] as number) - (mean[i] as number);
  });

  const lambdaOpt = opts.shrinkage ?? 'auto';
  const lambda = lambdaOpt === 'auto' ? ledoitWolfShrinkage(x, n, d) : lambdaOpt;
  if (!(lambda >= 0 && lambda <= 1)) throw new Error('fitTransform: shrinkage harus dalam [0,1] atau "auto"');

  const kReq = Math.max(1, Math.floor(opts.k ?? DEFAULT_K));
  const kMax = Math.min(n - 1, d);
  const p = Math.min(kMax + 10, n, d);
  const { s, v } = truncatedSvd(x, n, d, p);

  let trace = 0;
  for (let i = 0; i < x.length; i++) trace += (x[i] as number) ** 2;
  const nu = trace / n / d; // tr(S)/d dengan S = X^T X / n
  const top = (s[0] as number) ** 2 / n;

  const rows: Float64Array[] = [];
  for (let j = 0; j < Math.min(kReq, kMax); j++) {
    const sigma = (s[j] as number) ** 2 / n;
    if (sigma <= EPS * top) break; // eigen terlalu kecil: hentikan, jangan bagi dengan ~0
    const e = (1 - lambda) * sigma + lambda * nu;
    if (e <= 0 || !Number.isFinite(e)) break;
    const scale = 1 / Math.sqrt(e);
    rows.push((v[j] as Float64Array).map((c) => c * scale));
  }
  if (rows.length === 0) throw new Error('fitTransform(whiten): data tanpa varians');
  const W = new Array<number>(rows.length * d);
  rows.forEach((r, j) => r.forEach((c, i) => (W[j * d + i] = c)));
  return { ...base, mode: 'whiten', k: rows.length, mean: Array.from(mean), W, shrinkage: lambda };
}

export function applyTransform(params: TransformParams, v: Float32Array): Float32Array {
  if (v.length !== params.dim) throw new Error(`applyTransform: dimensi ${v.length} != ${params.dim}`);
  const d = params.dim;
  let out: Float64Array;
  if (params.mode === 'none') {
    out = Float64Array.from(v);
  } else {
    const c = new Float64Array(d);
    for (let i = 0; i < d; i++) c[i] = (v[i] as number) - (params.mean[i] as number);
    if (params.mode === 'center') {
      out = c;
    } else {
      out = new Float64Array(params.k);
      for (let j = 0; j < params.k; j++) {
        let acc = 0;
        const off = j * d;
        for (let i = 0; i < d; i++) acc += (c[i] as number) * (params.W[off + i] as number);
        out[j] = acc;
      }
    }
  }
  let nrm = 0;
  for (let i = 0; i < out.length; i++) nrm += (out[i] as number) ** 2;
  nrm = Math.sqrt(nrm);
  const res = new Float32Array(out.length);
  if (nrm > 0) for (let i = 0; i < out.length; i++) res[i] = (out[i] as number) / nrm;
  return res;
}

export function serializeTransform(params: TransformParams): string {
  return JSON.stringify(params);
}

export function deserializeTransform(json: string): TransformParams {
  const p = JSON.parse(json) as TransformParams;
  const ok =
    (p.mode === 'none' || p.mode === 'center' || p.mode === 'whiten') &&
    p.version === 1 &&
    Number.isInteger(p.dim) &&
    p.dim > 0 &&
    Number.isInteger(p.k) &&
    Array.isArray(p.mean) &&
    Array.isArray(p.W) &&
    (p.mode === 'none' || p.mean.length === p.dim) &&
    (p.mode !== 'whiten' || p.W.length === p.k * p.dim);
  if (!ok) throw new Error('Parameter transformasi vektor tidak valid');
  return p;
}
