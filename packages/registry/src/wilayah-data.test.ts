import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// pii-scan melewati wilayah-data.ts dengan alasan ia hasil generator dari JSON yang dipindai (termasuk
// data/wilayah/kanal-layanan.json). Tes ini menjaga alasan itu: berkas yang di-commit harus identik dengan keluaran
// generator, jadi nomor/email tidak bisa disisipkan tangan langsung ke sana.
describe('wilayah-data.ts', () => {
  it('identik dengan keluaran scripts/gen-wilayah.mjs', () => {
    const skrip = fileURLToPath(new URL('../scripts/gen-wilayah.mjs', import.meta.url));
    expect(() => execFileSync(process.execPath, [skrip, '--check'], { stdio: 'pipe' })).not.toThrow();
  }, 60_000);
});
