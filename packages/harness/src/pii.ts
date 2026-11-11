import { findPiiSpans, normalizeForScan, type PiiKind, type PiiOptions } from '@urusin/core';
import type { ChatMessage } from '@urusin/llm';
import { kontakResmiTercatat } from '@urusin/registry';

/**
 * Lapis 1 interseptor PII (rencana §3.7): sebelum SETIAP panggilan LLM, NIK/KK (16 digit), HP, email, dan nama ibu kandung
 * diganti placeholder bergaya `{{PEMOHON.NIK}}`. Lapis 2 = `noPlaceholder()` dari @urusin/core pada parameter
 * yang ditulis LLM (dijalankan policy gate). Server TIDAK memegang vault: nilai asli hanya dikenal klien.
 */

/** Dipakai KLIEN / ekstensi saja: menukar placeholder menjadi nilai asli dari vault lokal. */
export interface VaultResolver {
  resolve(placeholder: string): Promise<string | undefined>;
}

/**
 * Lapis (b) di klien: cocokkan nilai vault yang dikenal (nama, alamat) pada teks sebelum `fetch`.
 * Antarmuka saja; server tidak memiliki implementasinya.
 */
export interface KnownValueMatcher {
  match(text: string): { start: number; end: number; placeholder: string }[];
}

/** Penyimpanan pemetaan placeholder per urusan (kunci sudah di-HMAC; tanpa nilai asli). */
export interface PlaceholderPersistence {
  /** Kunci stabil untuk (jenis, nilai ternormalisasi); HMAC dengan rahasia server. */
  key(kind: string, normalized: string): string;
  entries: readonly { key: string; kind: string; token: string }[];
  save(key: string, kind: string, token: string): void;
}

export type PlaceholderKind = PiiKind | 'kk' | 'dikenal' | 'nama_ibu';

export type Replacement = { kind: PlaceholderKind; placeholder: string };

export type RedactResult = { text: string; replacements: Replacement[] };

const KK_CONTEXT_RE = /(?:\bkk\b|kartu keluarga|no\.?\s*kk|nomor kk)[^0-9]{0,15}$/i;

const SUFFIX: Record<PlaceholderKind, string> = {
  nik: 'NIK',
  kk: 'KK',
  phone: 'HP',
  email: 'EMAIL',
  dikenal: 'DATA',
  nama_ibu: 'NAMA_IBU',
};

// --- Nama (gadis) ibu kandung: data verifikasi identitas, diperlakukan seperti NIK ---

const IBU = String.raw`(?:ibu|ibunda|bunda|mama|mamah|mamak|emak)(?:nya)?\b`;
const KANDUNG = String.raw`(?:\s+kandung(?:nya)?\b)`;
const POSESIF = String.raw`(?:\s+(?:saya|aku|ku|gue|gua|gw|kami|beliau|anda|pemohon)\b)?`;
/** Pemicu yang DIIKUTI nama: "nama (gadis) ibu (kandung)", "ibu (kandung) saya bernama", "ibu kandung saya: / adalah". */
const PEMICU_MAJU = [
  String.raw`\bnama\s+(?:gadis\s+|asli\s+|lengkap\s+)?${IBU}${KANDUNG}?`,
  String.raw`\b${IBU}${KANDUNG}?${POSESIF}\s+(?:bernama|namanya)\b`,
  String.raw`\b${IBU}${KANDUNG}${POSESIF}\s*(?:[:=]|\b(?:adalah|ialah|yaitu|yakni)\b)`,
].map((p) => new RegExp(p, 'giu'));
/** "ibu kandung saya Sutinah": tanpa penghubung, nama hanya diakui bila kata pertamanya berhuruf kapital. */
const PEMICU_KAPITAL = new RegExp(String.raw`\b${IBU}${KANDUNG}${POSESIF}`, 'giu');
/** Pemicu yang DIDAHULUI nama: "Sutinah adalah/itu nama (gadis) ibu ...". */
const PEMICU_MUNDUR = new RegExp(
  String.raw`\s+(?:adalah|ialah|merupakan|itu|yaitu|yakni)\s+nama\s+(?:gadis\s+)?${IBU}`,
  'giu',
);

/** Kata pengisi antara pemicu dan nama ("nama ibu kandung saya adalah: ..."). */
const PENGISI = new Set(
  'saya aku ku gue gua gw kami beliau anda pemohon adalah ialah yaitu yakni itu bernama namanya nama kandung gadis asli lengkap ya'.split(
    ' ',
  ),
);
/** Kata yang bukan bagian nama: kata tugas, kata kerja umum di chat, dan nama dokumen. Mengakhiri nama. */
const BUKAN_NAMA = new Set(
  [
    'saya aku ku gue gua gw kami kita anda beliau dia nya adalah ialah yaitu yakni merupakan itu ini tersebut',
    'dan atau serta tapi tetapi namun lalu kemudian juga pun yang di ke dari pada untuk dengan oleh dalam sebagai',
    'sesuai karena kalau jika bila agar supaya biar sudah telah belum masih sedang akan mau ingin bisa dapat harus',
    'wajib perlu boleh tidak tak bukan enggak nggak gak ga ndak apa siapa bagaimana kapan mana berapa tolong mohon',
    'silakan terima kasih makasih ya iya ok oke lahir tinggal meninggal wafat umur usia tahun ayah bapak nik kk ktp',
    'hp wa email nomor no alamat diisi isi lupa tahu tau harap kan kok sih dong deh lho nih tuh saja aja sekarang',
    'dulu tadi salah betul benar',
  ]
    .join(' ')
    .split(' '),
);
/** Gelar/singkatan bertitik yang tetap bagian nama ("Hj. Siti", "Almh. Sutinah", inisial "A."). */
const GELAR = /^(?:\p{L}|hj|hjh|ny|nn|st|dr|dra|drs|ir|alm|almh|rr|r)\.$/iu;
const TOKEN = /[\p{L}\p{M}][\p{L}\p{M}'’-]*\.?/uy;
const SPASI = /[ \t\xa0]+/y;
const PEMISAH = /[\s:=«»"“”'‘’-]*/uy;
const MAKS_KATA_NAMA = 6;

type Rentang = { start: number; end: number };

function tokenDi(text: string, at: number): string | null {
  TOKEN.lastIndex = at;
  return TOKEN.exec(text)?.[0] ?? null;
}

/** Rentang nama yang dimulai di `at` (pengisi dilewati), atau null bila yang mengikuti bukan nama. */
function namaMaju(text: string, at: number, wajibKapital: boolean): Rentang | null {
  let i = at;
  for (;;) {
    PEMISAH.lastIndex = i;
    i += PEMISAH.exec(text)?.[0].length ?? 0;
    const t = tokenDi(text, i);
    if (!t || !PENGISI.has(t.toLowerCase())) break;
    i += t.length;
  }
  let end = -1;
  let n = 0;
  let j = i;
  while (n < MAKS_KATA_NAMA) {
    const t = tokenDi(text, j);
    if (!t) break;
    const dasar = t.replace(/\.$/, '').toLowerCase();
    if (BUKAN_NAMA.has(dasar) || (n === 0 && wajibKapital && !/^\p{Lu}/u.test(t))) break;
    const titikAkhir = t.endsWith('.') && !GELAR.test(t);
    end = j + t.length - (titikAkhir ? 1 : 0);
    n++;
    j += t.length;
    if (titikAkhir) break;
    SPASI.lastIndex = j;
    const s = SPASI.exec(text);
    if (!s) break;
    j += s[0].length;
  }
  return end > i ? { start: i, end } : null;
}

/** Rentang nama yang berakhir tepat sebelum `at` (kata dibaca mundur sampai tanda baca atau kata umum). */
function namaMundur(text: string, at: number): Rentang | null {
  const kata = [...text.slice(0, at).matchAll(/[\p{L}\p{M}][\p{L}\p{M}'’.-]*|[^\p{L}\p{M}\s]+|\s+/gu)];
  let start = -1;
  let n = 0;
  for (let k = kata.length - 1; k >= 0 && n < MAKS_KATA_NAMA; k--) {
    const m = kata[k]!;
    const w = m[0];
    if (/^[ \t\xa0]+$/.test(w)) continue;
    if (!/^[\p{L}\p{M}]/u.test(w) || BUKAN_NAMA.has(w.replace(/\.$/, '').toLowerCase())) break;
    if (w.endsWith('.') && !GELAR.test(w)) break;
    start = m.index;
    n++;
  }
  return start >= 0 ? { start, end: at } : null;
}

/** Rentang nama ibu kandung di teks: urut, rentang yang tumpang tindih digabung. */
export function findNamaIbu(text: string): Rentang[] {
  const semua: Rentang[] = [];
  const tambah = (r: Rentang | null) => {
    if (r) semua.push(r);
  };
  for (const re of PEMICU_MAJU)
    for (const m of text.matchAll(re)) tambah(namaMaju(text, m.index + m[0].length, false));
  for (const m of text.matchAll(PEMICU_KAPITAL)) tambah(namaMaju(text, m.index + m[0].length, true));
  for (const m of text.matchAll(PEMICU_MUNDUR)) tambah(namaMundur(text, m.index));
  semua.sort((a, b) => a.start - b.start);
  const out: Rentang[] = [];
  for (const r of semua) {
    const last = out.at(-1);
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

/** Kebalikan `namespaceFor`: `{{ORANG3.NIK}}` -> 2, `{{PEMOHON.HP}}` -> 0. */
function indexOfToken(token: string): number {
  const m = /^\{\{(?:PEMOHON|ORANG(\d+))\./.exec(token);
  return m?.[1] ? Number(m[1]) - 1 : 0;
}

/** Nama namespace berurutan: orang pertama = PEMOHON, berikutnya ORANG2, ORANG3, ... */
function namespaceFor(index: number): string {
  return index === 0 ? 'PEMOHON' : `ORANG${index + 1}`;
}

/**
 * Satu instance = satu pemetaan nilai→placeholder yang stabil (nilai yang sama selalu mendapat
 * placeholder yang sama dalam satu urusan, sehingga model tetap bisa merujuknya).
 */
export class PiiInterceptor {
  private readonly byValue = new Map<string, string>();
  private readonly counters = new Map<PlaceholderKind, number>();
  /** Total penggantian sejak dibuat; dicatat di span sebagai `urusin.pii_redactions` bila perlu. */
  redactions = 0;

  constructor(
    private readonly matcher?: KnownValueMatcher,
    /** Konteks urusan: kode kab/kota yang diketahui, agar NIK yang dipecah antar bidang/turn tetap terdeteksi. */
    private readonly ctx: PiiOptions = {},
    private readonly persist?: PlaceholderPersistence,
  ) {
    for (const e of persist?.entries ?? []) {
      this.byValue.set(e.key, e.token);
      const kind = e.kind as PlaceholderKind;
      this.counters.set(kind, Math.max(this.counters.get(kind) ?? 0, indexOfToken(e.token) + 1));
    }
  }

  private placeholderFor(kind: PlaceholderKind, value: string): string {
    const norm = normalizeForScan(value).text.replace(/\D/g, '') || value.toLowerCase();
    const key = this.persist ? this.persist.key(kind, norm) : `${kind}:${norm}`;
    const existing = this.byValue.get(key);
    if (existing) return existing;
    const n = this.counters.get(kind) ?? 0;
    this.counters.set(kind, n + 1);
    const token = `{{${namespaceFor(n)}.${SUFFIX[kind]}}}`;
    this.byValue.set(key, token);
    this.persist?.save(key, kind, token);
    return token;
  }

  redact(text: string): RedactResult {
    const hits: { start: number; end: number; kind: PlaceholderKind; value: string; token?: string }[] = [];
    for (const s of findPiiSpans(text, this.ctx)) {
      // Nomor/email kontak resmi instansi (data/wilayah/kanal-layanan.json) bukan data pribadi warga.
      if ((s.kind === 'phone' || s.kind === 'email') && kontakResmiTercatat(s.value)) continue;
      const kind: PlaceholderKind =
        s.kind === 'nik' && KK_CONTEXT_RE.test(text.slice(Math.max(0, s.start - 25), s.start))
          ? 'kk'
          : s.kind;
      hits.push({ start: s.start, end: s.end, kind, value: s.value });
    }
    for (const r of findNamaIbu(text)) {
      hits.push({ ...r, kind: 'nama_ibu', value: text.slice(r.start, r.end).replace(/\s+/g, ' ') });
    }
    for (const m of this.matcher?.match(text) ?? []) {
      hits.push({ start: m.start, end: m.end, kind: 'dikenal', value: '', token: m.placeholder });
    }
    if (hits.length === 0) return { text, replacements: [] };
    hits.sort((a, b) => a.start - b.start || b.end - a.end);
    let out = '';
    let cursor = 0;
    const replacements: Replacement[] = [];
    for (const h of hits) {
      if (h.start < cursor) continue;
      const placeholder = h.token ?? this.placeholderFor(h.kind, h.value);
      out += text.slice(cursor, h.start) + placeholder;
      cursor = h.end;
      replacements.push({ kind: h.kind, placeholder });
    }
    out += text.slice(cursor);
    this.redactions += replacements.length;
    return { text: out, replacements };
  }

  /** Redaksi semua konten teks pesan (string, bagian teks, argumen tool, hasil tool). */
  redactMessages(messages: readonly ChatMessage[]): ChatMessage[] {
    const r = (s: string) => this.redact(s).text;
    return messages.map((m): ChatMessage => {
      const base = { ...m } as Record<string, unknown>;
      if (typeof m.content === 'string') base.content = r(m.content);
      else if (Array.isArray(m.content)) {
        base.content = m.content.map((p) =>
          typeof p === 'object' && p !== null && 'text' in p && typeof p.text === 'string'
            ? { ...p, text: r(p.text) }
            : p,
        );
      }
      if (m.role === 'assistant' && m.tool_calls) {
        base.tool_calls = m.tool_calls.map((c) =>
          c.type === 'function'
            ? { ...c, function: { ...c.function, arguments: r(c.function.arguments) } }
            : c,
        );
      }
      return base as unknown as ChatMessage;
    });
  }
}

/**
 * Redaksi pada DAUN string sebuah nilai JSON (bukan pada hasil serialisasi): placeholder menggantikan isi string,
 * sehingga struktur JSON tetap valid walau angka/teks menyerupai HP/NIK.
 */
export function redactLeaves<T>(value: T): T {
  if (typeof value === 'string') return redactForStorage(value) as T;
  if (Array.isArray(value)) return value.map(redactLeaves) as T;
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, PENGENAL[k]?.test(v as string) ? v : redactLeaves(v)]),
    ) as T;
  }
  return value;
}

/**
 * Pengenal buatan kode (bukan teks warga/model) yang dicocokkan ulang persis: hash sha256 dan id eksekusi.
 * Deret angka di dalamnya bisa menyerupai nomor HP; bila diredaksi, konfirmasi tidak cocok lagi
 * dengan `paramsHash` yang dihitung ulang. Hanya bentuk persis ini yang dilewati; selain itu tetap diredaksi.
 */
const PENGENAL: Readonly<Record<string, RegExp>> = {
  paramsHash: /^[0-9a-f]{64}$/,
  // Jejak Navigator generik (ADR 0030): hash rencana dan sha256 jalur yang diblokir gerbang tulis.
  rencanaHash: /^[0-9a-f]{64}$/,
  jalurSha256: /^[0-9a-f]{64}$/,
  executionId: /^x_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
};

/** Redaksi sekali pakai tanpa pemetaan stabil (untuk penyimpanan: hanya perlu memastikan nol PII). */
export function redactForStorage(text: string): string {
  return new PiiInterceptor().redact(text).text;
}
