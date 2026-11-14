import { createHash } from 'node:crypto';
import {
  OFFICIAL_DOMAINS,
  findGuardIssues,
  getOfficialDomain,
  llmText,
  matchOfficialOrigin,
} from '@urusin/core';
import { z } from 'zod';
import { PiiInterceptor, redactForStorage } from './pii.js';
import { spotlight } from './spotlight.js';
import type { ChunkRecord } from './store.js';
import { NON_TERMINAL_STATES, defineTool, type ToolContext, type ToolResult } from './tools.js';

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
export const EXA_CONTENTS_URL = 'https://api.exa.ai/contents';
/** Batas teks satu halaman yang dibaca `web__baca` (Exa `text.maxCharacters`). */
export const MAKS_TEKS_BACA = 8_000;
export const WEB_TIMEOUT_MS = 6_000;
export const WEB_JUMLAH_HASIL = 5;
/** Anggaran per hasil sebelum dibungkus (judul + URL + tanggal + cuplikan). */
const MAKS_PER_HASIL = 600;

export type HasilWeb = { judul: string; url: string; cuplikan: string; terbit?: string | undefined };

/** Isi lengkap satu halaman (Exa `/contents`). Melempar bila gagal (pemanggil fail-open). */
export type BacaWeb = (url: string, signal: AbortSignal) => Promise<{ judul: string; teks: string } | null>;

/**
 * Satu pencarian: `includeDomains` kosong = tanpa filter domain. Melempar bila gagal (pemanggil fail-open).
 * `baca` (opsional, host egress yang sama): baca isi penuh halaman resmi; tanpa ini `web__baca` tidak terdaftar.
 */
export type CariWeb = ((
  input: { query: string; includeDomains?: readonly string[] | undefined },
  signal: AbortSignal,
) => Promise<HasilWeb[]>) & { baca?: BacaWeb | undefined };

export type BatasWebConfig = {
  perUrusan: number;
  perAkun: number;
  global: number;
  jendelaMs: number;
};

/** Per jam: 8 pencarian per urusan, 30 per akun, 120 global (≈ USD 1,8/jam pada tarif Exa tertinggi). */
export const BATAS_WEB_DEFAULT: BatasWebConfig = {
  perUrusan: 8,
  perAkun: 30,
  global: 120,
  jendelaMs: 3_600_000,
};

/** Perkiraan satu giliran agen: web__cari yang dicoba dalam jendela ini tidak disarankan ulang. */
export const JEDA_SARAN_WEB_MS = 120_000;

/** Jendela geser per kunci, di memori proses (server tunggal, seperti RateLimiter di apps/web). */
export class BatasCariWeb {
  private readonly jejak = new Map<string, number[]>();
  /** Percobaan terakhir per urusan (termasuk yang kena batas), agar saran web tidak berputar. */
  private readonly percobaan = new Map<string, number>();
  constructor(
    readonly config: BatasWebConfig = BATAS_WEB_DEFAULT,
    private readonly now: () => number = Date.now,
  ) {}

  tandaiPercobaan(urusanId: string): void {
    this.percobaan.set(urusanId, this.now());
  }

  /** web__cari sudah dicoba untuk urusan ini dalam `jedaMs` terakhir (berhasil, kosong, gagal, atau kena batas). */
  sudahDicoba(urusanId: string, jedaMs = JEDA_SARAN_WEB_MS): boolean {
    const t = this.percobaan.get(urusanId);
    return t !== undefined && this.now() - t < jedaMs;
  }

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

/** Alasan menyarankan web__cari sesudah pencarian korpus RAG. */
export type AlasanCariWeb = 'kosong' | 'diminta' | 'terkini' | 'wilayah';

/** Warga meminta dicarikan di internet. */
const MINTA_WEB_RE =
  /\b((men)?cari\w*|telusur\w*|search\w*|googling|browsing|lihat\w*)\s+(\S+\s+){0,3}?(di\s+)?(internet|web|google|online|situs\s+resmi)\b|\b(googling|browsing|searching)\b/i;
/** Info yang bisa berubah: korpus bisa usang. */
const TERKINI_RE =
  /\b(terbaru|terkini|terupdate|update\w*|biaya\w*|tarif\w*|harga\w*|denda\w*|jadwal\w*|jam\s+(buka|layanan|pelayanan|operasional|kerja)|libur\w*|kuota|(aturan|peraturan|kebijakan|ketentuan)\s+baru|berubah|perubahan|masih\s+berlaku)\b/i;
/** Detail yang khas daerah (kantor, kontak, kanal online). */
const LOKAL_RE =
  /\b(alamat\s+(kantor|disdukcapil|dukcapil|dinas|mpp|samsat|polres)|lokasi\w*|di\s*mana|kantor\w*|kontak|telepon|telp|whatsapp|wa|website|situs|aplikasi|portal|online|daring|mpp|mal\s+pelayanan|loket|cabang|gerai)\b/i;

/**
 * Kapan korpus RAG perlu dilengkapi web: tanpa hasil, warga minta dicarikan, info yang bisa berubah (biaya, jadwal,
 * aturan baru), atau tidak ada potongan khusus wilayah urusan (kab/kota atau provinsinya) padahal yang ditanya detail
 * daerah, atau layanannya bukan adminduk (aturan adminduk nasional, layanan lain beda per daerah). null = korpus cukup.
 */
export function alasanCariWeb(input: {
  hits: readonly { kodeWilayah: string | null }[];
  kode?: string | null | undefined;
  teks: string;
  adminduk: boolean;
}): AlasanCariWeb | null {
  if (input.hits.length === 0) return 'kosong';
  if (MINTA_WEB_RE.test(input.teks)) return 'diminta';
  if (TERKINI_RE.test(input.teks)) return 'terkini';
  const k = input.kode;
  const adaWilayah = k
    ? input.hits.some((h) => h.kodeWilayah === k || h.kodeWilayah === k.slice(0, 2))
    : true;
  if (!adaWilayah && (!input.adminduk || LOKAL_RE.test(input.teks))) return 'wilayah';
  return null;
}

/** Penanda saran web di hasil tool (jalur cepat memakainya untuk menyerahkan giliran ke model). */
export const PENANDA_SARAN_WEB = 'SARAN CARI WEB:';

const ALASAN_WEB: Record<AlasanCariWeb, string> = {
  kosong: 'korpus belum punya jawabannya',
  diminta: 'warga meminta dicarikan di internet',
  terkini:
    'pertanyaan menyangkut info yang bisa berubah (biaya, jadwal, jam layanan, aturan baru), korpus bisa usang',
  wilayah: 'korpus tidak memuat info khusus wilayah ini',
};

export function saranWeb(alasan: AlasanCariWeb): string {
  return `${PENANDA_SARAN_WEB} ${ALASAN_WEB[alasan]}. Panggil web__cari (istilah layanan umum + nama kab/kota, TANPA data pribadi) sebelum menjawab atau mengarahkan warga ke kanal; hasil sumber resmi lalu dikutip lewat urusan__jawab_persyaratan.`;
}

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
  const baca: BacaWeb = async (url, signal) => {
    const res = await opts.fetch(EXA_CONTENTS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'x-api-key': opts.apiKey },
      body: JSON.stringify({ urls: [url], text: { maxCharacters: MAKS_TEKS_BACA } }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
    });
    if (!res.ok) throw new Error(`exa ${res.status}`);
    const body = (await res.json()) as { results?: unknown };
    const r = (Array.isArray(body.results) ? (body.results as ExaResult[]) : [])[0];
    if (!r || typeof r.text !== 'string' || !r.text.trim()) return null;
    return { judul: typeof r.title === 'string' ? r.title : '', teks: r.text.slice(0, MAKS_TEKS_BACA) };
  };
  const cari: CariWeb = async (input, signal) => {
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
  cari.baca = baca;
  return cari;
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

/** Kunci batas laju web (per urusan, per akun, global): `web__cari` dan `web__baca` berbagi kuota yang sama. */
const kunciBatas = (ctx: ToolContext, c: BatasWebConfig) => [
  { kunci: `urusan:${ctx.urusan.id}`, batas: c.perUrusan },
  ...(ctx.ingatan ? [{ kunci: `akun:${ctx.ingatan.pemilik}`, batas: c.perAkun }] : []),
  { kunci: 'global', batas: c.global },
];

export const webCari = defineTool({
  name: 'web__cari',
  description:
    'Pencarian web (sumber resmi .go.id dulu), pelengkap korpus. Pakai bila rag__cari_pengetahuan tidak jelas menjawab: tanpa hasil, hasil lemah/tidak relevan, tidak ada info khusus kab/kota warga, info yang bisa berubah (biaya, jadwal, jam layanan, aturan baru), topik di luar korpus, atau warga minta dicarikan. Query: istilah layanan umum + nama daerah, TANPA data pribadi. Hasil resmi bisa dikutip lewat urusan__jawab_persyaratan; bila menyebut info dari web di balasan, WAJIB sertakan URL sumbernya.',
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
    web.batas.tandaiPercobaan(ctx.urusan.id);
    if (!web.batas.coba(kunciBatas(ctx, web.batas.config)))
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

/**
 * URL boleh dibaca `web__baca`: https tanpa userinfo/port, origin terdaftar di registry domain resmi atau host
 * pemerintah (.go.id, sama dengan saringan `web__cari`). Banyak halaman nasional (mis. dukcapil.kemendagri.go.id)
 * belum ada di registry Browser Pendamping, padahal itulah sumber resmi yang paling sering dicari.
 */
function urlBacaResmi(raw: string): URL | null {
  const u = urlAman(raw);
  if (!u || u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  return matchOfficialOrigin(u.origin).ok || hostResmi(u.hostname) ? u : null;
}

const kunciHalaman = (u: URL) => `${u.origin}${u.pathname.replace(/\/+$/, '')}${u.search}`;

/**
 * Baca isi lengkap satu halaman resmi (Exa `/contents`, host egress yang sama `api.exa.ai`). Hanya URL yang sudah
 * muncul sebagai hasil SUMBER RESMI `web__cari` di urusan ini; kuota sama dengan `web__cari`. Isinya disimpan sebagai
 * potongan sumber (kutipan tetap diverifikasi) dan dikembalikan terbungkus spotlight.
 */
export const webBaca = defineTool({
  name: 'web__baca',
  description:
    'Baca isi lengkap satu halaman resmi yang tadi muncul sebagai SUMBER RESMI di hasil web__cari urusan ini (cuplikan pencarian terlalu pendek, mis. daftar persyaratan atau biaya terpotong). Isi url persis dari hasil web__cari. Hasilnya bisa dikutip lewat urusan__jawab_persyaratan.',
  effect: 'read',
  spanOperation: 'retrieval',
  input: z.object({ url: z.string().min(8).max(2000) }),
  allowedStates: NON_TERMINAL_STATES,
  kontenLuar: true,
  async execute(ctx, args): Promise<ToolResult> {
    const web = ctx.deps.cariWeb;
    const baca = web?.cari.baca;
    if (!web || !baca) return { content: `Membaca halaman web tidak tersedia. ${LANJUT_TANPA_WEB}` };
    const u = urlBacaResmi(args.url.trim());
    if (!u)
      return {
        content:
          'URL ditolak: hanya halaman https dari situs pemerintah/registry resmi yang boleh dibaca. Pakai URL SUMBER RESMI dari hasil web__cari.',
      };
    const kunci = kunciHalaman(u);
    const dariCari = ctx.store
      .getChunks(ctx.urusan.id)
      .some(
        (c) =>
          /^web-[0-9a-f]{10}$/.test(c.refId) && urlBacaResmi(c.url) && kunciHalaman(new URL(c.url)) === kunci,
      );
    if (!dariCari)
      return {
        content:
          'URL ditolak: belum pernah muncul sebagai SUMBER RESMI di hasil web__cari urusan ini. Panggil web__cari dulu, lalu baca salah satu URL hasilnya.',
      };
    web.batas.tandaiPercobaan(ctx.urusan.id);
    if (!web.batas.coba(kunciBatas(ctx, web.batas.config)))
      return { content: `Batas pencarian web untuk saat ini tercapai. ${LANJUT_TANPA_WEB}` };
    const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(WEB_TIMEOUT_MS)]);
    let isi: { judul: string; teks: string } | null;
    try {
      isi = await baca(u.href, signal);
    } catch {
      return { content: `Halaman gagal dibaca atau terlalu lama. ${LANJUT_TANPA_WEB}` };
    }
    if (!isi) return { content: `Halaman ini tidak memuat teks yang bisa dibaca. ${LANJUT_TANPA_WEB}` };
    const refId = `${refWeb(u.href)}-baca`;
    const teks = redactForStorage(isi.teks).slice(0, MAKS_TEKS_BACA);
    const judul = redactForStorage(isi.judul || u.hostname).slice(0, 200);
    ctx.store.saveChunks(ctx.urusan.id, [
      {
        refId,
        text: teks,
        url: u.href,
        judul,
        instansi: getOfficialDomain(u.hostname)?.instansi ?? u.hostname,
        // Belum diverifikasi manual: kutipan dari web selalu ditandai "perlu dicek ulang".
        verifiedAt: null,
      },
    ]);
    return {
      content: [
        `Isi halaman resmi (${u.hostname}). Untuk persyaratan/prosedur panggil urusan__jawab_persyaratan (kutipan dan URL otomatis). Bila menyebutnya di balasan, sertakan URL sumbernya.`,
        `[${refId}] SUMBER RESMI (${u.hostname})\n${spotlight('web', `${judul}\n${u.href}\n${teks}`, { nonce: ctx.nonce, id: refId, maxChars: MAKS_TEKS_BACA + 500 })}`,
      ].join('\n'),
      terbungkus: true,
      takTepercaya: true,
    };
  },
});
