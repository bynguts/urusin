import { resolve } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../..');
const eslint = new ESLint({ cwd: root });
const rules = async (code: string, file: string) => {
  const [res] = await eslint.lintText(code, { filePath: resolve(root, file) });
  return (res?.messages ?? []).map((m) => m.ruleId);
};

describe('lint: HTTP keluar server hanya lewat @urusin/egress', () => {
  it.each([
    [
      'packages/rag/src/contoh.ts',
      `export const f = () => fetch('http://127.0.0.1:2019/load');\n`,
      'no-restricted-globals',
    ],
    [
      'apps/web/src/lib/server/contoh.ts',
      `export const f = () => globalThis.fetch('http://x');\n`,
      'no-restricted-properties',
    ],
    [
      'apps/web/src/routes/api/x/+server.ts',
      `import { request } from 'undici';\nexport const f = request;\n`,
      'no-restricted-imports',
    ],
    [
      'packages/llm/src/contoh.ts',
      `import http from 'node:http';\nexport const f = http.request;\n`,
      'no-restricted-imports',
    ],
    [
      'packages/harness/src/contoh.ts',
      `import { request } from 'https';\nexport const f = request;\n`,
      'no-restricted-imports',
    ],
  ])(
    '%s ditolak',
    async (file, code, rule) => {
      expect(await rules(code, file)).toContain(rule);
    },
    30_000,
  );

  it('modul egress, file tes, dan kode klien tidak terkena aturan', async () => {
    const code = `export const f = () => fetch('https://api.jina.ai/');\n`;
    expect(await rules(code, 'packages/egress/src/contoh.ts')).toEqual([]);
    expect(await rules(code, 'packages/rag/src/contoh.test.ts')).toEqual([]);
    expect(await rules(code, 'apps/web/src/lib/stores/contoh.svelte.ts')).toEqual([]);
  }, 30_000);

  it('larangan SDK vendor lain tetap berlaku di kode server', async () => {
    const vendor = ['@anthropic', 'ai'].join('-');
    expect(
      await rules(`import X from '${vendor}/sdk';\nexport default X;\n`, 'packages/rag/src/contoh.ts'),
    ).toContain('no-restricted-imports');
  }, 30_000);
});
