import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Step-runner yang sama dengan ekstensi (`@urusin/executor/runner-ops`), dibungkus menjadi ekspresi yang
 * dievaluasi di isolated world CDP (bukan main world halaman: skrip situs tidak bisa menimpa fungsi runner).
 * Modul runner dijamin tanpa impor runtime; pembungkus menolak berkas yang melanggar itu.
 */
export function toInjectable(moduleSource: string): string {
  if (/^\s*import\s/m.test(moduleSource)) throw new Error('runner-ops tidak boleh punya impor runtime');
  const body = moduleSource
    .replace(/^\/\/# sourceMappingURL=.*$/m, '')
    .replace(/^export (?=(?:async )?function |const |let |class )/gm, '');
  if (/^\s*export\s/m.test(body)) throw new Error('bentuk ekspor runner-ops tidak dikenali');
  return `(() => {\n${body}\nreturn { runOp };\n})()`;
}

let cached: string | undefined;

export function runnerScript(): string {
  cached ??= toInjectable(
    readFileSync(fileURLToPath(import.meta.resolve('@urusin/executor/runner-ops')), 'utf8'),
  );
  return cached;
}

/** Ekspresi CDP Runtime.evaluate untuk satu op runner. */
export function runnerExpression(op: unknown): string {
  return `${runnerScript()}.runOp(${JSON.stringify(op)}, document)`;
}
