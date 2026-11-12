#!/usr/bin/env node
// Uji opsional reranker (cross-encoder) di atas embedding: apakah top-1 naik cukup untuk membayar model kedua?
// Embedding memilih kandidat (top-K jenis intent / top-K label menu), reranker (`llama-server --reranking`,
// endpoint `/v1/rerank`) mengurutkan ulang. Tidak dipakai saat runtime; alat ukur untuk HASIL.md.
//
//   node packages/embedding/eval/rerank.mjs --embed-url http://127.0.0.1:4340 --rerank-url http://127.0.0.1:5203
//
// Butuh `pnpm --filter @urusin/harness build` lebih dulu (prototipe intent diambil dari dist harness).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const DIR = dirname(fileURLToPath(import.meta.url));
const { PROTOTIPE_INTENT } = await import(
  pathToFileURL(join(DIR, '..', '..', 'harness', 'dist', 'intent-prototipe.js')).href
);

const { values: arg } = parseArgs({
  options: {
    'embed-url': { type: 'string', default: 'http://127.0.0.1:4340' },
    'rerank-url': { type: 'string', default: 'http://127.0.0.1:5203' },
    label: { type: 'string', default: 'rerank' },
    'k-intent': { type: 'string', default: '3' },
    'k-menu': { type: 'string', default: '5' },
  },
});
const K_INTENT = Number(arg['k-intent']);
const K_MENU = Number(arg['k-menu']);

// Profil produksi (EmbeddingGemma), sama dengan bakeoff.mjs --profil gemma.
const q = (t) => `task: search result | query: ${t}`;
const d = (t) => `title: none | text: ${t}`;

async function embed(teks) {
  const res = await fetch(`${arg['embed-url']}/v1/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'embed', input: teks }),
  });
  if (!res.ok) throw new Error(`embed HTTP ${res.status}`);
  return (await res.json()).data.sort((a, b) => a.index - b.index).map((x) => x.embedding);
}
const kos = (a, b) => {
  let s = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return s / Math.sqrt(na * nb);
};
/** Skor reranker per dokumen (urutan masukan). */
async function rerank(kueri, dokumen) {
  const res = await fetch(`${arg['rerank-url']}/v1/rerank`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'rerank', query: kueri, documents: dokumen, top_n: dokumen.length }),
  });
  if (!res.ok) throw new Error(`rerank HTTP ${res.status}: ${await res.text()}`);
  const skor = new Array(dokumen.length).fill(-Infinity);
  for (const r of (await res.json()).results) skor[r.index] = r.relevance_score;
  return skor;
}
const persen = (x) => `${(100 * x).toFixed(1)}%`;
const kuantil = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))];

// ---------- intent: rerank prototipe dari top-K jenis embedding; skor jenis = maks skor prototipenya ----------
const intent = JSON.parse(readFileSync(join(DIR, 'intent.json'), 'utf8')).data;
const proto = Object.entries(PROTOTIPE_INTENT).flatMap(([j, xs]) => xs.map((t) => ({ j, t })));
const protoVek = [];
for (let i = 0; i < proto.length; i += 16)
  protoVek.push(...(await embed(proto.slice(i, i + 16).map((p) => d(p.t)))));

const lat = [];
let e1 = 0;
let r1 = 0;
let n = 0;
const berubah = [];
for (const x of intent) {
  const benar = Array.isArray(x.jenis) ? x.jenis : [x.jenis];
  if (benar.includes('lainnya')) continue;
  n++;
  const [v] = await embed([q(x.teks)]);
  const sj = new Map();
  proto.forEach((p, i) => sj.set(p.j, Math.max(sj.get(p.j) ?? -1, kos(v, protoVek[i]))));
  const topK = [...sj.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, K_INTENT)
    .map(([j]) => j);
  const kand = proto.filter((p) => topK.includes(p.j));
  const t0 = performance.now();
  const s = await rerank(
    x.teks,
    kand.map((p) => p.t),
  );
  lat.push(performance.now() - t0);
  const sr = new Map();
  kand.forEach((p, i) => sr.set(p.j, Math.max(sr.get(p.j) ?? -Infinity, s[i])));
  const pilihR = [...sr.entries()].sort((a, b) => b[1] - a[1])[0][0];
  if (benar.includes(topK[0])) e1++;
  if (benar.includes(pilihR)) r1++;
  if (benar.includes(topK[0]) !== benar.includes(pilihR))
    berubah.push(`${benar.includes(pilihR) ? '+' : '-'} ${x.teks} [${benar}] emb=${topK[0]} rr=${pilihR}`);
}

// ---------- menu: rerank top-K label embedding ----------
const menu = JSON.parse(readFileSync(join(DIR, 'menu.json'), 'utf8'));
const menuVek = {};
for (const [k, labels] of Object.entries(menu.menu)) menuVek[k] = await embed(labels.map(d));
let me1 = 0;
let mr1 = 0;
const latM = [];
for (const c of menu.kasus) {
  const [v] = await embed([q(c.kueri)]);
  const labels = menu.menu[c.menu];
  const urut = labels.map((l, i) => [l, kos(v, menuVek[c.menu][i])]).sort((a, b) => b[1] - a[1]);
  const kand = urut.slice(0, K_MENU).map(([l]) => l);
  const t0 = performance.now();
  const s = await rerank(c.kueri, kand);
  latM.push(performance.now() - t0);
  const pilihR = kand[s.indexOf(Math.max(...s))];
  if (c.benar.includes(urut[0][0])) me1++;
  if (c.benar.includes(pilihR)) mr1++;
}

console.log(
  [
    `== ${arg.label} (K intent=${K_INTENT}, K menu=${K_MENU})`,
    `intent top1  embedding ${persen(e1 / n)} -> rerank ${persen(r1 / n)}  (n=${n})`,
    `menu   top1  embedding ${persen(me1 / menu.kasus.length)} -> rerank ${persen(mr1 / menu.kasus.length)}`,
    `latensi rerank intent p50 ${kuantil(lat, 0.5).toFixed(0)} ms p95 ${kuantil(lat, 0.95).toFixed(0)} ms; menu p50 ${kuantil(latM, 0.5).toFixed(0)} ms`,
    ...berubah.map((b) => `  ${b}`),
  ].join('\n'),
);
