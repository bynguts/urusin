#!/usr/bin/env node
// Gagal bila ada `uses:` di .github/workflows yang tidak dipin ke commit SHA 40 karakter.
// Action lokal (./...) dikecualikan; `docker://` harus dipin dengan digest @sha256.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA_REF = /@[0-9a-f]{40}$/;
const DIGEST_REF = /@sha256:[0-9a-f]{64}$/;

/** Daftar `uses:` yang belum dipin dari isi satu file workflow. */
export function findUnpinned(text) {
  const bad = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const m = /^\s*(?:-\s*)?uses:\s*["']?([^\s"'#]+)/.exec(line);
    if (!m) return;
    const ref = m[1];
    if (ref.startsWith('./')) return;
    const ok = ref.startsWith('docker://') ? DIGEST_REF.test(ref) : SHA_REF.test(ref);
    if (!ok) bad.push({ line: i + 1, ref });
  });
  return bad;
}

function main() {
  const dir = resolve(process.argv[2] ?? '.github/workflows');
  let failed = 0;
  let total = 0;
  for (const f of readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
    const text = readFileSync(join(dir, f), 'utf8');
    total += text.split(/\r?\n/).filter((l) => /^\s*(?:-\s*)?uses:/.test(l)).length;
    for (const { line, ref } of findUnpinned(text)) {
      console.error(`${f}:${line}: "${ref}" tidak dipin ke commit SHA 40 karakter`);
      failed++;
    }
  }
  console.log(`check-action-pins: ${total} \`uses:\` diperiksa, ${failed} belum dipin.`);
  return failed === 0 ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(main());
