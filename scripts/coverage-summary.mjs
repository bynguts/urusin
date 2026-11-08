// Cetak ringkasan coverage per paket dari packages/*/coverage/coverage-summary.json
// (dihasilkan `pnpm coverage` lewat vitest v8). Hanya membaca; tidak mengubah berkas.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgsDir = join(fileURLToPath(new URL('..', import.meta.url)), 'packages');
const KEYS = ['lines', 'statements', 'functions', 'branches'];

const rows = [];
for (const name of readdirSync(pkgsDir).sort()) {
  const file = join(pkgsDir, name, 'coverage', 'coverage-summary.json');
  if (!existsSync(file)) continue;
  const { total } = JSON.parse(readFileSync(file, 'utf8'));
  rows.push([`@urusin/${name}`, ...KEYS.map((k) => `${total[k].pct.toFixed(2)}%`)]);
}

if (rows.length === 0) {
  console.error('Tidak ada coverage-summary.json. Jalankan `pnpm coverage`.');
  process.exit(1);
}

const header = ['paket', ...KEYS];
const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
const fmt = (r) => r.map((c, i) => c.padEnd(widths[i])).join('  ');
console.log(['', fmt(header), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(fmt), ''].join('\n'));
