import { OFFICIAL_DOMAINS, type OfficialDomain } from '@urusin/core';
import { kanalFor } from '@urusin/rag';
import {
  KANAL_NASIONAL,
  kanalProvinsi,
  kanalWilayah,
  kontakDukcapil,
  kontakLayanan,
  ringkasKontak,
  wilayahByKode,
  type LayananKontak,
} from '@urusin/registry';
import { generateStructured, type CapabilityFlags, type ChatMessage, type ChatProvider } from '@urusin/llm';
import { z } from 'zod';
import type { KutipanTerverifikasi, PayloadOf } from '@urusin/contracts';
import { DATAMARK, idDelimiter, newNonce, spotlight, spotlightPolicyText } from './spotlight.js';
import type { ChunkRecord } from './store.js';
import { textFragmentUrl } from './textfragment.js';

/** Klaim-level grounding (audit #2): tiap klaim membawa kutipan persis dari potongan RAG yang dirujuk. */
const noBraces = (s: string) => !s.includes('{{') && !s.includes('}}');

export const KutipanSchema = z.object({
  refId: z.string().min(1),
  kutipanPersis: z.string().min(1).refine(noBraces, 'tidak boleh memuat {{ }}'),
});

export const KlaimSchema = z.object({
  teks: z.string().min(1).refine(noBraces, 'tidak boleh memuat {{ }}'),
  kutipan: z.array(KutipanSchema),
});

export const GroundedAnswerSchema = z.object({
  klaim: z.array(KlaimSchema),
  handoff: z.object({ pesan: z.string() }).optional(),
});
export type GroundedAnswer = z.infer<typeof GroundedAnswerSchema>;

export const KALIMAT_TETAP = 'Keputusan ada di petugas instansi terkait.';

const STALE_DAYS = 30;
const MIN_QUOTE_CHARS = 12;
export const MAX_KLAIM = 8;
/** Batas klaim yang diminta dari model (MAX_KLAIM tetap jaring pengaman): jawaban panjang menenggelamkan warga. */
export const KLAIM_RINGKAS = 4;
export const MAX_KLAIM_CHARS = 400;

/** Token faktual yang harus terbukti di kutipan: angka (termasuk Rp/titik/koma), URL, dan nomor telepon. */
const FACT_TOKEN_RE = /https?:\/\/\S+|www\.\S+|\+?\d[\d.,/-]*\d|\d/giu;

const digitsOnly = (t: string) => t.replace(/\D/g, '');

/** Nilai faktual di teks klaim yang TIDAK muncul di salah satu kutipan yang dirujuk. */
export function unsupportedFacts(teks: string, kutipan: readonly string[]): string[] {
  const haystack = kutipan.map((q) => normalizeForMatch(q)).join(' | ');
  const haystackDigits = kutipan.map((q) => digitsOnly(q));
  const bad: string[] = [];
  for (const m of teks.matchAll(FACT_TOKEN_RE)) {
    const tok = m[0].replace(/[.,;:)]+$/, '');
    if (/^(https?:|www\.)/i.test(tok)) {
      if (!kutipan.some((q) => q.toLowerCase().includes(tok.toLowerCase()))) bad.push(tok);
      continue;
    }
    const d = digitsOnly(tok);
    if (d === '') continue;
    if (!haystackDigits.some((h) => h.includes(d)) && !haystack.includes(normalizeForMatch(tok)))
      bad.push(tok);
  }
  return bad;
}

/**
 * Normalisasi untuk pencocokan kutipan: huruf kecil, tanda baca dan penanda datamark menjadi spasi,
 * spasi berurutan diringkas. Mengembalikan teks ternormalisasi + peta indeks ke teks asal
 * (dipakai mencari potongan asli untuk Text Fragment).
 */
export function normalizeWithMap(raw: string): { norm: string; map: number[] } {
  let norm = '';
  const map: number[] = [];
  let pendingSpace = false;
  let i = 0;
  for (const ch of raw) {
    const idx = i;
    i += ch.length;
    if (/[\p{L}\p{N}]/u.test(ch) && ch !== DATAMARK) {
      if (pendingSpace && norm.length > 0) {
        norm += ' ';
        map.push(idx);
      }
      pendingSpace = false;
      for (const c of ch.toLowerCase()) {
        norm += c;
        map.push(idx);
      }
    } else {
      pendingSpace = true;
    }
  }
  return { norm, map };
}

export const normalizeForMatch = (s: string): string => normalizeWithMap(s).norm;

/** Cari kutipan di teks chunk; kembalikan potongan ASLI (persis seperti di teks sumber) atau null. */
export function locateQuote(chunkText: string, quote: string): string | null {
  const q = normalizeForMatch(quote);
  if (q.length < MIN_QUOTE_CHARS) return null;
  const { norm, map } = normalizeWithMap(chunkText);
  const at = norm.indexOf(q);
  if (at === -1) return null;
  const start = map[at];
  const lastNorm = map[at + q.length - 1];
  if (start === undefined || lastNorm === undefined) return null;
  // Perluas sampai akhir karakter terakhir (satu code point).
  const lastCp = chunkText.codePointAt(lastNorm);
  const end = lastNorm + (lastCp !== undefined && lastCp > 0xffff ? 2 : 1);
  return chunkText.slice(start, end);
}

export type GroundedResult = {
  klaim: PayloadOf<'grounded_answer'>['klaim'];
  klaimDibuang: number;
  handoff?: PayloadOf<'handoff'>;
};

export type HandoffContext = {
  kodeKabKota?: string | null | undefined;
  /** Jenis urusan (`IntentJenis`): menentukan instansi tujuan. Kosong = adminduk (cakupan utama Urusin). */
  jenis?: string | null | undefined;
  /**
   * Tidak dipakai memilih kanal: hasil retrieval bisa berasal dari layanan atau wilayah lain (mis. cekbansos
   * untuk KTP patah), jadi kanal hand-off hanya diambil dari data kanal resmi per layanan.
   */
  chunks?: readonly ChunkRecord[] | undefined;
  /**
   * Warga bukan penduduk kab/kota ini (KTP di tempat lain, mis. KTP Surabaya bertanya ke Disdukcapil Semarang):
   * portal layanan wilayah ini hanya untuk penduduknya (login NIK setempat), jadi kanal pertamanya situs informasi
   * Disdukcapil, bukan portal.
   */
  bukanPenduduk?: boolean | undefined;
};

type KanalHandoff = PayloadOf<'handoff'>['kanal'][number];

/** Jenis urusan kependudukan: kanalnya Disdukcapil. Jenis lain punya instansinya sendiri (kanalLayanan). */
export const ADMINDUK: ReadonlySet<string> = new Set([
  'kelahiran',
  'kematian',
  'perkawinan',
  'pindah',
  'ktp',
  'kk',
  'kia',
  'akta',
]);

/** Kunci pembanding URL: host huruf kecil, tanpa fragment, tanpa garis miring di akhir path. */
export function kunciUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

/** Domain resmi terdaftar di @urusin/core untuk satu layanan. */
const domainResmi = (cocok: (d: OfficialDomain) => boolean): KanalHandoff[] =>
  OFFICIAL_DOMAINS.filter(cocok).map((d) => ({ nama: d.instansi, url: `https://${d.host}/` }));

/** Kanal nasional dari data/kanal-resmi.json; tautan hanya bila sudah terverifikasi. */
function kanalNasional(id: string, cadangan: string): KanalHandoff {
  const k = kanalFor(id);
  return { nama: k?.instansi ?? cadangan, ...(k?.url ? { url: k.url } : {}) };
}

/** Situs Dinas Dukcapil Provinsi DKI Jakarta (kanal kedua untuk kota administrasi DKI). */
const DUKCAPIL_DKI: KanalHandoff = {
  nama: 'Dinas Kependudukan dan Pencatatan Sipil Provinsi DKI Jakarta',
  url: 'https://kependudukancapil.jakarta.go.id/',
};

/** Kanal dari kontak layanan resmi tercatat (telepon/WA/email/jam), bertaut ke halaman sumbernya. */
function kanalKontakLayanan(kode: string, layanan: LayananKontak): KanalHandoff | undefined {
  const k = kontakLayanan(kode, layanan);
  const ringkas = k ? ringkasKontak(k) : '';
  if (!k || !ringkas) return undefined;
  return { nama: k.instansi, url: k.sumber[0]!.url, kontak: ringkas };
}

/**
 * Disdukcapil wilayah KTP (kanal registry, situs terverifikasi beserta alamatnya, lalu kontak layanan resmi);
 * tanpa wilayah: Ditjen Dukcapil.
 */
function kanalAdminduk(kode: string | null, bukanPenduduk = false): KanalHandoff[] {
  const nasional = `${KANAL_NASIONAL.judul}, ${KANAL_NASIONAL.instansi}`;
  if (!kode) return [{ nama: nasional, url: KANAL_NASIONAL.url }];
  const k = kanalWilayah(kode);
  const w = wilayahByKode(kode);
  // DKI (p05): yang melayani Suku Dinas Dukcapil kota administrasi, lewat portal milik Dinas provinsi; label
  // menyebut keduanya agar tautan Alpukat tidak dikira situs Suku Dinas. Situs Dinas provinsi jadi pengganti.
  const nama =
    k.jenis === 'nasional'
      ? nasional
      : kode.startsWith('31') && w && k.jenis === 'portal'
        ? `Suku Dinas Dukcapil ${w.nama} lewat ${k.judul}, portal ${k.instansi}`
        : k.instansi;
  // Bukan penduduk setempat (p03): portal berlogin NIK setempat dilewati bila ada situs informasi Disdukcapil.
  const lewatiPortal = bukanPenduduk && k.jenis === 'portal' && Boolean(kontakDukcapil(kode));
  const out: KanalHandoff[] = lewatiPortal ? [] : [{ nama, url: k.url }];
  if (kode.startsWith('31')) out.push(DUKCAPIL_DKI);
  // Tanpa situs Disdukcapil kab/kota (kanal pertama = situs pemda): situs Dinas Dukcapil/Pemerintah provinsi menyusul.
  const prov = k.jenis === 'pemda' ? kanalProvinsi(kode) : undefined;
  if (prov) out.push({ nama: prov.instansi, url: prov.url });
  const kontak = kontakDukcapil(kode);
  if (kontak && w)
    out.push({
      nama: `Dinas Kependudukan dan Pencatatan Sipil ${w.nama}`,
      url: kontak.website,
      ...(kontak.alamat ? { kontak: `Alamat: ${kontak.alamat}` } : {}),
    });
  const layanan = kanalKontakLayanan(kode, 'adminduk');
  if (layanan) {
    // Kontak menempel pada kanal instansi yang sama (host sama) agar tidak tampil sebagai kanal terpisah.
    const host = (u: string | undefined) => (u ? new URL(u).hostname.replace(/^www\./, '') : '');
    const sama = out.findLast((o) => o.url && host(o.url) === host(layanan.url));
    if (sama) sama.kontak = sama.kontak ? `${sama.kontak} · ${layanan.kontak}` : layanan.kontak;
    else out.push(layanan);
  }
  return out;
}

/**
 * Instansi menurut LAYANAN, bukan default Disdukcapil: SKCK ke Polri, pajak kendaraan ke Samsat/Bapenda provinsi,
 * bansos ke Kemensos dan dinas sosial, cek DPT ke KPU, pengaduan ke SP4N-LAPOR!, adminduk ke Disdukcapil wilayah KTP.
 * Jenis lain: kosong, karena Urusin belum punya data kanalnya (tidak menebak dari chunk).
 */
function kanalLayanan(jenis: string | null, kode: string | null, bukanPenduduk = false): KanalHandoff[] {
  const w = kode ? wilayahByKode(kode) : undefined;
  switch (jenis) {
    case 'skck':
      return [
        kanalNasional('skck', 'Kepolisian Negara Republik Indonesia (Polri)'),
        (kode ? kanalKontakLayanan(kode, 'skck') : undefined) ?? {
          nama: w ? `Polres atau Polsek di ${w.nama}` : 'Polres atau Polsek sesuai domisili Anda',
        },
      ];
    case 'pajak_kendaraan': {
      const prov = w?.kodeKabKota.slice(0, 2);
      const resmi = domainResmi((d) => /pajak kendaraan/i.test(d.layanan) && d.wilayah === prov);
      if (resmi.length > 0) return resmi;
      return [
        {
          nama: w
            ? `Samsat atau Bapenda Provinsi ${w.provinsi}`
            : 'Samsat atau Bapenda provinsi tempat kendaraan terdaftar',
        },
      ];
    }
    case 'bansos':
      return [
        ...domainResmi((d) => /bansos/i.test(d.layanan)),
        { nama: w ? `Dinas sosial ${w.nama}` : 'Dinas sosial kab/kota sesuai KTP Anda' },
      ];
    case 'cek_dpt':
      return [kanalNasional('dpt', 'Komisi Pemilihan Umum (KPU)')];
    case 'pengaduan':
      return domainResmi((d) => d.layanan === 'Pengaduan publik');
    default:
      return jenis === null || ADMINDUK.has(jenis) ? kanalAdminduk(kode, bukanPenduduk) : [];
  }
}

/** Kanal resmi untuk hand-off menurut layanan urusan; URL yang hanya beda tulisan digabung (kontaknya dipertahankan). */
export function handoffChannels(ctx: HandoffContext): KanalHandoff[] {
  const kode = ctx.kodeKabKota && /^\d{4}$/.test(ctx.kodeKabKota) ? ctx.kodeKabKota : null;
  const out: KanalHandoff[] = [];
  for (const k of kanalLayanan(ctx.jenis ?? null, kode, ctx.bukanPenduduk === true)) {
    const ada = out.find((o) =>
      k.url ? o.url !== undefined && kunciUrl(o.url) === kunciUrl(k.url) : !o.url && o.nama === k.nama,
    );
    if (!ada) out.push(k);
    else if (k.kontak && !ada.kontak) ada.kontak = k.kontak;
  }
  return out;
}

export function buildHandoff(
  ctx: HandoffContext,
  sebab: PayloadOf<'handoff'>['sebab'],
): PayloadOf<'handoff'> {
  const kanal = handoffChannels(ctx);
  const first = kanal[0];
  return {
    alasan: first
      ? `Saya belum menemukan sumber resmi untuk ini. Tanyakan ke ${first.nama}${first.url ? ` (${first.url})` : ''}.`
      : 'Saya belum menemukan sumber resmi untuk ini, dan Urusin belum punya data kanal resmi untuk urusan ini. Tanyakan langsung ke instansi yang menangani urusan tersebut.',
    sebab,
    kanal,
  };
}

function stale(verifiedAt: string | null, now: Date): boolean {
  if (!verifiedAt) return true;
  const t = Date.parse(verifiedAt);
  return Number.isNaN(t) || now.getTime() - t > STALE_DAYS * 86_400_000;
}

/**
 * Verifikasi jawaban: sebuah klaim bertahan hanya bila ia punya ≥ 1 kutipan dan SEMUA kutipannya
 * (a) merujuk refId yang ada di hasil retrieval urusan ini, dan (b) `kutipanPersis` adalah substring ternormalisasi
 * dari teks chunk itu. Klaim lain dibuang. Bila tak ada yang bertahan → hand-off ke kanal resmi.
 */
export function verifyGrounded(
  answer: GroundedAnswer,
  chunks: readonly ChunkRecord[],
  ctx: Omit<HandoffContext, 'chunks'> = {},
  now: Date = new Date(),
): GroundedResult {
  // Model kerap menyalin id dari atribut delimiter spotlight (`wonogiri-ktp-el_1`), bukan dari kurung siku
  // (`wonogiri-ktp-el#1`). Tanpa padanan ini SEMUA klaim atas chunk ber-`#` dibuang dan warga mendapat hand-off
  // "belum ada sumber resmi" walau sumbernya ada (QA warga: KTP-el rusak Wonogiri). Id persis tetap menang.
  const byId = new Map(chunks.map((c) => [c.refId, c]));
  for (const c of chunks) if (!byId.has(idDelimiter(c.refId))) byId.set(idDelimiter(c.refId), c);
  const klaim: GroundedResult['klaim'] = [];
  let dropped = 0;

  for (const k of answer.klaim.slice(0, MAX_KLAIM)) {
    if (k.teks.length > MAX_KLAIM_CHARS) {
      dropped++;
      continue;
    }
    const citations: KutipanTerverifikasi[] = [];
    let ok = k.kutipan.length > 0;
    for (const c of k.kutipan) {
      const chunk = byId.get(c.refId);
      const exact = chunk ? locateQuote(chunk.text, c.kutipanPersis) : null;
      if (!chunk || exact === null) {
        ok = false;
        break;
      }
      citations.push({
        refId: chunk.refId,
        kutipanPersis: exact,
        url: chunk.url,
        judul: chunk.judul,
        instansi: chunk.instansi,
        textFragmentUrl: textFragmentUrl(chunk.url, chunk.text, exact),
        verifiedAt: chunk.verifiedAt,
        perluDicekUlang: stale(chunk.verifiedAt, now),
      });
    }
    if (
      ok &&
      unsupportedFacts(
        k.teks,
        citations.map((c) => c.kutipanPersis),
      ).length > 0
    )
      ok = false;
    if (ok) klaim.push({ teks: k.teks, kutipan: citations });
    else dropped++;
  }

  dropped += Math.max(0, answer.klaim.length - MAX_KLAIM);
  if (klaim.length === 0) {
    const sebab = chunks.length === 0 ? 'tanpa_sumber' : 'kutipan_tidak_terverifikasi';
    return { klaim: [], klaimDibuang: dropped, handoff: buildHandoff(ctx, sebab) };
  }
  return { klaim, klaimDibuang: dropped };
}

export type GroundedGenerationOptions = {
  provider: ChatProvider;
  model: string;
  caps: Pick<CapabilityFlags, 'json_schema_strict' | 'tools'>;
  pertanyaan: string;
  chunks: readonly ChunkRecord[];
  signal?: AbortSignal | undefined;
  maxTokens?: number | undefined;
};

/** Minta model menyusun `{klaim:[{teks,kutipan:[{refId,kutipanPersis}]}]}` dari chunk yang diberikan (tanpa streaming). */
export async function generateGroundedAnswer(opts: GroundedGenerationOptions) {
  const nonce = newNonce();
  const sources = opts.chunks
    .map(
      (c) => `[${c.refId}] ${c.judul}\n${spotlight('rag', c.text, { nonce, id: c.refId, maxChars: 1500 })}`,
    )
    .join('\n\n');
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'Kamu menyusun jawaban persyaratan/prosedur layanan publik Indonesia HANYA dari sumber resmi di bawah.',
        spotlightPolicyText(),
        'Keluaran: objek JSON {klaim:[{teks, kutipan:[{refId, kutipanPersis}]}], handoff}.',
        '- Setiap klaim = satu kalimat pendek (paling banyak ±25 kata) untuk warga, dengan Bahasa Indonesia sederhana.',
        `- Jawab HANYA yang ditanyakan warga, paling banyak ${KLAIM_RINGKAS} klaim, urut dari yang terpenting: dokumen yang wajib disiapkan, lalu kanal/cara mengajukan, lalu langkah berikutnya. Gabungkan dokumen sejenis dalam satu klaim.`,
        '- Teks klaim memakai kata sehari-hari, bukan bahasa peraturan: "petugas Disdukcapil" (bukan "pejabat pencatatan sipil"), "akta dibuatkan" (bukan "menerbitkan kutipan akta"), "lapor" (bukan "pelaporan"). Bahasa peraturan hanya di kutipanPersis.',
        '- Lewati rincian proses internal petugas (pemeriksaan berkas, SMS pemberitahuan, tanda tangan elektronik) dan kasus khusus yang tidak menyangkut warga ini, kecuali ditanyakan.',
        '- kutipanPersis HARUS salinan kata per kata dari sumber (boleh tanpa tanda "' +
          DATAMARK +
          '", kembalikan jadi spasi biasa). refId HARUS salah satu ID di dalam kurung siku pada sumber.',
        '- kutipanPersis cukup potongan TERPENDEK yang membuktikan klaim (6-25 kata), biasanya satu kutipan per klaim; jangan menyalin seluruh daftar. Jawaban ringkas lebih cepat sampai ke warga.',
        '- Jangan membuat klaim tanpa kutipan. Bila sumber tidak memuat jawabannya, kembalikan klaim kosong dan isi handoff.',
        '- Jangan menulis nomor identitas, nomor HP, atau email warga.',
      ].join('\n'),
    },
    { role: 'user', content: `Pertanyaan warga: ${opts.pertanyaan}\n\nSUMBER:\n${sources}` },
  ];
  return generateStructured({
    provider: opts.provider,
    model: opts.model,
    messages,
    schema: GroundedAnswerSchema,
    name: 'jawab_persyaratan',
    caps: opts.caps,
    maxTokens: opts.maxTokens ?? 1500,
    signal: opts.signal,
  });
}
