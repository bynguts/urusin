import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Db } from './db.js';
import { rawTokens } from './stem/stem.js';

const PATH = new URL('../../../data/glossary/luar-cakupan.json', import.meta.url);
const FileSchema = z.object({
  layanan: z.array(z.object({ id: z.string().min(1), istilah: z.array(z.string().min(1)).min(1) })),
});

export type OosService = { id: string; istilah: readonly string[] };

let cached: readonly OosService[] | undefined;

/** Layanan luar cakupan dengan alias (huruf kecil). Kosong bila berkas tidak ada. */
export function outOfScopeServices(): readonly OosService[] {
  if (!cached) {
    try {
      const j = FileSchema.parse(JSON.parse(readFileSync(fileURLToPath(PATH), 'utf8')));
      cached = j.layanan.map((g) => ({ id: g.id, istilah: g.istilah.map((t) => t.toLowerCase()) }));
    } catch {
      cached = [];
    }
  }
  return cached;
}

const words = (s: string) => ` ${rawTokens(s).join(' ').toLowerCase()} `;

/** Layanan luar cakupan yang disebut kueri (tanpa memeriksa judul korpus); null bila tidak ada. */
export function mentionedService(query: string): OosService | null {
  const q = words(query);
  return outOfScopeServices().find((g) => g.istilah.some((t) => q.includes(` ${t} `))) ?? null;
}

/** Kueri tanpa alias layanan tersebut (sisanya = sinyal layanan dalam cakupan, bila ada). */
export function withoutService(query: string, g: OosService): string {
  const drop = new Set(g.istilah.flatMap((t) => t.split(' ')));
  return rawTokens(query)
    .filter((t) => !drop.has(t.toLowerCase()))
    .join(' ');
}

/**
 * Layanan luar cakupan (mis. "SIM", "SKCK") yang disebut kueri dan tidak muncul di judul chunk mana pun;
 * null bila tidak ada. Jika judul korpus memuat salah satu aliasnya, layanannya ada di korpus.
 */
export function outOfScopeService(db: Db, query: string): OosService | null {
  const group = mentionedService(query);
  if (!group) return null;
  const titles = (db.prepare('SELECT DISTINCT judul FROM chunks').all() as { judul: string }[]).map((r) =>
    words(r.judul),
  );
  return titles.some((t) => group.istilah.some((a) => t.includes(` ${a} `))) ? null : group;
}

/** Alias kompatibel: istilah pertama yang disebut kueri, atau null. */
export function outOfScopeNoun(db: Db, query: string): string | null {
  const g = outOfScopeService(db, query);
  if (!g) return null;
  const q = words(query);
  return g.istilah.find((t) => q.includes(` ${t} `)) ?? null;
}
