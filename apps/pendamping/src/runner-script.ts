import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Step-runner yang sama dengan ekstensi (`@urusin/executor/runner-ops`), dibungkus menjadi ekspresi yang
 * dievaluasi di isolated world CDP (bukan main world halaman: skrip situs tidak bisa menimpa fungsi runner).
 * Modul runner dijamin tanpa impor runtime; pembungkus menolak berkas yang melanggar itu. Satu-satunya
 * pengecualian: impor relatif antar modul runner yang ikut digabung (klasifikasi, amatan) dibuang, karena
 * semuanya berada di satu cakupan skrip.
 */
const MODUL_GABUNGAN = ['klasifikasi', 'amatan'] as const;
const RE_IMPOR_SAUDARA = new RegExp(
  String.raw`^import\s*\{[^}]*\}\s*from\s*'\./(?:${MODUL_GABUNGAN.join('|')})\.js';?[ \t]*$`,
  'gm',
);

export function toInjectable(moduleSource: string): string {
  const tanpaSaudara = moduleSource.replace(RE_IMPOR_SAUDARA, '');
  if (/^\s*import\s/m.test(tanpaSaudara)) throw new Error('runner-ops tidak boleh punya impor runtime');
  const body = tanpaSaudara
    .replace(/^\/\/# sourceMappingURL=.*$/gm, '')
    .replace(/^export (?=(?:async )?function |const |let |class )/gm, '');
  if (/^\s*export\s/m.test(body)) throw new Error('bentuk ekspor runner-ops tidak dikenali');
  return `(() => {\n${body}\nreturn { runOp };\n})()`;
}

let cached: string | undefined;

const bacaModul = (nama: string) =>
  readFileSync(fileURLToPath(import.meta.resolve(`@urusin/executor/${nama}`)), 'utf8');

export function runnerScript(): string {
  // Urutan penting: modul yang dipakai runner-ops dideklarasikan lebih dulu di cakupan yang sama.
  cached ??= toInjectable([...MODUL_GABUNGAN, 'runner-ops'].map(bacaModul).join('\n'));
  return cached;
}

/** Ekspresi CDP Runtime.evaluate untuk satu op runner. */
export function runnerExpression(op: unknown): string {
  return `${runnerScript()}.runOp(${JSON.stringify(op)}, document)`;
}
