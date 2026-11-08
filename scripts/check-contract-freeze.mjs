#!/usr/bin/env node
// Pembekuan kontrak: bandingkan skema zod @urusin/contracts di HEAD dengan tag dasar (default contracts-take1).
// Lolos: perubahan aditif. Gagal: properti/ekspor dihapus atau diganti nama, tipe menyempit, enum dikurangi,
// batas diperketat. Tag belum ada -> dicatat jelas dan keluar 0 (tidak ada yang dibandingkan).
// Prasyarat: `pnpm --filter @urusin/contracts build` sudah dijalankan (membaca packages/contracts/dist).
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { diffContracts } from './lib/contract-diff.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const PKG = join(ROOT, 'packages', 'contracts');

// zod di-resolve dari paket kontrak (root repo tidak bergantung langsung pada zod).
const { z } = await import(pathToFileURL(createRequire(join(PKG, 'package.json')).resolve('zod')).href);

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

/** Semua ekspor yang berupa skema zod -> JSON Schema (mode input, draft-7). */
export function collectSchemas(mod) {
  const out = {};
  for (const [name, value] of Object.entries(mod)) {
    if (value && typeof value === 'object' && typeof value.safeParse === 'function') {
      try {
        out[name] = z.toJSONSchema(value, { target: 'draft-7', io: 'input', unrepresentable: 'any' });
      } catch {
        // skema yang tidak bisa direpresentasikan dilewati
      }
    }
  }
  return out;
}

/** Bangun sumber kontrak pada tag ke folder sementara di dalam paket (agar `zod` ter-resolve) lalu muat. */
async function loadTagSchemas(tag) {
  const tmp = join(PKG, '.freeze-tmp');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(join(tmp, 'src'), { recursive: true });
  try {
    const files = git('ls-tree', '-r', '--name-only', tag, '--', 'packages/contracts/src')
      .split('\n')
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    if (files.length === 0) throw new Error(`tag ${tag} tidak memuat packages/contracts/src`);
    for (const f of files) {
      const content = execFileSync('git', ['show', `${tag}:${f}`], {
        cwd: ROOT,
        maxBuffer: 16 * 1024 * 1024,
      });
      const dest = join(tmp, 'src', f.slice('packages/contracts/src/'.length));
      mkdirSync(join(dest, '..'), { recursive: true });
      writeFileSync(dest, content);
    }
    writeFileSync(
      join(tmp, 'tsconfig.json'),
      JSON.stringify({
        extends: '../tsconfig.json',
        compilerOptions: {
          rootDir: 'src',
          outDir: 'dist',
          declaration: false,
          declarationMap: false,
          noEmit: false,
        },
        include: ['src'],
      }),
    );
    execFileSync(
      process.execPath,
      [join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(tmp, 'tsconfig.json')],
      {
        cwd: PKG,
        stdio: 'inherit',
      },
    );
    return collectSchemas(await import(pathToFileURL(join(tmp, 'dist', 'index.js')).href));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  const tag = process.argv[2] ?? 'contracts-take1';
  try {
    git('rev-parse', '-q', '--verify', `refs/tags/${tag}`);
  } catch {
    console.log(`check-contract-freeze: tag ${tag} belum ada, tidak ada yang dibandingkan (dilewati).`);
    return 0;
  }
  const oldSchemas = await loadTagSchemas(`refs/tags/${tag}`);
  const head = collectSchemas(await import(pathToFileURL(join(PKG, 'dist', 'index.js')).href));
  const violations = diffContracts(oldSchemas, head);
  for (const v of violations) console.error(`${v.path || '<akar>'}: ${v.message}`);
  const n = Object.keys(oldSchemas).length;
  console.log(
    `check-contract-freeze: ${n} skema pada ${tag} dibandingkan dengan HEAD, ${violations.length} pelanggaran.`,
  );
  return violations.length === 0 ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
