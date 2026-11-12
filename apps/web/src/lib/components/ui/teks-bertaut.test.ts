import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import TeksBertaut from './TeksBertaut.svelte';

const html = (teks: string) => render(TeksBertaut, { props: { teks } }).body.replace(/<!--[^>]*-->/g, '');

describe('TeksBertaut', () => {
  it('URL jadi <a> biru (kelas tautan), tab baru, rel noopener noreferrer nofollow', () => {
    const b = html('Daftar di https://contoh.go.id/daftar.');
    expect(b).toMatch(
      /<a href="https:\/\/contoh\.go\.id\/daftar" target="_blank" rel="noopener noreferrer nofollow" class="tautan[^"]*">https:\/\/contoh\.go\.id\/daftar/,
    );
    expect(b).toContain('(buka di tab baru)');
    expect(b).toMatch(/<\/a>\.$/m);
  });

  it('HTML di teks AI di-escape, bukan dirender; javascript: tetap teks', () => {
    const b = html('<img src=x onerror=alert(1)> javascript:alert(1)');
    expect(b).not.toContain('<img');
    expect(b).toContain('&lt;img');
    expect(b).not.toContain('<a');
  });
});
