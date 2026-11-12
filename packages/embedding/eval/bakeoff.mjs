#!/usr/bin/env node
// Bake-off embedding Urusin: jalankan set eval Indonesia terhadap endpoint OpenAI-compatible `/v1/embeddings`
// (llama-server --embedding, atau server referensi fp32). Tidak dipakai saat runtime; alat ukur untuk HASIL.md.
//
//   node packages/embedding/eval/bakeoff.mjs --url http://127.0.0.1:4340 --profil harrier [--label nama] [--json out.json]
//
// Butuh `pnpm --filter @urusin/harness build` lebih dulu (prototipe + kata kunci intent diambil dari dist harness).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const DIR = dirname(fileURLToPath(import.meta.url));
const harness = join(DIR, '..', '..', 'harness', 'dist');
const { PROTOTIPE_INTENT, INSTRUKSI_INTENT } = await import(
  pathToFileURL(join(harness, 'intent-prototipe.js')).href
);
const { klasifikasiKataKunci } = await import(pathToFileURL(join(harness, 'intent.js')).href);

const INSTRUKSI_MENU =
  'Given a public administration service a citizen wants to apply for, retrieve the matching menu item or link on a government portal';

/** Awalan kueri/dokumen sesuai rekomendasi kartu model masing-masing. */
const PROFIL = {
  harrier: { q: (t, i) => `Instruct: ${i}\nQuery: ${t}`, d: (t) => t },
  qwen3: { q: (t, i) => `Instruct: ${i}\nQuery:${t}`, d: (t) => t },
  gemma: { q: (t) => `task: search result | query: ${t}`, d: (t) => `title: none | text: ${t}` },
  // Varian kartu model EmbeddingGemma untuk klasifikasi (kueri dan prototipe sama-sama berawalan klasifikasi).
  'gemma-kls': {
    q: (t) => `task: classification | query: ${t}`,
    d: (t) => `task: classification | query: ${t}`,
  },
  // Varian Qwen3 dengan token EOS eksplisit (cek apakah GGUF resmi sudah menambahkannya sendiri).
  'qwen3-eos': { q: (t, i) => `Instruct: ${i}\nQuery:${t}<|endoftext|>`, d: (t) => `${t}<|endoftext|>` },
  granite: { q: (t) => t, d: (t) => t },
  e5: { q: (t) => `query: ${t}`, d: (t) => `passage: ${t}` },
  // jina-embeddings-v5-text-*-retrieval (prompts sentence-transformers resmi; pooling token terakhir).
  jina: { q: (t) => `Query: ${t}`, d: (t) => `Document: ${t}` },
};

const { values: arg } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://127.0.0.1:4340' },
    profil: { type: 'string' },
    label: { type: 'string' },
    model: { type: 'string', default: 'embed' },
    json: { type: 'string' },
    'target-presisi': { type: 'string', default: '0.97' },
  },
});
const profil = PROFIL[arg.profil];
if (!profil) throw new Error(`--profil wajib salah satu: ${Object.keys(PROFIL).join(', ')}`);

async function embed(teks) {
  const res = await fetch(`${arg.url}/v1/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: arg.model, input: teks }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return j.data.sort((a, b) => a.index - b.index).map((d) => normal(d.embedding));
}
const normal = (v) => {
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
};
const kos = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
async function embedBanyak(teks, ukuran = 16) {
  const out = [];
  for (let i = 0; i < teks.length; i += ukuran) out.push(...(await embed(teks.slice(i, i + ukuran))));
  return out;
}
const persen = (x) => `${(100 * x).toFixed(1)}%`;
const kuantil = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

// ---------- (a) intent ----------
const intent = JSON.parse(readFileSync(join(DIR, 'intent.json'), 'utf8')).data;
const protoBaris = Object.entries(PROTOTIPE_INTENT).flatMap(([j, xs]) => xs.map((t) => ({ j, t })));
const protoVek = await embedBanyak(protoBaris.map((p) => profil.d(p.t)));

const latensi = [];
const hasilIntent = [];
for (const [idx, x] of intent.entries()) {
  const t0 = performance.now();
  const [v] = await embed([profil.q(x.teks, INSTRUKSI_INTENT)]);
  latensi.push(performance.now() - t0);
  const skor = new Map();
  protoBaris.forEach((p, i) => skor.set(p.j, Math.max(skor.get(p.j) ?? -1, kos(v, protoVek[i]))));
  const urut = [...skor.entries()].sort((a, b) => b[1] - a[1]);
  const benar = Array.isArray(x.jenis) ? x.jenis : [x.jenis];
  hasilIntent.push({
    idx,
    teks: x.teks,
    benar,
    gaya: x.gaya,
    top: urut.slice(0, 3).map(([j]) => j),
    s1: urut[0][1],
    s2: urut[1][1],
    kunci: klasifikasiKataKunci(x.teks),
  });
}

const dalam = hasilIntent.filter((h) => !h.benar.includes('lainnya'));
const top1 = dalam.filter((h) => h.benar.includes(h.top[0])).length / dalam.length;
const top3 = dalam.filter((h) => h.top.some((j) => h.benar.includes(j))).length / dalam.length;

/** Keputusan jalur cepat: terima bila s1 >= T dan s1 - s2 >= M; benar bila jenis teratas termasuk `benar`. */
function nilai(hs, T, M) {
  const terima = hs.filter((h) => h.s1 >= T && h.s1 - h.s2 >= M);
  const tepat = terima.filter((h) => h.benar.includes(h.top[0])).length;
  return {
    cakupan: terima.length / hs.length,
    presisi: terima.length ? tepat / terima.length : 1,
    salah: terima.length - tepat,
    diterima: terima.length,
  };
}
// Tuning ambang di separuh data (indeks genap), laporan di separuh lain (ganjil): ambang tidak diukur di data yang
// dipakai untuk memilihnya.
const dev = hasilIntent.filter((h) => h.idx % 2 === 0);
const uji = hasilIntent.filter((h) => h.idx % 2 === 1);
const target = Number(arg['target-presisi']);
let terbaik = null;
const s1s = [...new Set(hasilIntent.map((h) => Number(h.s1.toFixed(3))))].sort((a, b) => a - b);
for (const T of s1s)
  for (const M of [0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.1]) {
    const n = nilai(dev, T, M);
    if (n.presisi >= target && (!terbaik || n.cakupan > terbaik.n.cakupan)) terbaik = { T, M, n };
  }
const ambang = terbaik ?? { T: 1, M: 1, n: nilai(dev, 1, 1) };
const nUji = nilai(uji, ambang.T, ambang.M);
const nSemua = nilai(hasilIntent, ambang.T, ambang.M);
const tanpaKunci = hasilIntent.filter((h) => h.kunci === null);
const nTanpaKunci = nilai(tanpaKunci, ambang.T, ambang.M);
const lainnya = hasilIntent.filter((h) => h.benar.includes('lainnya'));
const lolosLainnya = lainnya.filter((h) => h.s1 >= ambang.T && h.s1 - h.s2 >= ambang.M);

// ---------- (b) menu ----------
const menu = JSON.parse(readFileSync(join(DIR, 'menu.json'), 'utf8'));
const menuVek = {};
for (const [k, labels] of Object.entries(menu.menu)) menuVek[k] = await embedBanyak(labels.map(profil.d));
let m1 = 0;
let m3 = 0;
const salahMenu = [];
for (const c of menu.kasus) {
  const [v] = await embed([profil.q(c.kueri, INSTRUKSI_MENU)]);
  const labels = menu.menu[c.menu];
  const urut = labels.map((l, i) => [l, kos(v, menuVek[c.menu][i])]).sort((a, b) => b[1] - a[1]);
  if (c.benar.includes(urut[0][0])) m1++;
  else salahMenu.push(`${c.kueri} @${c.menu} -> ${urut[0][0]}`);
  if (urut.slice(0, 3).some(([l]) => c.benar.includes(l))) m3++;
}

const ringkas = {
  label: arg.label ?? arg.profil,
  intent: {
    n: hasilIntent.length,
    nDalam: dalam.length,
    top1,
    top3,
    ambang: { T: ambang.T, M: ambang.M },
    dev: ambang.n,
    uji: nUji,
    semua: nSemua,
    tanpaKunci: { n: tanpaKunci.length, ...nTanpaKunci },
    lainnyaLolos: lolosLainnya.map((h) => `${h.teks} -> ${h.top[0]}`),
  },
  menu: {
    n: menu.kasus.length,
    top1: m1 / menu.kasus.length,
    top3: m3 / menu.kasus.length,
    salah: salahMenu,
  },
  latensiMs: { p50: kuantil(latensi, 0.5), p95: kuantil(latensi, 0.95) },
  // Per butir (untuk analisis ambang lintas model tanpa menjalankan ulang).
  butir: hasilIntent.map((h) => ({
    i: h.idx,
    benar: h.benar,
    top: h.top,
    s1: h.s1,
    s2: h.s2,
    kunci: h.kunci,
  })),
  salahTop1: dalam
    .filter((h) => !h.benar.includes(h.top[0]))
    .map((h) => `${h.teks} [${h.benar}] -> ${h.top[0]} (${h.s1.toFixed(3)})`),
};
console.log(
  [
    `== ${ringkas.label}`,
    `intent  top1 ${persen(top1)}  top3 ${persen(top3)}  (n=${dalam.length} dalam domain, ${hasilIntent.length} total)`,
    `ambang  T=${ambang.T} M=${ambang.M}  dev cakupan ${persen(ambang.n.cakupan)} presisi ${persen(ambang.n.presisi)}`,
    `        uji cakupan ${persen(nUji.cakupan)} presisi ${persen(nUji.presisi)} (salah ${nUji.salah}/${nUji.diterima})`,
    `        tanpa-kunci (n=${tanpaKunci.length}) cakupan ${persen(nTanpaKunci.cakupan)} presisi ${persen(nTanpaKunci.presisi)}`,
    `        lainnya lolos ${lolosLainnya.length}/${lainnya.length}`,
    `menu    top1 ${persen(ringkas.menu.top1)}  top3 ${persen(ringkas.menu.top3)}  (n=${menu.kasus.length})`,
    `latensi p50 ${ringkas.latensiMs.p50.toFixed(1)} ms  p95 ${ringkas.latensiMs.p95.toFixed(1)} ms (1 kueri/permintaan)`,
  ].join('\n'),
);
if (arg.json) writeFileSync(arg.json, JSON.stringify(ringkas, null, 2));
