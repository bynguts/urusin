import { tokenize } from '../search.js';
import { gaussian, mulberry32 } from '../vector/linalg.js';
import type { Embedder } from '../vector/store.js';

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Embedder palsu deterministik untuk tes: bag-of-words ber-hash (tiap token -> vektor acak tetap)
 * ditambah offset bersama besar sehingga sengaja anisotropik. Tanpa jaringan.
 */
export function fakeEmbedder(opts: { dim?: number; offset?: number } = {}): Embedder {
  const dim = opts.dim ?? 64;
  const offset = opts.offset ?? 20;
  const shared = (() => {
    const rand = mulberry32(0xabc);
    const v = Float64Array.from({ length: dim }, () => gaussian(rand));
    const n = Math.hypot(...v);
    return v.map((x) => (x / n) * offset);
  })();
  const tokenVec = (t: string) => {
    const rand = mulberry32(hash(t));
    return Float64Array.from({ length: dim }, () => gaussian(rand));
  };
  return (texts) =>
    Promise.resolve(
      texts.map((text) => {
        const out = Float64Array.from(shared);
        for (const t of tokenize(text)) {
          const tv = tokenVec(t);
          for (let i = 0; i < dim; i++) out[i] = (out[i] as number) + (tv[i] as number);
        }
        return Float32Array.from(out);
      }),
    );
}
