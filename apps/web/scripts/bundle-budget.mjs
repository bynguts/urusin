#!/usr/bin/env node
// Anggaran performa (perubahan rencana v6): JS awal setiap rute di perf-routes.cjs ≤ 70 KB gzip.
// Menjalankan hasil `vite build` (adapter-node), mengambil HTML tiap rute, lalu menjumlahkan ukuran gzip
// setiap file JS yang dirujuk HTML (modulepreload + import entry) persis seperti yang diunduh peramban.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = resolve(import.meta.dirname, '..');
const CLIENT_DIR = join(ROOT, 'build', 'client');
const LIMIT_KB = Number(process.env.BUDGET_JS_KB ?? 70);
const { ROUTES } = createRequire(import.meta.url)('../../../perf-routes.cjs');
const ROUTE_LIST = process.env.BUDGET_ROUTE ? [process.env.BUDGET_ROUTE] : ROUTES;

function freePort() {
  return new Promise((ok, fail) => {
    const srv = createServer();
    srv.once('error', fail);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => ok(port));
    });
  });
}

async function waitFor(url, timeoutMs = 15_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // server belum siap
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`server tidak merespons: ${url}`);
}

/** Path aset JS yang dirujuk HTML (atribut href/src dan import() di skrip inline). */
export function referencedScripts(html) {
  const found = new Set();
  for (const m of html.matchAll(
    /["'(]((?:\.{1,2}\/|\/)?(?:[\w.-]+\/)*_app\/immutable\/[\w./-]+\.js)["')]/g,
  )) {
    found.add(m[1].replace(/^(\.{1,2}\/)+/, '').replace(/^\//, ''));
  }
  return [...found].sort();
}

async function main() {
  if (!existsSync(join(ROOT, 'build', 'index.js'))) {
    console.error('budget: build/ tidak ada. Jalankan `pnpm build` dulu.');
    return 2;
  }
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['build'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', ORIGIN: origin },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  try {
    await waitFor(`${origin}/api/health`);
    let failed = 0;
    for (const route of ROUTE_LIST) {
      const res = await fetch(`${origin}${route}`);
      if (!res.ok) {
        console.log(`budget: rute ${route} membalas HTTP ${res.status} → GAGAL`);
        failed++;
        continue;
      }
      const scripts = referencedScripts(await res.text());
      if (scripts.length === 0) {
        console.log(`budget: rute ${route} tidak memuat JS klien (0 KB) → LOLOS`);
        continue;
      }
      let total = 0;
      for (const rel of scripts) {
        const gz = gzipSync(readFileSync(join(CLIENT_DIR, rel)), { level: 9 }).length;
        total += gz;
        console.log(`  ${(gz / 1024).toFixed(2).padStart(7)} KB  ${rel}`);
      }
      const kb = total / 1024;
      const ok = kb <= LIMIT_KB;
      console.log(
        `budget: JS awal ${route} = ${kb.toFixed(2)} KB gzip (${scripts.length} file), batas ${LIMIT_KB} KB → ${ok ? 'LOLOS' : 'GAGAL'}`,
      );
      if (!ok) failed++;
    }
    console.log(`budget: ${ROUTE_LIST.length} rute diperiksa, ${failed} gagal.`);
    return failed === 0 ? 0 : 1;
  } finally {
    server.kill();
  }
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
