// Muat rahasia LLM dari berkas env (bawaan ~/.urusin-secrets/llm.env) TANPA pernah mencetak nilainya.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const BERKAS_RAHASIA = join(homedir(), '.urusin-secrets', 'llm.env');

/** Parse KEY=VALUE (abaikan komentar/baris kosong, buang tanda kutip pembungkus). */
export function parseEnv(teks) {
  const out = {};
  for (const baris of teks.split(/\r?\n/)) {
    const m = baris.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

/**
 * Rahasia yang dibutuhkan eval: LLM_BASE_URL, LLM_API_KEY, LLM_AGENT_MODEL (wajib), JINA_API_KEY (opsional,
 * untuk embedding/rerank seperti produksi). process.env menang atas berkas (CI bisa menyuntik langsung).
 */
export function muatRahasia(berkas = process.env.URUSIN_EVAL_SECRETS ?? BERKAS_RAHASIA) {
  let dariBerkas = {};
  try {
    dariBerkas = parseEnv(readFileSync(berkas, 'utf8'));
  } catch {
    // berkas tidak ada: andalkan process.env
  }
  const ambil = (k) => process.env[k] ?? dariBerkas[k];
  const r = {
    LLM_BASE_URL: ambil('LLM_BASE_URL'),
    LLM_API_KEY: ambil('LLM_API_KEY'),
    LLM_AGENT_MODEL: ambil('LLM_AGENT_MODEL'),
    JINA_API_KEY: ambil('JINA_API_KEY'),
  };
  const kurang = ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_AGENT_MODEL'].filter((k) => !r[k]);
  if (kurang.length > 0) throw new Error(`rahasia LLM kurang: ${kurang.join(', ')} (berkas ${berkas})`);
  return r;
}

/** Ganti setiap nilai rahasia di teks dengan [RAHASIA] (untuk log server / pesan galat yang disimpan). */
export function sensor(teks, rahasia) {
  let out = String(teks ?? '');
  for (const v of Object.values(rahasia ?? {})) {
    if (typeof v === 'string' && v.length >= 8) out = out.split(v).join('[RAHASIA]');
  }
  return out;
}
