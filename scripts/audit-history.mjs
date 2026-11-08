#!/usr/bin/env node
// Audit riwayat git: author ∈ allowlist, header Conventional Commits, tanpa atribusi AI.
//   URUSIN_AUTHOR_EMAILS="a@x,b@y" node scripts/audit-history.mjs [rentang-revisi]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { checkCommitMessage, loadTeamEmails } from './lib/commit-rules.mjs';

const FS = '\x1f';
const RS = '\x1e';

export function parseLog(raw) {
  return raw
    .split(RS)
    .map((r) => r.replace(/^\r?\n/, ''))
    .filter((r) => r.trim() !== '')
    .map((record) => {
      const [hash = '', email = '', name = '', body = ''] = record.split(FS);
      return { hash, email: email.toLowerCase(), name, message: body.trim() };
    });
}

/** Hash commit lama yang dikecualikan dari aturan format header (lihat audit-exceptions.json). */
export function loadHeaderExceptions(path = new URL('./audit-exceptions.json', import.meta.url)) {
  return Object.keys(JSON.parse(readFileSync(path, 'utf8')).headerFormat ?? {});
}

export function auditCommits(commits, allowedEmails, headerExceptions = []) {
  const allowed = allowedEmails.map((e) => e.toLowerCase());
  const exempt = new Set(headerExceptions.map((h) => h.toLowerCase()));
  const violations = [];
  for (const c of commits) {
    if (!allowed.includes(c.email)) {
      violations.push({ hash: c.hash, problem: `author tidak ada di allowlist: ${c.email}` });
    }
    for (const problem of checkCommitMessage(c.message)) {
      if (exempt.has(c.hash.toLowerCase()) && problem.startsWith('header tidak mengikuti')) continue;
      violations.push({ hash: c.hash, problem });
    }
  }
  return violations;
}

function main(argv) {
  const range = argv[0] ?? 'HEAD';
  const allowed = process.env.URUSIN_AUTHOR_EMAILS
    ? process.env.URUSIN_AUTHOR_EMAILS.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : loadTeamEmails();
  const raw = execFileSync('git', ['log', `--format=%H${FS}%ae${FS}%an${FS}%B${RS}`, range], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const commits = parseLog(raw);
  const violations = auditCommits(commits, allowed, loadHeaderExceptions());
  for (const v of violations) console.error(`${v.hash.slice(0, 7)}: ${v.problem}`);
  if (violations.length > 0) {
    console.error(`\naudit-history: ${violations.length} pelanggaran pada ${commits.length} commit.`);
    return 1;
  }
  console.log(
    `audit-history: ${commits.length} commit lolos (author terdaftar, prefix konvensional, tanpa atribusi AI).`,
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(main(process.argv.slice(2)));
}
