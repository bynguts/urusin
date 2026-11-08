const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#039': "'",
};

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    const low = e.toLowerCase();
    if (low.startsWith('#x')) return String.fromCodePoint(parseInt(low.slice(2), 16));
    if (low.startsWith('#') && /^#\d+$/.test(low) && low !== '#039') return String.fromCodePoint(Number(low.slice(1)));
    return ENTITIES[low] ?? m;
  });
}

/**
 * HTML -> teks ber-heading ("# judul"). Membuang script/style/nav/header/footer/form; baris tabel
 * dipertahankan sebagai satu baris "sel | sel". Hasil adalah data tak tepercaya.
 */
export function htmlToText(html: string): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(head|script|style|noscript|nav|header|footer|form|svg|iframe)\b[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, lvl: string, inner: string) => {
    const t = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return t ? `\n\n${'#'.repeat(Number(lvl))} ${t}\n\n` : '\n';
  });
  s = s.replace(/<\/t[dh]>\s*<t[dh]\b[^>]*>/gi, ' | ').replace(/<\/tr>/gi, '\n');
  s = s.replace(/<li\b[^>]*>/gi, '\n- ').replace(/<\/(p|div|ul|ol|table|section|article)>|<br\s*\/?>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decode(s);
  return s
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function htmlTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? decode(m[1]!).replace(/\s+/g, ' ').trim() || null : null;
}
