/**
 * Linkify aman untuk teks AI dan warga: teks dipecah menjadi segmen teks dan segmen tautan, lalu dirender
 * sebagai elemen Svelte (tanpa {@html}). Hanya http/https yang menjadi tautan; skema lain (javascript:,
 * data:, file:) tetap teks biasa. Tautan Markdown `[label](https://…)` ikut dikenali.
 */
export type Segmen = { jenis: 'teks'; teks: string } | { jenis: 'tautan'; teks: string; href: string };

/** URL lebih panjang dari ini dibiarkan sebagai teks (bukan tautan wajar). */
const PANJANG_MAKS = 2048;
// Markdown [label](url) atau URL polos http(s). Karakter pembatas: spasi, kutip sudut, dan tanda kurung siku.
const POLA = /\[([^\]\n]{1,300})\]\((https?:\/\/[^\s)]+)\)|https?:\/\/[^\s<>"'`[\]{}|\\^]+/gi;
const TANDA_AKHIR = /[.,;:!?'"”’»…]$/;

/** href aman (http/https, terurai) atau null. */
export function hrefAman(url: string): string | null {
  if (url.length > PANJANG_MAKS) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname) return null;
    return u.href;
  } catch {
    return null;
  }
}

/** Buang tanda baca akhir kalimat; kurung tutup hanya dibuang bila tidak berpasangan di dalam URL. */
function rapikanAkhir(url: string): string {
  let u = url;
  for (;;) {
    if (TANDA_AKHIR.test(u)) {
      u = u.slice(0, -1);
      continue;
    }
    if (u.endsWith(')')) {
      const buka = u.split('(').length - 1;
      const tutup = u.split(')').length - 1;
      if (tutup > buka) {
        u = u.slice(0, -1);
        continue;
      }
    }
    return u;
  }
}

export function pecahTautan(teks: string): Segmen[] {
  const out: Segmen[] = [];
  let sisa = 0;
  const tambahTeks = (t: string) => {
    if (!t) return;
    const akhir = out.at(-1);
    if (akhir?.jenis === 'teks') akhir.teks += t;
    else out.push({ jenis: 'teks', teks: t });
  };
  for (const m of teks.matchAll(POLA)) {
    const mulai = m.index;
    const label = m[1];
    let mentah = m[2] ?? m[0];
    let panjang = m[0].length;
    if (label === undefined) {
      mentah = rapikanAkhir(mentah);
      panjang = mentah.length;
    }
    const href = hrefAman(mentah);
    if (!href) continue;
    tambahTeks(teks.slice(sisa, mulai));
    out.push({ jenis: 'tautan', teks: label ?? mentah, href });
    // Tanda baca yang dipangkas kembali menjadi teks (ikut potongan teks berikutnya).
    sisa = mulai + panjang;
  }
  tambahTeks(teks.slice(sisa));
  return out;
}

/** Tautan keluar situs ini (dibuka di tab baru). */
export function tautanLuar(href: string): boolean {
  return /^https?:\/\//i.test(href);
}
