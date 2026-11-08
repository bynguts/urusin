import { describe, expect, it } from 'vitest';
import { anisotropicClusters } from './synthetic.js';
import {
  applyTransform,
  deserializeTransform,
  fitTransform,
  serializeTransform,
  type TransformParams,
} from './transform.js';

const cos = (a: Float32Array, b: Float32Array) => {
  let d = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    d += (a[i] as number) * (b[i] as number);
    na += (a[i] as number) ** 2;
    nb += (b[i] as number) ** 2;
  }
  return d / Math.sqrt(na * nb);
};

/** Rata-rata cosine intra-klaster dikurangi antar-klaster (makin besar = klaster makin terpisah). */
function separation(vs: Float32Array[], labels: number[]): number {
  let intra = 0;
  let ni = 0;
  let inter = 0;
  let nj = 0;
  for (let i = 0; i < vs.length; i++)
    for (let j = i + 1; j < vs.length; j++) {
      const c = cos(vs[i] as Float32Array, vs[j] as Float32Array);
      if (labels[i] === labels[j]) {
        intra += c;
        ni++;
      } else {
        inter += c;
        nj++;
      }
    }
  return intra / ni - inter / nj;
}

const DATA = anisotropicClusters({ n: 160, dim: 64, clusters: 4, seed: 7 });
const apply = (p: TransformParams, vs: Float32Array[]) => vs.map((v) => applyTransform(p, v));

describe('fitTransform / applyTransform', () => {
  it('centering dan whitening menaikkan separasi klaster dibanding vektor mentah', () => {
    const raw = separation(apply(fitTransform(DATA.vectors, { mode: 'none' }), DATA.vectors), DATA.labels);
    const center = separation(
      apply(fitTransform(DATA.vectors, { mode: 'center' }), DATA.vectors),
      DATA.labels,
    );
    const whiten = separation(
      apply(fitTransform(DATA.vectors, { mode: 'whiten', k: 16, shrinkage: 0 }), DATA.vectors),
      DATA.labels,
    );
    if (process.env.SHOW_SEPARATION) console.log(JSON.stringify({ raw, center, whiten }));
    expect(center).toBeGreaterThan(raw * 10);
    expect(whiten).toBeGreaterThan(raw * 10);
  });

  it('kovarians hasil whitening mendekati identitas pada top-k (tanpa shrinkage)', () => {
    const k = 16;
    const p = fitTransform(DATA.vectors, { mode: 'whiten', k, shrinkage: 0 });
    expect(p.k).toBe(k);
    const n = DATA.vectors.length;
    const proj = DATA.vectors.map((v) => {
      const out = new Float64Array(k);
      for (let j = 0; j < k; j++)
        for (let i = 0; i < p.dim; i++)
          out[j] =
            (out[j] as number) + ((v[i] as number) - (p.mean[i] as number)) * (p.W[j * p.dim + i] as number);
      return out;
    });
    for (let a = 0; a < k; a++)
      for (let b = a; b < k; b++) {
        let c = 0;
        for (const r of proj) c += (r[a] as number) * (r[b] as number);
        c /= n;
        expect(Math.abs(c - (a === b ? 1 : 0))).toBeLessThan(1e-6);
      }
  });

  it('serialize, deserialize, apply menghasilkan keluaran identik', () => {
    const p = fitTransform(DATA.vectors, { mode: 'whiten', k: 16 });
    const q = deserializeTransform(serializeTransform(p));
    expect(q).toEqual(p);
    for (const v of DATA.vectors.slice(0, 10)) {
      expect(Array.from(applyTransform(q, v))).toEqual(Array.from(applyTransform(p, v)));
    }
  });

  it('n < d berjalan tanpa NaN dan k di-clamp ke n-1 (shrinkage auto dan tetap)', () => {
    const small = anisotropicClusters({ n: 20, dim: 256, clusters: 4, seed: 3 });
    for (const shrinkage of ['auto', 0.3] as const) {
      const p = fitTransform(small.vectors, { mode: 'whiten', k: 128, shrinkage });
      expect(p.k).toBeLessThanOrEqual(19);
      expect(p.shrinkage).toBeGreaterThanOrEqual(0);
      expect(p.shrinkage).toBeLessThanOrEqual(1);
      for (const v of small.vectors) {
        const out = applyTransform(p, v);
        expect(out.length).toBe(p.k);
        expect(out.every(Number.isFinite)).toBe(true);
        expect(Math.hypot(...out)).toBeCloseTo(1, 5);
      }
    }
  });

  it('mode none = identitas selain normalisasi L2', () => {
    const p = fitTransform(DATA.vectors, { mode: 'none' });
    const v = DATA.vectors[0] as Float32Array;
    const out = applyTransform(p, v);
    const nrm = Math.hypot(...v);
    out.forEach((x, i) => expect(x).toBeCloseTo((v[i] as number) / nrm, 6));
  });

  it('transformasi kueri sama dengan transformasi dokumen', () => {
    const p = deserializeTransform(serializeTransform(fitTransform(DATA.vectors, { mode: 'whiten', k: 8 })));
    const doc = DATA.vectors[5] as Float32Array;
    const query = Float32Array.from(doc); // teks sama -> embedding sama
    expect(Array.from(applyTransform(p, query))).toEqual(Array.from(applyTransform(p, doc)));
  });

  it('menolak dimensi tidak cocok dan shrinkage di luar rentang', () => {
    const p = fitTransform(DATA.vectors, { mode: 'center' });
    expect(() => applyTransform(p, new Float32Array(3))).toThrow();
    expect(() => fitTransform(DATA.vectors, { mode: 'whiten', shrinkage: 2 })).toThrow();
  });

  it('data tanpa varians ditolak, bukan NaN', () => {
    const same = Array.from({ length: 5 }, () => new Float32Array([1, 2, 3]));
    expect(() => fitTransform(same, { mode: 'whiten' })).toThrow(/varians/);
  });
});
