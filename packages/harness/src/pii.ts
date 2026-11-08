import { findPiiSpans, normalizeForScan, type PiiKind, type PiiOptions } from '@urusin/core';
import type { ChatMessage } from '@urusin/llm';

/**
 * Lapis 1 interseptor PII (rencana §3.7): sebelum SETIAP panggilan LLM, NIK/KK (16 digit), HP, dan email
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

export type PlaceholderKind = PiiKind | 'kk' | 'dikenal';

export type Replacement = { kind: PlaceholderKind; placeholder: string };

export type RedactResult = { text: string; replacements: Replacement[] };

const KK_CONTEXT_RE = /(?:\bkk\b|kartu keluarga|no\.?\s*kk|nomor kk)[^0-9]{0,15}$/i;

const SUFFIX: Record<PlaceholderKind, string> = {
  nik: 'NIK',
  kk: 'KK',
  phone: 'HP',
  email: 'EMAIL',
  dikenal: 'DATA',
};

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
  ) {}

  private placeholderFor(kind: PlaceholderKind, value: string): string {
    const key = `${kind}:${normalizeForScan(value).text.replace(/\D/g, '') || value.toLowerCase()}`;
    const existing = this.byValue.get(key);
    if (existing) return existing;
    const n = this.counters.get(kind) ?? 0;
    this.counters.set(kind, n + 1);
    const token = `{{${namespaceFor(n)}.${SUFFIX[kind]}}}`;
    this.byValue.set(key, token);
    return token;
  }

  redact(text: string): RedactResult {
    const hits: { start: number; end: number; kind: PlaceholderKind; value: string; token?: string }[] = [];
    for (const s of findPiiSpans(text, this.ctx)) {
      const kind: PlaceholderKind =
        s.kind === 'nik' && KK_CONTEXT_RE.test(text.slice(Math.max(0, s.start - 25), s.start))
          ? 'kk'
          : s.kind;
      hits.push({ start: s.start, end: s.end, kind, value: s.value });
    }
    for (const m of this.matcher?.match(text) ?? []) {
      hits.push({ start: m.start, end: m.end, kind: 'dikenal', value: '', token: m.placeholder });
    }
    if (hits.length === 0) return { text, replacements: [] };
    hits.sort((a, b) => a.start - b.start);
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
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactLeaves(v)])) as T;
  }
  return value;
}

/** Redaksi sekali pakai tanpa pemetaan stabil (untuk penyimpanan: hanya perlu memastikan nol PII). */
export function redactForStorage(text: string): string {
  return new PiiInterceptor().redact(text).text;
}
