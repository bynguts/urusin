#!/usr/bin/env node
// Migrasi harus aditif setelah rilis kandidat: berkas migrasi yang DITAMBAHKAN sejak tag dasar (default rc1)
// tidak boleh memuat DROP, RENAME, atau ALTER ... DROP, supaya image rc1 tetap bisa membaca DB hasil migrasi HEAD.
// Tag dasar belum ada -> dicatat jelas dan keluar 0 (bukan lolos palsu: tidak ada yang diperiksa).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DESTRUCTIVE = /\b(DROP|RENAME)\b/i; // ALTER ... DROP tertangkap lewat DROP
// Skema inline (bukan berkas migrations/): yang diperiksa hanya baris yang ditambahkan sejak tag dasar.
const SCHEMA_FILES = ['packages/harness/src/db.ts'];
const MIGRATION_FILE = /(^|\/)migrations?\/.+\.(sql|ts|js|mjs|cjs)$/;

export function isMigrationFile(path) {
  return MIGRATION_FILE.test(path);
}

/** Baris yang memuat pernyataan destruktif (nomor baris dan isi). */
export function findDestructive(text) {
  return text
    .split(/\r?\n/)
    .map((line, i) => ({ line: i + 1, text: line.trim() }))
    .filter((l) => DESTRUCTIVE.test(l.text));
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function main() {
  const base = process.argv[2] ?? 'rc1';
  try {
    git('rev-parse', '-q', '--verify', `refs/tags/${base}`);
  } catch {
    console.log(`check-additive-migrations: tag ${base} belum ada, tidak ada yang diperiksa (dilewati).`);
    return 0;
  }
  let failed = 0;
  for (const file of SCHEMA_FILES) {
    const diff = git('diff', '-U0', `refs/tags/${base}..HEAD`, '--', file);
    const plus = diff
      .split(/\r?\n/)
      .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
      .map((l) => l.slice(1))
      .join('\n');
    for (const { text } of findDestructive(plus)) {
      console.error(`${file}: skema tidak aditif sejak ${base} (${text})`);
      failed++;
    }
  }
  const added = git('diff', '--name-only', '--diff-filter=A', `refs/tags/${base}..HEAD`)
    .split('\n')
    .filter((p) => p && isMigrationFile(p));
  if (added.length === 0) {
    console.log(
      `check-additive-migrations: tidak ada berkas migrasi baru sejak ${base}, ${failed} pelanggaran skema.`,
    );
    return failed === 0 ? 0 : 1;
  }
  for (const file of added) {
    for (const { line, text } of findDestructive(readFileSync(file, 'utf8'))) {
      console.error(`${file}:${line}: migrasi tidak aditif (${text})`);
      failed++;
    }
  }
  console.log(
    `check-additive-migrations: ${added.length} migrasi baru sejak ${base}, ${failed} pelanggaran.`,
  );
  return failed === 0 ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(main());
