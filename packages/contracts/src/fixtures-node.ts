import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UrusinEventSchema, type UrusinEvent } from './events.js';
import { parseFixture, type NamaSkemaFixture } from './fixtures.js';

/** Hanya Node (server/dev/test): membaca berkas di `fixtures/`. Jangan diimpor dari kode klien. */
export const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

export type NamaFixture = { layar: string; state: string; nama: string };

const NAMA = /^[a-z0-9-]+$/;

export function daftarFixture(dir = FIXTURES_DIR): NamaFixture[] {
  const hasil: NamaFixture[] = [];
  for (const layar of readdirSync(dir, { withFileTypes: true })) {
    if (!layar.isDirectory()) continue;
    for (const f of readdirSync(join(dir, layar.name))) {
      if (!f.endsWith('.json')) continue;
      const state = f.slice(0, -'.json'.length);
      hasil.push({ layar: layar.name, state, nama: `${layar.name}/${state}` });
    }
  }
  return hasil.sort((a, b) => a.nama.localeCompare(b.nama));
}

/** Baca + validasi satu fixture. `nama` = `layar/state`. Nama tidak valid → null (bukan melempar path traversal). */
export function bacaFixture(
  nama: string,
  dir = FIXTURES_DIR,
): { skema: NamaSkemaFixture; data: unknown } | null {
  const [layar, state, ...sisa] = nama.split('/');
  if (!layar || !state || sisa.length > 0 || !NAMA.test(layar) || !NAMA.test(state)) return null;
  try {
    return parseFixture(JSON.parse(readFileSync(join(dir, layar, `${state}.json`), 'utf8')));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

/** Skenario SSE = fixture ber-skema `sse`. */
export function bacaSkenarioSse(nama: string, dir = FIXTURES_DIR): UrusinEvent[] | null {
  const f = bacaFixture(nama, dir);
  if (!f || f.skema !== 'sse') return null;
  return UrusinEventSchema.array().parse(f.data);
}
