import { z } from 'zod';
import { ErrorCode } from './errors.js';
import { detectPii } from './pii.js';

/**
 * Grammar placeholder (hanya boleh ditulis sebagai literal di langkah adapter, tidak oleh LLM):
 *
 *   placeholder := "{{" ( vaultRef | fileRef ) "}}"
 *   vaultRef    := NAME ( "." NAME )+          contoh: {{PEMOHON.NIK}}, {{ANAK.AYAH.NAMA}}
 *   fileRef     := "FILE:" ident               contoh: {{FILE:item}}, {{FILE:KTP}}
 *   NAME        := [A-Z][A-Z0-9_]*
 *   ident       := [A-Za-z][A-Za-z0-9_]*
 *
 * Nilai asli diisi dari vault di sisi eksekutor, sehingga PII tidak pernah lewat model.
 */
const NAME = '[A-Z][A-Z0-9_]*';
const IDENT = '[A-Za-z][A-Za-z0-9_]*';
const BODY = `(?:${NAME}(?:\\.${NAME})+|FILE:${IDENT})`;

export const PLACEHOLDER_RE = new RegExp(`\\{\\{(${BODY})\\}\\}`, 'g');
const EXACT_RE = new RegExp(`^\\{\\{(${BODY})\\}\\}$`);

export type Placeholder =
  | { kind: 'vault'; namespace: string; path: string[]; raw: string }
  | { kind: 'file'; name: string; raw: string };

export function parsePlaceholder(token: string): Placeholder | null {
  const m = EXACT_RE.exec(token);
  if (!m?.[1]) return null;
  const body = m[1];
  if (body.startsWith('FILE:')) return { kind: 'file', name: body.slice(5), raw: token };
  const [namespace = '', ...path] = body.split('.');
  return { kind: 'vault', namespace, path, raw: token };
}

export function isPlaceholder(value: string): boolean {
  return EXACT_RE.test(value);
}

/** Semua placeholder valid di dalam teks. */
export function findPlaceholders(text: string): Placeholder[] {
  return [...text.matchAll(PLACEHOLDER_RE)].map((m) => parsePlaceholder(m[0])).filter((p) => p !== null);
}

/** True bila ada `{{` atau `}}` yang bukan bagian dari placeholder valid. */
export function hasMalformedPlaceholder(text: string): boolean {
  const stripped = text.replace(PLACEHOLDER_RE, '');
  return stripped.includes('{{') || stripped.includes('}}');
}

/** Builder placeholder vault yang tervalidasi: placeholder('PEMOHON', 'NIK') → "{{PEMOHON.NIK}}". */
export function placeholder(namespace: string, ...path: string[]): string {
  const token = `{{${[namespace, ...path].join('.')}}}`;
  if (!isPlaceholder(token)) throw new Error(`placeholder tidak valid: ${token}`);
  return token;
}

export function filePlaceholder(name: string): string {
  const token = `{{FILE:${name}}}`;
  if (!isPlaceholder(token)) throw new Error(`placeholder file tidak valid: ${token}`);
  return token;
}

export type GuardIssue = { code: ErrorCode; path: (string | number)[]; message: string };

/** Telusuri nilai apa pun (string/array/objek) dan kumpulkan pelanggaran guard. */
export function findGuardIssues(value: unknown, path: (string | number)[] = []): GuardIssue[] {
  if (typeof value === 'string') {
    const issues: GuardIssue[] = [];
    if (value.includes('{{') || value.includes('}}')) {
      issues.push({
        code: ErrorCode.PLACEHOLDER_IN_LLM_PARAM,
        path,
        message: 'parameter dari model tidak boleh memuat placeholder "{{ }}"',
      });
    }
    const pii = detectPii(value);
    if (pii.length > 0) {
      issues.push({
        code: ErrorCode.PII_IN_LLM_PARAM,
        path,
        message: `parameter dari model memuat data pribadi (${pii.join(', ')})`,
      });
    }
    return issues;
  }
  if (Array.isArray(value)) return value.flatMap((v, i) => findGuardIssues(v, [...path, i]));
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => [
      ...findGuardIssues(k, [...path, k]),
      ...findGuardIssues(v, [...path, k]),
    ]);
  }
  return [];
}

/**
 * Refinement zod untuk parameter yang ditulis LLM: tolak placeholder, `{{`/`}}`, NIK, HP, email.
 * Pakai: `z.object({...}).superRefine(noPlaceholder())` atau `z.string().superRefine(noPlaceholder())`.
 */
export function noPlaceholder() {
  return (value: unknown, ctx: z.RefinementCtx): void => {
    for (const issue of findGuardIssues(value)) {
      ctx.addIssue({
        code: 'custom',
        message: issue.message,
        path: issue.path,
        params: { urusinCode: issue.code },
      });
    }
  };
}

/** String aman untuk parameter yang ditulis LLM. */
export const llmText = () => z.string().superRefine(noPlaceholder());
