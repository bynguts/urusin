#!/usr/bin/env node
// Pemindai PII/secret untuk file yang akan di-commit.
//   node scripts/pii-scan.mjs --staged   (hook pre-commit: isi index git)
//   node scripts/pii-scan.mjs --all      (CI: semua file yang dilacak git)
// Baris yang sengaja memuat contoh sintetis boleh diberi penanda `pii-scan:allow`.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loadTeamEmails } from './lib/commit-rules.mjs';

/** Kode provinsi Kemendagri yang valid (2 digit pertama NIK). */
export const PROVINCE_CODES = new Set([
  '11',
  '12',
  '13',
  '14',
  '15',
  '16',
  '17',
  '18',
  '19',
  '21',
  '31',
  '32',
  '33',
  '34',
  '35',
  '36',
  '51',
  '52',
  '53',
  '61',
  '62',
  '63',
  '64',
  '65',
  '71',
  '72',
  '73',
  '74',
  '75',
  '76',
  '81',
  '82',
  '91',
  '92',
  '93',
  '94',
  '95',
  '96',
]);

// 16 digit yang tidak menempel pada digit lain.
const NIK_RE = /(?<!\d)(\d{16})(?!\d)/g;
// HP Indonesia: 08xx / 628xx / +628xx, total 9-13 digit nasional, boleh berpemisah spasi/titik/strip.
const PHONE_RE = /(?<![\w+])(?:\+62|62|0)[\s.-]?8[1-9](?:[\s.-]?\d){6,10}(?!\d)/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const PRIVATE_KEY_RE = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/g;

const ALLOW_MARKER = 'pii-scan:allow';
const STATIC_EMAIL_ALLOW = ['git@github.com'];
const SKIP_FILES = [/(^|\/)pnpm-lock\.yaml$/, /\.(png|jpe?g|gif|webp|ico|woff2?|pdf|zip)$/i];

/** NIK: PP KK CC DD MM YY NNNN; DD 01-31 (laki-laki) atau 41-71 (perempuan), MM 01-12. */
export function isNikLike(digits) {
  if (!/^\d{16}$/.test(digits)) return false;
  if (!PROVINCE_CODES.has(digits.slice(0, 2))) return false;
  const day = Number(digits.slice(6, 8));
  const month = Number(digits.slice(8, 10));
  const validDay = (day >= 1 && day <= 31) || (day >= 41 && day <= 71);
  return validDay && month >= 1 && month <= 12;
}

export function isAllowedEmail(email, teamEmails = []) {
  const lower = email.toLowerCase();
  const [local = '', domain = ''] = lower.split('@');
  if (domain === 'example.com' || domain.endsWith('.example.com')) return true;
  if (domain === 'example.org' || domain === 'example.net') return true;
  if (local === 'noreply' || local === 'no-reply') return true;
  if (domain === 'users.noreply.github.com') return true;
  return STATIC_EMAIL_ALLOW.includes(lower) || teamEmails.includes(lower);
}

export function mask(value) {
  if (value.length <= 4) return '****';
  return `${value.slice(0, 2)}${'*'.repeat(Math.max(4, value.length - 4))}${value.slice(-2)}`;
}

/**
 * Pindai teks. Mengembalikan temuan {kind, line, match} dengan nilai disamarkan.
 * @param {string} text
 * @param {{teamEmails?: string[]}} [opts]
 */
export function scanText(text, opts = {}) {
  const teamEmails = opts.teamEmails ?? [];
  const findings = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (line.includes(ALLOW_MARKER)) return;
    const push = (kind, value) => findings.push({ kind, line: i + 1, match: mask(value) });
    for (const m of line.matchAll(NIK_RE)) if (isNikLike(m[1])) push('nik', m[1]);
    for (const m of line.matchAll(PHONE_RE)) push('phone', m[0]);
    for (const m of line.matchAll(EMAIL_RE)) if (!isAllowedEmail(m[0], teamEmails)) push('email', m[0]);
    for (const m of line.matchAll(PRIVATE_KEY_RE)) push('private-key', m[0]);
  });
  return findings;
}

function git(args) {
  return execFileSync('git', args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
}

function listFiles(mode) {
  const out =
    mode === 'staged'
      ? git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
      : git(['ls-files', '-z']);
  return out.toString('utf8').split('\0').filter(Boolean);
}

function main(argv) {
  const mode = argv.includes('--all') ? 'all' : argv.includes('--staged') ? 'staged' : null;
  if (!mode) {
    console.error('pemakaian: node scripts/pii-scan.mjs --staged | --all');
    return 2;
  }
  const teamEmails = loadTeamEmails();
  let total = 0;
  for (const path of listFiles(mode)) {
    if (SKIP_FILES.some((re) => re.test(path))) continue;
    // --staged membaca isi index (yang benar-benar akan di-commit), --all membaca HEAD.
    let buf;
    try {
      buf = git(['show', mode === 'staged' ? `:${path}` : `HEAD:${path}`]);
    } catch {
      continue;
    }
    if (buf.includes(0)) continue; // file biner
    for (const f of scanText(buf.toString('utf8'), { teamEmails })) {
      total++;
      console.error(`${path}:${f.line}: ${f.kind} terdeteksi (${f.match})`);
    }
  }
  if (total > 0) {
    console.error(
      `\npii-scan: ${total} temuan. Hapus data pribadi/secret, atau tandai contoh sintetis dengan "${ALLOW_MARKER}".`,
    );
    return 1;
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(main(process.argv.slice(2)));
}
