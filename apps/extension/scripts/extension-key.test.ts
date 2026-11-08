import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error modul .mjs tanpa tipe
import { deriveExtensionId } from './extension-key.mjs';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('ID ekstensi dipin', () => {
  const id: string = deriveExtensionId(read('../manifest-key.pub'));

  it('berformat ID Chrome (32 huruf a-p)', () => {
    expect(id).toMatch(/^[a-p]{32}$/);
  });

  it('sama dengan PUBLIC_EXTENSION_ID di .env.example', () => {
    const env = read('../../../.env.example');
    expect(/^PUBLIC_EXTENSION_ID=(.+)$/m.exec(env)?.[1]).toBe(id);
  });

  it('menolak kunci yang bukan SPKI valid', () => {
    expect(() => deriveExtensionId('bukan-kunci')).toThrow();
  });
});
