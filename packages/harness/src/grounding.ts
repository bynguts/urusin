import { OFFICIAL_DOMAINS, type OfficialDomain } from '@urusin/core';
import { kanalFor } from '@urusin/rag';
import { KANAL_NASIONAL, kanalWilayah, kontakDukcapil, wilayahByKode } from '@urusin/registry';
import { generateStructured, type CapabilityFlags, type ChatMessage, type ChatProvider } from '@urusin/llm';
import { z } from 'zod';
import type { KutipanTerverifikasi, PayloadOf } from '@urusin/contracts';
import { DATAMARK, newNonce, spotlight, spotlightPolicyText } from './spotlight.js';
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
export const KLAIM_RINGKAS = 6;
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

/** Disdukcapil wilayah KTP (kanal registry, lalu situs terverifikasi beserta alamatnya); tanpa wilayah: Ditjen Dukcapil. */
function kanalAdminduk(kode: string | null): KanalHandoff[] {
  const nasional = `${KANAL_NASIONAL.judul}, ${KANAL_NASIONAL.instansi}`;
  if (!kode) return [{ nama: nasional, url: KANAL_NASIONAL.url }];
  const k = kanalWilayah(kode);
  const out: KanalHandoff[] = [{ nama: k.jenis === 'nasional' ? nasional : k.instansi, url: k.url }];
  const kontak = kontakDukcapil(kode);
  const w = wilayahByKode(kode);
  if (kontak && w)
    out.push({
      nama: `Dinas Kependudukan dan Pencatatan Sipil ${w.nama}`,
      url: kontak.website,
      ...(kontak.alamat ? { kontak: `Alamat: ${kontak.alamat}` } : {}),
    });
  return out;
}

/**
 * Instansi menurut LAYANAN, bukan default Disdukcapil: SKCK ke Polri, pajak kendaraan ke Samsat/Bapenda provinsi,
 * bansos ke Kemensos dan dinas sosial, cek DPT ke KPU, pengaduan ke SP4N-LAPOR!, adminduk ke Disdukcapil wilayah KTP.
 * Jenis lain: kosong, karena Urusin belum punya data kanalnya (tidak menebak dari chunk).
 */
function kanalLayanan(jenis: string | null, kode: string | null): KanalHandoff[] {
  const w = kode ? wilayahByKode(kode) : undefined;
  switch (jenis) {
    case 'skck':
      return [
        kanalNasional('skck', 'Kepolisian Negara Republik Indonesia (Polri)'),
        { nama: w ? `Polres atau Polsek di ${w.nama}` : 'Polres atau Polsek sesuai domisili Anda' },
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
      return jenis === null || ADMINDUK.has(jenis) ? kanalAdminduk(kode) : [];
  }
}

/** Kanal resmi untuk hand-off menurut layanan urusan; URL yang hanya beda tulisan digabung (kontaknya dipertahankan). */
export function handoffChannels(ctx: HandoffContext): KanalHandoff[] {
  const kode = ctx.kodeKabKota && /^\d{4}$/.test(ctx.kodeKabKota) ? ctx.kodeKabKota : null;
  const out: KanalHandoff[] = [];
  for (const k of kanalLayanan(ctx.jenis ?? null, kode)) {
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
  const byId = new Map(chunks.map((c) => [c.refId, c]));
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
        refId: c.refId,
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
        '- Lewati rincian proses internal petugas (pemeriksaan berkas, SMS pemberitahuan, tanda tangan elektronik) dan kasus khusus yang tidak menyangkut warga ini, kecuali ditanyakan.',
        '- kutipanPersis HARUS salinan kata per kata dari sumber (boleh tanpa tanda "' +
          DATAMARK +
          '", kembalikan jadi spasi biasa). refId HARUS salah satu ID di dalam kurung siku pada sumber.',
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
