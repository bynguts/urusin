export type TextChunk = { heading: string; text: string };

/** Baris penanda blok layanan yang berdiri sendiri ("Syarat:", "Prosedur", "Biaya", "Dasar Hukum"). */
const LABEL_RE =
  /^(?:[-*#]\s*)?(?:\*\*)?(persyaratan|syarat|prosedur|tata cara|alur|biaya|tarif|jangka waktu|waktu|lama proses|dasar hukum)(?:[^\n|]{0,30}?)(?:\*\*)?\s*:?\s*$/i;

/**
 * Pecah teks per heading, lalu per blok layanan (syarat / prosedur / biaya / waktu / dasar hukum)
 * di dalam heading itu, baru jatuh ke ukuran: bagian panjang dipecah di batas baris (~maxChars).
 * Daftar ("- ...") dan baris tabel ("a | b") yang berurutan tidak dipecah bila masih muat dalam
 * 2x batas, agar daftar syarat utuh.
 */
export function chunkByHeading(text: string, maxChars = 1800): TextChunk[] {
  const sections: { heading: string; lines: string[] }[] = [{ heading: '', lines: [] }];
  for (const line of text.split('\n')) {
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) {
      sections.push({ heading: h[1]!.trim(), lines: [] });
      continue;
    }
    const label = LABEL_RE.exec(line.trim());
    const cur = sections[sections.length - 1]!;
    if (label && cur.heading) {
      const base = cur.heading.split(' › ')[0]!;
      sections.push({ heading: `${base} › ${label[1]!.toLowerCase()}`, lines: [line] });
    } else cur.lines.push(line);
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
      const inList = /^\s*[-*]\s/.test(line) && /^\s*[-*]\s/.test(buf[buf.length - 1] ?? '');
      if (len + line.length > maxChars && buf.length && !(inList && len + line.length <= maxChars * 2)) {
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

/** Potongan terlalu pendek / hampir tanpa huruf (menu, "Selengkapnya", tanggal, "Klik disini") tidak berguna untuk retrieval. */
export const MIN_CHUNK_CHARS = 25;

export function dropBoilerplate(pieces: readonly TextChunk[]): TextChunk[] {
  const seen = new Set<string>();
  return pieces.filter((p) => {
    const letters = (p.text.match(/\p{L}/gu) ?? []).length;
    if (p.text.length < MIN_CHUNK_CHARS || letters < 15) return false;
    const key = p.text.replace(/\s+/g, ' ').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
