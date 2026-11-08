import { routeByKode } from '@urusin/registry';
import { generateStructured, type CapabilityFlags, type ChatMessage, type ChatProvider } from '@urusin/llm';
import { z } from 'zod';
import type { KutipanTerverifikasi, PayloadOf, Sumber } from '@urusin/contracts';
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
  chunks: readonly ChunkRecord[];
};

const NASIONAL: Sumber = {
  url: 'https://dukcapil.kemendagri.go.id',
  judul: 'Direktorat Jenderal Kependudukan dan Pencatatan Sipil',
  instansi: 'Kementerian Dalam Negeri',
};

/** Kanal resmi untuk hand-off: dari registry kota (sourceRef + portal), lalu sumber chunk, lalu kanal nasional. */
export function handoffChannels(ctx: HandoffContext): Sumber[] {
  const out: Sumber[] = [];
  const push = (s: Sumber) => {
    if (!out.some((o) => o.url === s.url)) out.push(s);
  };
  if (ctx.kodeKabKota && /^\d{4}$/.test(ctx.kodeKabKota)) {
    const { entry } = routeByKode(ctx.kodeKabKota);
    for (const s of entry.sourceRef) push(s);
    if (entry.portal) push({ url: entry.portal.origin, judul: entry.portal.nama, instansi: entry.nama });
  }
  if (out.length === 0) {
    for (const c of ctx.chunks.slice(0, 2)) push({ url: c.url, judul: c.judul, instansi: c.instansi });
  }
  if (out.length === 0) push(NASIONAL);
  return out;
}

export function buildHandoff(
  ctx: HandoffContext,
  sebab: PayloadOf<'handoff'>['sebab'],
): PayloadOf<'handoff'> {
  const kanal = handoffChannels(ctx);
  const first = kanal[0];
  return {
    alasan: `Saya belum menemukan sumber resmi untuk ini. Tanyakan ke ${first?.instansi ?? 'instansi terkait'} (${first?.url ?? NASIONAL.url}).`,
    sebab,
    kanal: kanal.map((k) => ({ nama: k.instansi, url: k.url })),
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

  for (const k of answer.klaim) {
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
    if (ok) klaim.push({ teks: k.teks, kutipan: citations });
    else dropped++;
  }

  if (klaim.length === 0) {
    const sebab = chunks.length === 0 ? 'tanpa_sumber' : 'kutipan_tidak_terverifikasi';
    return { klaim: [], klaimDibuang: dropped, handoff: buildHandoff({ ...ctx, chunks }, sebab) };
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
        '- Setiap klaim = satu pernyataan faktual singkat untuk warga, dengan Bahasa Indonesia sederhana.',
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
