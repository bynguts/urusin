import { pecahTautan } from './tautan.js';

/**
 * Markdown ringan untuk jawaban AI (paragraf, daftar, tebal, miring, kode, judul kecil, kutipan), diurai menjadi
 * pohon data lalu dirender sebagai elemen Svelte (`TeksKaya.svelte`), tanpa {@html}: HTML di teks model selalu
 * tampil sebagai teks. Tautan tetap lewat `pecahTautan` (hanya http/https).
 */
export type Inline =
  | { jenis: 'teks'; teks: string }
  | { jenis: 'tautan'; teks: string; href: string }
  | { jenis: 'kode'; teks: string }
  | { jenis: 'tebal'; isi: Inline[] }
  | { jenis: 'miring'; isi: Inline[] };

export type Butir = { isi: Inline[]; anak: Daftar | null };
export type Daftar = { jenis: 'daftar'; urut: boolean; mulai: number; butir: Butir[] };
export type Blok =
  | { jenis: 'paragraf'; baris: Inline[][] }
  | { jenis: 'judul'; isi: Inline[] }
  | { jenis: 'kutipan'; baris: Inline[][] }
  | { jenis: 'kodeblok'; teks: string }
  | { jenis: 'garis' }
  | Daftar;

/** Batas kedalaman tebal/miring bersarang (cegah rekursi patologis dari teks aneh). */
const DALAM_MAKS = 3;
const HURUF_ANGKA = /[\p{L}\p{N}]/u;
const LOLOS = /[*`_#\\[\]>-]/;

function daun(t: string): Inline[] {
  return pecahTautan(t).map((s) =>
    s.jenis === 'tautan' ? { jenis: 'tautan', teks: s.teks, href: s.href } : { jenis: 'teks', teks: s.teks },
  );
}

function bolehBukaMiring(s: string, i: number): boolean {
  const lanjut = s[i + 1];
  const sebelum = s[i - 1];
  return (
    lanjut !== undefined &&
    !/[\s*]/.test(lanjut) &&
    (sebelum === undefined || !(HURUF_ANGKA.test(sebelum) || sebelum === '*'))
  );
}

/** Indeks `*` penutup miring setelah `dari` (isi minimal satu karakter), atau -1. */
function tutupMiring(s: string, dari: number): number {
  for (let j = dari + 1; j < s.length; j++) {
    if (s[j] !== '*') continue;
    if (s[j + 1] === '*') {
      // Tebal di dalam miring: lompati pasangan `**`.
      j++;
      continue;
    }
    const sesudah = s[j + 1];
    if (/\s/.test(s[j - 1]!) || (sesudah !== undefined && HURUF_ANGKA.test(sesudah))) continue;
    return j;
  }
  return -1;
}

function emfasis(s: string, dalam: number): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const tuang = () => {
    if (buf) out.push(...daun(buf));
    buf = '';
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === '\\' && i + 1 < s.length && LOLOS.test(s[i + 1]!)) {
      buf += s[i + 1];
      i += 2;
      continue;
    }
    if (dalam < DALAM_MAKS && s.startsWith('**', i)) {
      const j = s.indexOf('**', i + 2);
      const isi = j > i + 2 ? s.slice(i + 2, j) : '';
      if (isi && isi.trim() === isi) {
        tuang();
        out.push({ jenis: 'tebal', isi: emfasis(isi, dalam + 1) });
        i = j + 2;
        continue;
      }
      buf += '**';
      i += 2;
      continue;
    }
    if (dalam < DALAM_MAKS && c === '*' && bolehBukaMiring(s, i)) {
      const j = tutupMiring(s, i + 1);
      if (j > 0) {
        tuang();
        out.push({ jenis: 'miring', isi: emfasis(s.slice(i + 1, j), dalam + 1) });
        i = j + 1;
        continue;
      }
    }
    buf += c;
    i++;
  }
  tuang();
  return out;
}

/** Gabungkan segmen teks yang bersebelahan. */
function rapat(isi: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const t of isi) {
    const akhir = out.at(-1);
    if (t.jenis === 'teks' && akhir?.jenis === 'teks') akhir.teks += t.teks;
    else if (t.jenis !== 'teks' || t.teks) out.push(t);
  }
  return out;
}

/** Satu baris teks menjadi token inline: `kode`, **tebal**, *miring*, dan tautan http/https. */
export function uraiInline(s: string): Inline[] {
  const out: Inline[] = [];
  let sisa = 0;
  for (const m of s.matchAll(/`([^`\n]+)`/g)) {
    out.push(...emfasis(s.slice(sisa, m.index), 0));
    out.push({ jenis: 'kode', teks: m[1]! });
    sisa = m.index + m[0].length;
  }
  out.push(...emfasis(s.slice(sisa), 0));
  return rapat(out);
}

type ButirMentah = { teks: string; anak: DaftarMentah | null };
type DaftarMentah = { jenis: 'daftar'; urut: boolean; mulai: number; indent: number; butir: ButirMentah[] };
type BlokMentah =
  | { jenis: 'paragraf' | 'kutipan'; baris: string[] }
  | { jenis: 'judul'; teks: string }
  | { jenis: 'kodeblok'; teks: string }
  | { jenis: 'garis' }
  | DaftarMentah;

const POLA_JUDUL = /^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const POLA_KUTIPAN = /^ {0,3}>\s?(.*)$/;
const POLA_BUTIR = /^(\s*)([-*+•]|\d{1,3}[.)])\s+(.*)$/;
const POLA_GARIS = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
const POLA_PAGAR = /^ {0,3}(```|~~~)/;

const lebarIndent = (s: string) => s.replace(/\t/g, '    ').length;

function matangDaftar(d: DaftarMentah): Daftar {
  return {
    jenis: 'daftar',
    urut: d.urut,
    mulai: d.mulai,
    butir: d.butir.map((b) => ({ isi: uraiInline(b.teks), anak: b.anak ? matangDaftar(b.anak) : null })),
  };
}

/** Urai teks AI menjadi blok. Baris baru tunggal di paragraf dipertahankan (chat, bukan dokumen). */
export function uraiTeksKaya(teks: string): Blok[] {
  const mentah: BlokMentah[] = [];
  const baris = teks.replace(/\r\n?/g, '\n').split('\n');
  let kini: BlokMentah | null = null;
  const tutup = () => {
    kini = null;
  };
  const mulai = (b: BlokMentah) => {
    mentah.push(b);
    kini = b;
  };

  for (let i = 0; i < baris.length; i++) {
    const b = baris[i]!;
    if (!b.trim()) {
      tutup();
      continue;
    }
    if (POLA_PAGAR.test(b)) {
      const pagar = POLA_PAGAR.exec(b)![1]!;
      const isi: string[] = [];
      i++;
      while (i < baris.length && !baris[i]!.trimStart().startsWith(pagar)) isi.push(baris[i++]!);
      mentah.push({ jenis: 'kodeblok', teks: isi.join('\n') });
      tutup();
      continue;
    }
    const judul = POLA_JUDUL.exec(b);
    if (judul) {
      mentah.push({ jenis: 'judul', teks: judul[1]! });
      tutup();
      continue;
    }
    if (POLA_GARIS.test(b)) {
      mentah.push({ jenis: 'garis' });
      tutup();
      continue;
    }
    const kutip = POLA_KUTIPAN.exec(b);
    if (kutip) {
      const k = kini as BlokMentah | null;
      if (k?.jenis === 'kutipan') k.baris.push(kutip[1]!);
      else mulai({ jenis: 'kutipan', baris: [kutip[1]!] });
      continue;
    }
    const butir = POLA_BUTIR.exec(b);
    if (butir) {
      const indent = lebarIndent(butir[1]!);
      const penanda = butir[2]!;
      const urut = /\d/.test(penanda);
      const isi = butir[3]!;
      const k = kini as BlokMentah | null;
      if (k?.jenis === 'daftar') {
        const induk = k.butir.at(-1);
        // Satu tingkat bersarang: butir yang menjorok ≥2 spasi dari daftar induk.
        if (induk && indent >= k.indent + 2) {
          if (induk.anak && induk.anak.urut === urut) induk.anak.butir.push({ teks: isi, anak: null });
          else
            induk.anak = {
              jenis: 'daftar',
              urut,
              mulai: urut ? parseInt(penanda, 10) : 1,
              indent,
              butir: [{ teks: isi, anak: null }],
            };
          continue;
        }
        if (k.urut === urut) {
          k.butir.push({ teks: isi, anak: null });
          continue;
        }
      }
      mulai({
        jenis: 'daftar',
        urut,
        mulai: urut ? parseInt(penanda, 10) : 1,
        indent,
        butir: [{ teks: isi, anak: null }],
      });
      continue;
    }
    const k = kini as BlokMentah | null;
    // Baris menjorok setelah butir = lanjutan butir itu.
    if (k?.jenis === 'daftar' && /^\s/.test(b)) {
      const induk = k.butir.at(-1)!;
      const target = induk.anak?.butir.at(-1) ?? induk;
      target.teks += ` ${b.trim()}`;
      continue;
    }
    if (k?.jenis === 'paragraf') k.baris.push(b.trim());
    else mulai({ jenis: 'paragraf', baris: [b.trim()] });
  }

  return mentah.map((m): Blok => {
    switch (m.jenis) {
      case 'paragraf':
      case 'kutipan':
        return { jenis: m.jenis, baris: m.baris.map(uraiInline) };
      case 'judul':
        return { jenis: 'judul', isi: uraiInline(m.teks) };
      case 'daftar':
        return matangDaftar(m);
      default:
        return m;
    }
  });
}

function panjangInline(isi: readonly Inline[]): number {
  let n = 0;
  for (const t of isi)
    n += t.jenis === 'tebal' || t.jenis === 'miring' ? panjangInline(t.isi) : t.teks.length;
  return n;
}

function panjangDaftar(d: Daftar): number {
  let n = 0;
  for (const b of d.butir) n += panjangInline(b.isi) + (b.anak ? panjangDaftar(b.anak) : 0);
  return n;
}

/** Jumlah karakter terlihat (penanda Markdown tidak dihitung). */
export function panjangTeksKaya(blok: readonly Blok[]): number {
  let n = 0;
  for (const b of blok) {
    if (b.jenis === 'paragraf' || b.jenis === 'kutipan') for (const l of b.baris) n += panjangInline(l);
    else if (b.jenis === 'judul') n += panjangInline(b.isi);
    else if (b.jenis === 'kodeblok') n += b.teks.length;
    else if (b.jenis === 'daftar') n += panjangDaftar(b);
  }
  return n;
}

/** Potong teks di dalam kata: diperpanjang sampai akhir kata, agar pengungkapan bergerak per kata. */
function potongKata(t: string, n: number): string {
  if (n >= t.length) return t;
  const spasi = t.slice(n).search(/\s/);
  return spasi < 0 ? t : t.slice(0, n + spasi);
}

type Anggaran = { sisa: number };

function potongInline(isi: readonly Inline[], a: Anggaran): Inline[] {
  const out: Inline[] = [];
  for (const t of isi) {
    if (a.sisa <= 0) break;
    if (t.jenis === 'tebal' || t.jenis === 'miring') {
      out.push({ ...t, isi: potongInline(t.isi, a) });
      continue;
    }
    const teks = potongKata(t.teks, a.sisa);
    a.sisa -= t.teks.length;
    out.push({ ...t, teks });
  }
  return out;
}

function potongDaftar(d: Daftar, a: Anggaran): Daftar {
  const butir: Butir[] = [];
  for (const b of d.butir) {
    if (a.sisa <= 0) break;
    const isi = potongInline(b.isi, a);
    butir.push({ isi, anak: b.anak && a.sisa > 0 ? potongDaftar(b.anak, a) : null });
  }
  return { ...d, butir };
}

/**
 * Pohon yang hanya memuat `n` karakter terlihat pertama (dibulatkan ke akhir kata): untuk efek mengetik.
 * Struktur (daftar, tebal) tetap utuh sejak karakter pertama, jadi penanda Markdown tidak pernah tampil mentah.
 */
export function potongTeksKaya(blok: readonly Blok[], n: number): Blok[] {
  const a: Anggaran = { sisa: n };
  const out: Blok[] = [];
  for (const b of blok) {
    if (a.sisa <= 0) break;
    switch (b.jenis) {
      case 'paragraf':
      case 'kutipan': {
        const baris: Inline[][] = [];
        for (const l of b.baris) {
          if (a.sisa <= 0) break;
          baris.push(potongInline(l, a));
        }
        out.push({ jenis: b.jenis, baris });
        break;
      }
      case 'judul':
        out.push({ jenis: 'judul', isi: potongInline(b.isi, a) });
        break;
      case 'kodeblok':
        out.push({ jenis: 'kodeblok', teks: potongKata(b.teks, a.sisa) });
        a.sisa -= b.teks.length;
        break;
      case 'daftar':
        out.push(potongDaftar(b, a));
        break;
      default:
        out.push(b);
    }
  }
  return out;
}
