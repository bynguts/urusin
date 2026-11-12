import { createHash } from 'node:crypto';
import { OFFICIAL_DOMAINS, findGuardIssues, getOfficialDomain, llmText } from '@urusin/core';
import { z } from 'zod';
import { PiiInterceptor, redactForStorage } from './pii.js';
import { spotlight } from './spotlight.js';
import type { ChunkRecord } from './store.js';
import { NON_TERMINAL_STATES, defineTool, type ToolResult } from './tools.js';

/**
 * Cari web (Exa) sebagai CADANGAN saat korpus RAG tidak cukup. Lapis pengaman, berurutan:
 * 1. kueri berisi data pribadi (NIK/KK/HP/email/nama ibu/placeholder/nama-tanggal lahir) ditolak sebelum jaringan;
 * 2. batas laju per urusan, per akun, dan global (biaya Exa);
 * 3. domain dibatasi ke sumber resmi (`*.go.id` + host non-.go.id di registry domain resmi) lewat `includeDomains`,
 *    dan hasil disaring ulang di sini; pencarian umum tanpa filter HANYA bila hasil resmi kosong, ditandai
 *    "bukan sumber resmi" dan tidak pernah disimpan sebagai sumber kutipan;
 * 4. seluruh isi halaman (judul, URL, tanggal, cuplikan) dibungkus spotlight sebagai data tak tepercaya;
 * 5. timeout ketat dan FAIL-OPEN: galat/lambat = agen lanjut tanpa web.
 */

export const EXA_SEARCH_URL = 'https://api.exa.ai/search';
export const WEB_TIMEOUT_MS = 6_000;
export const WEB_JUMLAH_HASIL = 5;
/** Anggaran per hasil sebelum dibungkus (judul + URL + tanggal + cuplikan). */
const MAKS_PER_HASIL = 600;

export type HasilWeb = { judul: string; url: string; cuplikan: string; terbit?: string | undefined };

/** Satu pencarian: `includeDomains` kosong = tanpa filter domain. Melempar bila gagal (pemanggil fail-open). */
export type CariWeb = (
  input: { query: string; includeDomains?: readonly string[] | undefined },
  signal: AbortSignal,
) => Promise<HasilWeb[]>;

export type BatasWebConfig = {
  perUrusan: number;
  perAkun: number;
  global: number;
  jendelaMs: number;
};

/** Per jam: 5 pencarian per urusan, 20 per akun, 120 global (≈ USD 1,8/jam pada tarif Exa tertinggi). */
export const BATAS_WEB_DEFAULT: BatasWebConfig = {
  perUrusan: 5,
  perAkun: 20,
  global: 120,
  jendelaMs: 3_600_000,
};

/** Jendela geser per kunci, di memori proses (server tunggal, seperti RateLimiter di apps/web). */
export class BatasCariWeb {
  private readonly jejak = new Map<string, number[]>();
  constructor(
    readonly config: BatasWebConfig = BATAS_WEB_DEFAULT,
    private readonly now: () => number = Date.now,
  ) {}

  /** true dan dicatat bila SEMUA kunci masih di bawah batasnya; false tanpa mencatat apa pun. */
  coba(kunci: readonly { kunci: string; batas: number }[]): boolean {
    const t = this.now();
    const segar = kunci.map((k) => {
      const ada = (this.jejak.get(k.kunci) ?? []).filter((x) => t - x < this.config.jendelaMs);
      this.jejak.set(k.kunci, ada);
      return { ...k, ada };
    });
    if (segar.some((k) => k.ada.length >= k.batas)) return false;
    for (const k of segar) k.ada.push(t);
    return true;
  }
}

export type LayananCariWeb = { cari: CariWeb; batas: BatasCariWeb };

/** Sufiks domain pemerintah Indonesia. */
const SUFIKS_RESMI = '.go.id';

/** Daftar `includeDomains` resmi: wildcard `*.go.id` + host resmi di luar .go.id dari registry (unik). */
export const DOMAIN_RESMI_WEB: readonly string[] = Object.freeze([
  `*${SUFIKS_RESMI}`,
  ...new Set(OFFICIAL_DOMAINS.map((d) => d.host).filter((h) => !h.endsWith(SUFIKS_RESMI))),
]);

/** Host https yang resmi: sufiks .go.id atau host persis di registry domain resmi. */
export function hostResmi(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return h.endsWith(SUFIKS_RESMI) || getOfficialDomain(h) !== undefined;
}

function urlAman(raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw.length > 2000) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u : null;
  } catch {
    return null;
  }
}

/** Data diri yang bukan pola angka: "nama saya Budi", "atas nama Sri", tanggal lahir, alamat rumah. */
const DATA_DIRI_RE = [
  /\bnama\s+(?:saya|aku|lengkap\s+saya|anak\s+saya|istri\s+saya|suami\s+saya|ayah\s+saya)\s+\S/iu,
  /\b(?:atas\s+nama|bernama|a\.n\.?)\s+\p{Lu}/u,
  /\b(?:lahir|tgl\.?\s*lahir|tanggal\s+lahir)\b[^\n]{0,20}\d{1,2}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{2,4}/iu,
  /\balamat\s+(?:saya|rumah\s+saya|lengkap\s+saya)\s+\S/iu,
];

/**
 * true bila kueri memuat data pribadi: placeholder/NIK/HP/email (penjaga parameter LLM), nama ibu kandung dan
 * pola lain interseptor PII, atau pola data diri. Kueri seperti ini tidak pernah dikirim ke luar.
 */
export function kueriBerisiDataPribadi(query: string): boolean {
  return (
    findGuardIssues(query).length > 0 ||
    new PiiInterceptor().redact(query).replacements.length > 0 ||
    DATA_DIRI_RE.some((re) => re.test(query))
  );
}

type ExaResult = {
  title?: unknown;
  url?: unknown;
  publishedDate?: unknown;
  highlights?: unknown;
  text?: unknown;
};

/**
 * Klien Exa `POST /search` (https://docs.exa.ai, OpenAPI exa-labs): `type: auto`, `numResults`, `includeDomains`
 * (host, prefix path, atau wildcard `*.contoh.com`), `moderation`, dan `contents.highlights` (cuplikan pilihan
 * LLM, hemat token dibanding teks penuh). `livecrawl` sudah usang di API (diganti `maxAgeHours`); tidak diisi =
 * cache Exa bila ada, paling cepat. Kunci lewat header `x-api-key`, tidak pernah dicatat.
 */
export function buatCariWebExa(opts: {
  apiKey: string;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  numResults?: number;
}): CariWeb {
  const timeoutMs = opts.timeoutMs ?? WEB_TIMEOUT_MS;
  return async (input, signal) => {
    const res = await opts.fetch(EXA_SEARCH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'x-api-key': opts.apiKey },
      body: JSON.stringify({
        query: input.query,
        type: 'auto',
        numResults: opts.numResults ?? WEB_JUMLAH_HASIL,
        moderation: true,
        ...(input.includeDomains?.length ? { includeDomains: [...input.includeDomains] } : {}),
        contents: { highlights: true },
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
    });
    if (!res.ok) throw new Error(`exa ${res.status}`);
    const body = (await res.json()) as { results?: unknown };
    const results = Array.isArray(body.results) ? (body.results as ExaResult[]) : [];
    return results.flatMap((r): HasilWeb[] => {
      const u = urlAman(r.url);
      if (!u) return [];
      const highlights = Array.isArray(r.highlights)
        ? r.highlights.filter((h): h is string => typeof h === 'string')
        : [];
      const cuplikan =
        highlights.length > 0 ? highlights.join(' … ') : typeof r.text === 'string' ? r.text : '';
      const terbit = typeof r.publishedDate === 'string' ? r.publishedDate.slice(0, 10) : undefined;
      return [
        {
          judul: typeof r.title === 'string' ? r.title : u.hostname,
          url: u.href,
          cuplikan,
          ...(terbit && /^\d{4}-\d{2}-\d{2}$/.test(terbit) ? { terbit } : {}),
        },
      ];
    });
  };
}

/** Fail-open: galat, timeout, atau batal = null (agen lanjut tanpa web). */
async function aman(p: Promise<HasilWeb[]>): Promise<HasilWeb[] | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

const refWeb = (url: string) => `web-${createHash('sha256').update(url).digest('hex').slice(0, 10)}`;

function formatHasil(h: HasilWeb, resmi: boolean, nonce: string): string {
  const host = new URL(h.url).hostname;
  const isi = [h.judul, h.url, h.terbit ? `terbit ${h.terbit}` : '', h.cuplikan].filter(Boolean).join('\n');
  return (
    `[${refWeb(h.url)}] ${resmi ? 'SUMBER RESMI' : 'BUKAN SUMBER RESMI'} (${host})\n` +
    spotlight('web', redactForStorage(isi), { nonce, id: refWeb(h.url), maxChars: MAKS_PER_HASIL })
  );
}

const LANJUT_TANPA_WEB = 'Lanjutkan tanpa web: arahkan warga ke kanal resmi wilayahnya; jangan mengarang.';

export const webCari = defineTool({
  name: 'web__cari',
  description:
    'CADANGAN pencarian web (sumber resmi .go.id dulu). Pakai HANYA bila rag__cari_pengetahuan tidak menemukan jawaban, hasilnya tidak relevan, tampak usang, atau pertanyaan di luar cakupan korpus. Query: istilah umum saja, TANPA data pribadi. Hasil resmi bisa dikutip lewat urusan__jawab_persyaratan; bila menyebut info dari web di balasan, WAJIB sertakan URL sumbernya.',
  effect: 'read',
  spanOperation: 'retrieval',
  input: z.object({
    query: llmText().min(3).max(300),
    domain: llmText()
      .max(120)
      .optional()
      .describe('Opsional. Satu domain resmi (mis. dukcapil.kemendagri.go.id) untuk mempersempit pencarian.'),
  }),
  allowedStates: NON_TERMINAL_STATES,
  kontenLuar: true,
  async execute(ctx, args): Promise<ToolResult> {
    const web = ctx.deps.cariWeb;
    if (!web) return { content: `Pencarian web tidak tersedia. ${LANJUT_TANPA_WEB}` };
    const query = args.query.trim();
    // Tidak pernah dikirim, tidak dicatat: hanya alasan umum yang kembali ke model.
    if (kueriBerisiDataPribadi(query))
      return {
        content:
          'Kueri web ditolak karena memuat data pribadi. Cari dengan istilah layanan yang umum (mis. "syarat akta kelahiran Kota Surabaya"), tanpa nama, nomor, atau tanggal lahir warga.',
      };
    const c = web.batas.config;
    const kunci = [
      { kunci: `urusan:${ctx.urusan.id}`, batas: c.perUrusan },
      ...(ctx.ingatan ? [{ kunci: `akun:${ctx.ingatan.pemilik}`, batas: c.perAkun }] : []),
      { kunci: 'global', batas: c.global },
    ];
    if (!web.batas.coba(kunci))
      return { content: `Batas pencarian web untuk saat ini tercapai. ${LANJUT_TANPA_WEB}` };

    const domain = args.domain
      ?.trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '');
    const sempit = domain && /^[a-z0-9.-]+$/.test(domain) && hostResmi(domain) ? [domain] : DOMAIN_RESMI_WEB;
    // Satu anggaran waktu untuk SELURUH tool (resmi + fallback umum), bukan per panggilan.
    const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(WEB_TIMEOUT_MS)]);
    const resmiMentah = await aman(web.cari({ query, includeDomains: sempit }, signal));
    if (resmiMentah === null)
      return { content: `Pencarian web gagal atau terlalu lama. ${LANJUT_TANPA_WEB}` };
    // Saring ulang: filter domain di penyedia bukan satu-satunya penjaga.
    const resmi = resmiMentah.filter(
      (h) => new URL(h.url).protocol === 'https:' && hostResmi(new URL(h.url).hostname),
    );
    if (resmi.length > 0) {
      const chunks: ChunkRecord[] = resmi.map((h) => ({
        refId: refWeb(h.url),
        text: redactForStorage(`${h.judul}. ${h.cuplikan}`),
        url: h.url,
        judul: redactForStorage(h.judul).slice(0, 200),
        instansi: getOfficialDomain(new URL(h.url).hostname)?.instansi ?? new URL(h.url).hostname,
        // Belum diverifikasi manual: kutipan dari web selalu ditandai "perlu dicek ulang".
        verifiedAt: null,
      }));
      ctx.store.saveChunks(ctx.urusan.id, chunks);
      return {
        content: [
          `Hasil web dari sumber resmi (${resmi.length}). Untuk persyaratan/prosedur panggil urusan__jawab_persyaratan (kutipan dan URL otomatis). Bila menyebutnya di balasan, sertakan URL sumbernya.`,
          ...resmi.map((h) => formatHasil(h, true, ctx.nonce)),
        ].join('\n'),
        terbungkus: true,
        takTepercaya: true,
      };
    }
    // Hasil resmi kosong: satu-satunya jalan ke pencarian umum. Tidak disimpan sebagai sumber kutipan.
    const umum = (await aman(web.cari({ query }, signal))) ?? [];
    if (umum.length === 0) return { content: `Tidak ada hasil web untuk kueri ini. ${LANJUT_TANPA_WEB}` };
    return {
      content: [
        'Tidak ada hasil dari sumber resmi. Hasil web umum di bawah BUKAN SUMBER RESMI: jangan dijadikan dasar persyaratan. Bila disebut, katakan jelas "bukan sumber resmi", sertakan URL-nya, dan sarankan warga memastikan ke kanal resmi.',
        ...umum.map((h) => formatHasil(h, hostResmi(new URL(h.url).hostname), ctx.nonce)),
      ].join('\n'),
      terbungkus: true,
      takTepercaya: true,
    };
  },
});
