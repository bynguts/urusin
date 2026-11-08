import { gaussian, mulberry32 } from './linalg.js';

/**
 * Data uji anisotropik: offset bersama besar + sinyal kecil per klaster + derau. Dipakai tes dan
 * embedder palsu `rag:eval`. `labels[i]` = klaster vektor i.
 */
export function anisotropicClusters(opts: {
  n: number;
  dim: number;
  clusters: number;
  offset?: number;
  signal?: number;
  noise?: number;
  seed?: number;
}): { vectors: Float32Array[]; labels: number[] } {
  const rand = mulberry32(opts.seed ?? 1);
  const { n, dim, clusters } = opts;
  const offset = opts.offset ?? 10;
  const signal = opts.signal ?? 0.5;
  const noise = opts.noise ?? 0.1;
  const shared = Float64Array.from({ length: dim }, () => gaussian(rand));
  const snorm = Math.sqrt(shared.reduce((a, b) => a + b * b, 0));
  const centers = Array.from({ length: clusters }, () =>
    Float64Array.from({ length: dim }, () => gaussian(rand)),
  );
  const vectors: Float32Array[] = [];
  const labels: number[] = [];
  for (let i = 0; i < n; i++) {
    const c = i % clusters;
    labels.push(c);
    const center = centers[c] as Float64Array;
    const v = new Float32Array(dim);
    for (let j = 0; j < dim; j++) {
      v[j] =
        (offset * (shared[j] as number)) / snorm +
        (signal * (center[j] as number)) / Math.sqrt(dim) +
        (noise * gaussian(rand)) / Math.sqrt(dim);
    }
    vectors.push(v);
  }
  return { vectors, labels };
}
