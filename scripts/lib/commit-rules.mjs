// Aturan pesan commit bersama: dipakai hook commit-msg, commitlint, dan audit-history.
import { readFileSync } from 'node:fs';

export const CONVENTIONAL_TYPES = [
  'build',
  'chore',
  'ci',
  'docs',
  'feat',
  'fix',
  'perf',
  'refactor',
  'revert',
  'style',
  'test',
];

const HEADER_RE = new RegExp(String.raw`^(${CONVENTIONAL_TYPES.join('|')})(\([a-z0-9._/-]+\))?!?: (\S.*)$`);

/** Subjek yang tidak bermakna bila berdiri sendiri. */
export const BANNED_SUBJECT_RE = /^(update|updates|updated|test|tests|testing|final|wip)[.!]?$/i;

/** Jejak atribusi AI yang tidak boleh ada di pesan commit (keputusan tim). */
const ATTRIBUTION_RES = [/co-authored-by\s*:/i, /generated with \[?claude code/i];

export function loadTeamEmails(path = new URL('../team-emails.json', import.meta.url)) {
  return JSON.parse(readFileSync(path, 'utf8')).authors.map((e) => e.toLowerCase());
}

/** Buang baris komentar git (`#`) dan diff verbose di bawah garis gunting. */
export function stripGitComments(raw) {
  const scissors = raw.indexOf('# ------------------------ >8 ------------------------');
  const body = scissors >= 0 ? raw.slice(0, scissors) : raw;
  return body
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('#'))
    .join('\n')
    .trim();
}

export function isBannedSubject(subject) {
  return BANNED_SUBJECT_RE.test(subject.trim());
}

export function hasAiAttribution(message) {
  return ATTRIBUTION_RES.some((re) => re.test(message));
}

/**
 * Periksa satu pesan commit. Mengembalikan daftar pelanggaran (kosong = lolos).
 * @param {string} message
 */
export function checkCommitMessage(message) {
  const problems = [];
  const header = message.split(/\r?\n/)[0] ?? '';
  // Commit merge/revert otomatis git tidak dihasilkan oleh alur kerja tim, jadi tetap diperiksa.
  const match = HEADER_RE.exec(header);
  if (!match) {
    problems.push(`header tidak mengikuti Conventional Commits: "${header}"`);
  } else if (isBannedSubject(match[3])) {
    problems.push(`subjek tidak bermakna: "${match[3]}"`);
  }
  if (hasAiAttribution(message)) {
    problems.push('pesan memuat trailer Co-Authored-By atau atribusi AI');
  }
  return problems;
}
