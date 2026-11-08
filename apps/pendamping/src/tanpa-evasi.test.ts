import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Pagar ADR 0025/0028: peramban pendamping tidak boleh menyamar. Kode produksi apps/pendamping dilarang
 * menimpa agen pengguna, membuang flag otomasi bawaan, atau memakai plugin stealth.
 */
const LARANGAN: [RegExp, string][] = [
  [/\buserAgent\s*:/, 'menimpa userAgent'],
  [/setUserAgentOverride|Emulation\.setUserAgent/, 'menimpa userAgent lewat CDP'],
  [/\bignoreDefaultArgs\b/, 'membuang argumen bawaan Playwright'],
  [/enable-automation/, 'menyentuh flag --enable-automation'],
  [/AutomationControlled/, 'menyembunyikan AutomationControlled'],
  [/\bwebdriver\b/, 'memanipulasi navigator.webdriver'],
  [/stealth|undetected|puppeteer-extra/i, 'plugin stealth/anti-deteksi'],
  [/addInitScript/, 'menyuntik skrip ke dunia halaman'],
];

/** Buang komentar agar dokumentasi larangan tidak dihitung sebagai pelanggaran. */
const tanpaKomentar = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

function sumber(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sumber(join(dir, e.name))
      : /\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)
        ? [join(dir, e.name)]
        : [],
  );
}

describe('tanpa evasi', () => {
  const root = join(import.meta.dirname, '..');
  const files = [...sumber(join(root, 'src')), join(root, 'Dockerfile'), join(root, 'package.json')];

  it('kode produksi tidak menimpa UA, flag otomasi, atau memakai stealth', () => {
    const temuan: string[] = [];
    for (const f of files) {
      const mentah = readFileSync(f, 'utf8');
      const isi = f.endsWith('Dockerfile') ? mentah.replace(/^\s*#.*$/gm, '') : tanpaKomentar(mentah);
      for (const [re, alasan] of LARANGAN) if (re.test(isi)) temuan.push(`${f}: ${alasan}`);
    }
    expect(temuan).toEqual([]);
  });

  it('pagar benar-benar menangkap pola terlarang', () => {
    const contoh = `const c = await browser.newContext({ userAgent: 'x' });\nchromium.launch({ ignoreDefaultArgs: ['--enable-automation'] });`;
    const kena = LARANGAN.filter(([re]) => re.test(tanpaKomentar(contoh))).map(([, a]) => a);
    expect(kena).toEqual(
      expect.arrayContaining([
        'menimpa userAgent',
        'membuang argumen bawaan Playwright',
        'menyentuh flag --enable-automation',
      ]),
    );
    expect(LARANGAN.some(([re]) => re.test(tanpaKomentar('// userAgent: dilarang')))).toBe(false);
  });
});
