export type TextChunk = { heading: string; text: string };

/**
 * Pecah teks per heading; bagian panjang dipecah di batas baris (~maxChars). Baris tabel
 * ("a | b") yang berurutan tidak dipecah bila masih muat dalam 2x batas, agar tabel syarat utuh.
 */
export function chunkByHeading(text: string, maxChars = 1800): TextChunk[] {
  const sections: { heading: string; lines: string[] }[] = [{ heading: '', lines: [] }];
  for (const line of text.split('\n')) {
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) sections.push({ heading: h[1]!.trim(), lines: [] });
    else sections[sections.length - 1]!.lines.push(line);
  }
  const out: TextChunk[] = [];
  for (const sec of sections) {
    const body = sec.lines.join('\n').trim();
    if (!body) continue;
    if (body.length <= maxChars * 2 && body.includes(' | ')) {
      out.push({ heading: sec.heading, text: body });
      continue;
    }
    let buf: string[] = [];
    let len = 0;
    for (const line of sec.lines) {
      if (len + line.length > maxChars && buf.length) {
        out.push({ heading: sec.heading, text: buf.join('\n').trim() });
        buf = [];
        len = 0;
      }
      buf.push(line);
      len += line.length + 1;
    }
    const rest = buf.join('\n').trim();
    if (rest) out.push({ heading: sec.heading, text: rest });
  }
  return out.filter((c) => c.text.length > 0);
}
