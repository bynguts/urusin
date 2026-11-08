import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Db } from './db.js';
import { rawTokens } from './stem/stem.js';

const PATH = new URL('../../../data/glossary/luar-cakupan.json', import.meta.url);
const FileSchema = z.object({ layanan: z.array(z.array(z.string().min(1)).min(1)) });

let cached: readonly (readonly string[])[] | undefined;

/** Kelompok alias nama layanan di luar cakupan (huruf kecil). Kosong bila berkas tidak ada. */
export function outOfScopeTerms(): readonly (readonly string[])[] {
  if (!cached) {
    try {
      const j = FileSchema.parse(JSON.parse(readFileSync(fileURLToPath(PATH), 'utf8')));
      cached = j.layanan.map((g) => g.map((t) => t.toLowerCase()));
    } catch {
      cached = [];
    }
  }
  return cached;
}

const words = (s: string) => ` ${rawTokens(s).join(' ').toLowerCase()} `;

/**
 * Istilah layanan luar cakupan (mis. "SIM", "SKCK") yang disebut kueri dan tidak muncul di judul chunk
 * mana pun; null bila tidak ada. Jika judul korpus memuat istilah itu, layanannya ada di korpus.
 */
export function outOfScopeNoun(db: Db, query: string): string | null {
  const q = words(query);
  const group = outOfScopeTerms().find((g) => g.some((t) => q.includes(` ${t} `)));
  if (!group) return null;
  const titles = (db.prepare('SELECT DISTINCT judul FROM chunks').all() as { judul: string }[]).map((r) =>
    words(r.judul),
  );
  if (titles.some((t) => group.some((a) => t.includes(` ${a} `)))) return null;
  return group.find((t) => q.includes(` ${t} `)) ?? null;
}
