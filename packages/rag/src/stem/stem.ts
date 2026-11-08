import { ROOTS } from './roots.js';
import { STOPWORDS } from './stopwords.js';

/**
 * Stemmer bahasa Indonesia gaya Nazief-Adriani (hasilnya divalidasi kamus akar `ROOTS`):
 * buang partikel (-lah/-kah/-pun) dan posesif (-ku/-mu/-nya), lalu sufiks turunan (-kan/-an/-i,
 * plus -in lisan), lalu hingga 2 awalan (di-, ke-, se-, me(N)-, pe(N)-, per-, ber-, ter-, plus
 * ng-/nge- lisan) dengan peluluhan huruf awal. Kandidat pertama yang ada di kamus menang. Bila tak
 * ada yang cocok, kata TIDAK dipotong (hanya partikel/posesif) agar tidak over-stemming; istilah
 * di luar kamus tetap konsisten antara indeks dan kueri karena keduanya memakai fungsi yang sama.
 *
 * Token yang dilindungi (tidak di-stem): mengandung angka (F1.06), >=2 huruf kapital (KTP-el, NIK,
 * SKPWNI), mengandung tanda hubung selain reduplikasi, atau tanpa vokal (ktp, bpjs, skck).
 */

const VOWEL = /[aiueo]/;
const MIN_ROOT = 3;

function isRoot(w: string): boolean {
  return ROOTS.has(w);
}

function validRoot(w: string): boolean {
  return w.length >= MIN_ROOT && VOWEL.test(w);
}

const PARTICLES = ['lah', 'kah', 'tah', 'pun'];
const POSSESSIVES = ['nya', 'ku', 'mu'];
const DERIV = ['kan', 'an', 'i', 'in'];

function strip(w: string, suffixes: readonly string[]): string[] {
  const out = [w];
  for (const s of suffixes)
    if (w.length - s.length >= MIN_ROOT && w.endsWith(s)) out.push(w.slice(0, -s.length));
  return out;
}

/** Kandidat setelah membuang 0..1 partikel, 0..1 posesif, 0..1 sufiks turunan (sedikit dulu). */
function suffixVariants(w: string): string[] {
  const seen = new Set<string>();
  for (const a of strip(w, PARTICLES))
    for (const b of strip(a, POSSESSIVES)) for (const c of strip(b, DERIV)) seen.add(c);
  return [...seen];
}

/** Kandidat setelah membuang satu awalan, termasuk peluluhan (meny->s, men->t, meng->k, mem->p). */
function prefixCandidates(w: string): string[] {
  const out: string[] = [];
  const cut = (p: string, add = '') => {
    if (w.startsWith(p) && w.length - p.length >= 2) out.push(add + w.slice(p.length));
  };
  cut('di');
  cut('ke');
  cut('se');
  cut('meny', 's');
  cut('meng', 'k');
  cut('meng');
  cut('mem', 'p');
  cut('mem');
  cut('men', 't');
  cut('men');
  cut('me');
  cut('peny', 's');
  cut('peng', 'k');
  cut('peng');
  cut('pem', 'p');
  cut('pem');
  cut('pen', 't');
  cut('pen');
  cut('per');
  cut('pe');
  cut('pel', 'a');
  cut('ber');
  cut('bel', 'a');
  cut('be');
  cut('ter');
  cut('te');
  cut('nge');
  cut('ng', 'k');
  cut('ng');
  return out;
}

function findRoot(w: string, depth: number): string | null {
  if (isRoot(w)) return w;
  if (depth === 0) return null;
  for (const c of prefixCandidates(w)) {
    if (!validRoot(c)) continue;
    const r = findRoot(c, depth - 1);
    if (r) return r;
  }
  return null;
}

/** Stem satu kata huruf kecil murni (tanpa tanda hubung). */
export function stemLower(word: string): string {
  const w = word.toLowerCase();
  if (w.length <= MIN_ROOT || isRoot(w) || !VOWEL.test(w)) return w;
  for (const v of suffixVariants(w)) {
    if (!validRoot(v)) continue;
    const r = findRoot(v, 2);
    if (r) return r;
  }
  // Tanpa kecocokan kamus: buang hanya partikel/posesif -nya.
  const light = strip(strip(w, PARTICLES).pop() ?? w, ['nya']).pop() ?? w;
  return validRoot(light) ? light : w;
}

/** Token mentah: huruf/angka dengan penghubung '-' atau '.' di tengah (KTP-el, F1.06). */
export function rawTokens(text: string): string[] {
  return text.match(/[\p{L}\p{N}]+(?:[-.][\p{L}\p{N}]+)*/gu) ?? [];
}

function isProtected(tok: string): boolean {
  if (/\d/.test(tok)) return true;
  return (tok.match(/\p{Lu}/gu) ?? []).length >= 2;
}

/** Stem satu token mentah dengan perlindungan istilah teknis. */
export function stemToken(tok: string): string {
  const low = tok.toLowerCase();
  if (isProtected(tok)) return low;
  if (/[-.]/.test(low)) {
    const parts = low.split(/[-.]/);
    // Reduplikasi (anak-anak): stem satu bagian; selain itu (ktp-el, e-ktp) dibiarkan.
    if (parts.length === 2 && parts[0] === parts[1]) return stemLower(parts[0]!);
    return low;
  }
  return stemLower(low);
}

export function isStopword(tok: string): boolean {
  return STOPWORDS.has(tok.toLowerCase());
}

/**
 * Teks -> token ter-stem tanpa stopword (urutan dipertahankan). Dipakai identik di sisi ingest
 * dan kueri. Bila semua token stopword, token mentah dipertahankan agar kueri tidak kosong.
 */
export function stemTokens(text: string): string[] {
  const toks = rawTokens(text).filter((t) => t.length >= 2);
  const kept = toks.filter((t) => !isStopword(t));
  return (kept.length ? kept : toks).map(stemToken);
}

export function stemText(text: string): string {
  return stemTokens(text).join(' ');
}
