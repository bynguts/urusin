import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import TeksKaya from './TeksKaya.svelte';

const html = (teks: string) =>
  render(TeksKaya, { props: { teks } })
    .body.replace(/<!--[^>]*-->/g, '')
    .replace(/\s+/g, ' ');

describe('TeksKaya', () => {
  it('paragraf, daftar bernomor, tebal, dan tautan aman', () => {
    const b = html(
      'Syaratnya:\n\n1. **KTP-el** asli\n2. KK di https://contoh.go.id/kk\n\n## Catatan\n- *gratis*',
    );
    expect(b).toContain('<p>Syaratnya:</p>');
    expect(b).toMatch(/<ol start="1" role="list"[^>]*><li[^>]*><span aria-hidden="true"[^>]*>1\.<\/span>/);
    expect(b).toContain('<strong class="font-semibold text-ink">KTP-el</strong> asli');
    expect(b).toMatch(
      /<a href="https:\/\/contoh\.go\.id\/kk" target="_blank" rel="noopener noreferrer nofollow"/,
    );
    expect(b).toMatch(/<h3[^>]*>Catatan<\/h3>/);
    expect(b).toMatch(/<ul class="list-disc[^"]*"><li class="pl-1"><em>gratis<\/em>/);
  });

  it('HTML dari model di-escape, tidak dirender; baris baru jadi <br>', () => {
    const b = html('<img src=x onerror=alert(1)>\n<script>alert(1)</script>');
    expect(b).not.toContain('<img');
    expect(b).not.toContain('<script');
    expect(b).toContain('&lt;img');
    expect(b).toContain('<br/>');
  });

  it('render server tanpa efek mengetik: isi utuh, tidak aria-busy', () => {
    const b = html('Bawa **KK** ya.');
    expect(b).not.toContain('aria-busy');
    expect(b).toContain('Bawa <strong');
  });
});
