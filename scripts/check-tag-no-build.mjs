#!/usr/bin/env node
// Gagal bila sebuah job yang hanya berjalan pada tag (`if:` memuat ref_type == 'tag') membangun image.
// Rilis tag hanya boleh mengalias digest image :<sha> yang sudah diuji di main (aturan A-B4), tidak boleh build ulang.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const BUILD_STEP = /^\s*(?:-\s*)?uses:\s*["']?(docker\/build-push-action|docker\/bake-action)@/;
const BUILD_CMD = /\b(?:docker\s+(?:buildx\s+)?build|docker\s+buildx\s+bake|docker\s+build)\b/;
const TAG_IF = /^\s{4}if:.*ref_type\s*==\s*['"]tag['"]/;

/** Daftar { job, line, text } langkah build di dalam job khusus tag pada satu file workflow. */
export function findTagBuilds(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (start === -1) return [];
  const jobs = [];
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(lines[i]);
    if (m) jobs.push({ name: m[1], from: i, to: lines.length });
    else if (/^\S/.test(lines[i]) && lines[i].trim() !== '' && !lines[i].startsWith('#')) break;
  }
  jobs.forEach((j, k) => {
    if (k + 1 < jobs.length) j.to = jobs[k + 1].from;
  });
  const out = [];
  for (const j of jobs) {
    const block = lines.slice(j.from, j.to);
    if (!block.some((l) => TAG_IF.test(l))) continue;
    block.forEach((l, k) => {
      const code = l.replace(/\s+#.*$/, '');
      if (BUILD_STEP.test(code) || (/^\s+/.test(code) && !/^\s*#/.test(l) && BUILD_CMD.test(code))) {
        out.push({ job: j.name, line: j.from + k + 1, text: l.trim() });
      }
    });
  }
  return out;
}

function main() {
  const dir = resolve(process.argv[2] ?? '.github/workflows');
  let failed = 0;
  for (const f of readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
    for (const v of findTagBuilds(readFileSync(join(dir, f), 'utf8'))) {
      console.error(
        `${f}:${v.line}: job tag "${v.job}" membangun image (${v.text}); tag hanya boleh alias digest`,
      );
      failed++;
    }
  }
  console.log(`check-tag-no-build: ${failed} langkah build pada job tag.`);
  return failed === 0 ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(main());
