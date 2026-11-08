import { randomUUID } from 'node:crypto';
import { llmText } from '@urusin/core';
import { LAYANAN_KORPUS, cariPengetahuanTool } from '@urusin/rag';
import { routeByKode } from '@urusin/registry';
import { z } from 'zod';
import type { PayloadOf } from '@urusin/contracts';
import { KALIMAT_TETAP, buildHandoff, generateGroundedAnswer, verifyGrounded } from './grounding.js';
import { spotlight } from './spotlight.js';
import { paramsHash, type ChunkRecord } from './store.js';
import { NON_TERMINAL_STATES, defineTool, type ToolContext, type ToolDef, type ToolResult } from './tools.js';

const kodeKabKota = z.string().regex(/^\d{4}$/);

type Hit = ReturnType<typeof cariPengetahuanTool.execute>['hasil'][number];

/** Anggaran per hit ditetapkan SEBELUM dibungkus (spotlight maxChars); keluaran terbungkus tidak boleh dipotong lagi. */
export function formatHits(hits: readonly Hit[], nonce: string, max = 4): string {
  if (hits.length === 0) return 'Tidak ada hasil di basis pengetahuan resmi. Arahkan warga ke kanal resmi.';
  return hits
    .slice(0, max)
    .map(
      (h) =>
        `[${h.id}] ${h.kutipan.judul.slice(0, 120)} — ${h.kutipan.instansi.slice(0, 120)} (diverifikasi: ${h.verifiedAt ?? 'belum'})\n` +
        spotlight('rag', h.text, { nonce, id: h.id, maxChars: 500 }),
    )
    .join('\n');
}

/**
 * Retrieval untuk tool agen. Dengan `ragSearch` (produksi): hybrid BM25 + vektor + rerank endpoint, jatuh ke BM25
 * sendiri bila penyedia gagal. Tanpa itu (tes, mode demo): BM25 sinkron atas `ragDb`.
 */
async function retrieve(ctx: ToolContext, query: string, kode: string | null | undefined, layanan?: string) {
  const ragDb = ctx.deps.ragDb;
  if (!ragDb) return { hasil: [] as Hit[], tanpaHasil: true };
  const search = ctx.deps.ragSearch;
  const cari = async (lay?: string) => {
    const input = { query, ...(kode ? { kodeKabKota: kode } : {}), ...(lay ? { layanan: lay } : {}), k: 4 };
    return search ? await search(input) : cariPengetahuanTool.execute(ragDb, input);
  };
  // Kategori sah yang tetap 0 hasil (mis. salah kategori) tidak boleh memaksa abstain: ulangi tanpa filter.
  let out = await cari(layanan);
  if (layanan && out.hasil.length === 0) out = await cari();
  const chunks: ChunkRecord[] = out.hasil.map((h) => ({
    refId: h.id,
    text: h.text,
    url: h.kutipan.url,
    judul: h.kutipan.judul,
    instansi: h.kutipan.instansi,
    verifiedAt: h.verifiedAt,
  }));
  if (chunks.length > 0) ctx.store.saveChunks(ctx.urusan.id, chunks);
  return out;
}

export const ragCariPengetahuan = defineTool({
  name: 'rag__cari_pengetahuan',
  description:
    'Cari pengetahuan layanan publik dari korpus resmi. Hasil berupa potongan bersumber dengan [id]; id itulah refId untuk kutipan.',
  effect: 'read',
  spanOperation: 'retrieval',
  input: z.object({
    query: llmText().max(500),
    kodeKabKota: kodeKabKota.optional(),
    // Nilai di luar enum (mis. "akta kelahiran") diabaikan (`catch`), bukan ditolak atau memfilter ke 0 hasil.
    layanan: z
      .enum(LAYANAN_KORPUS)
      .optional()
      .catch(undefined)
      .describe(
        'Opsional. Kategori korpus, BUKAN nama layanan: adminduk (KTP, KK, akta, pindah), samsat (pajak kendaraan), lapor, ombudsman, oss (izin usaha), bansos, pdp, pemilu, bpjs, skck, sim, ikd. Kosongkan bila ragu; tulis nama layanan di query.',
      ),
  }),
  allowedStates: NON_TERMINAL_STATES,
  async execute(ctx, args): Promise<ToolResult> {
    const out = await retrieve(ctx, args.query, args.kodeKabKota ?? ctx.urusan.kodeKabKota, args.layanan);
    return { content: formatHits(out.hasil, ctx.nonce), terbungkus: true };
  },
});

export const dukcapilCekPersyaratan = defineTool({
  name: 'dukcapil__cek_persyaratan',
  description:
    'Cek persyaratan layanan kependudukan untuk satu kab/kota (dirutekan lewat registry). Mengembalikan tingkat otomasi kota dan potongan bersumber.',
  effect: 'read',
  spanOperation: 'retrieval',
  input: z.object({ kodeKabKota, layanan: llmText().max(80) }),
  allowedStates: NON_TERMINAL_STATES,
  async execute(ctx, args): Promise<ToolResult> {
    const { entry } = routeByKode(args.kodeKabKota);
    const out = await retrieve(ctx, `persyaratan ${args.layanan}`, args.kodeKabKota, undefined);
    const head = `${entry.nama}: tingkat ${entry.tier}, validasi ${entry.validasi}${entry.portal ? `, portal ${entry.portal.nama}` : ''}.`;
    return {
      content: `${head}
${formatHits(out.hasil, ctx.nonce)}`,
      terbungkus: true,
    };
  },
});

export const urusanUsulkanRencana = defineTool({
  name: 'urusan__usulkan_rencana',
  description:
    'Usulkan rencana langkah kepada warga untuk disetujui. Memindahkan urusan ke RENCANA_DIUSULKAN.',
  effect: 'plan',
  input: z.object({
    ringkasan: llmText().max(300),
    langkah: z
      .array(
        z.object({
          judul: llmText().max(120),
          jenis: z.enum(['online-adapter', 'online-manual', 'offline']),
          bawa: z.array(llmText().max(80)).max(10).optional(),
        }),
      )
      .min(1)
      .max(10),
  }),
  allowedStates: ['MEMAHAMI'],
  execute(_ctx, args): ToolResult {
    return {
      content: 'Rencana ditampilkan kepada warga untuk disetujui.',
      nextState: 'RENCANA_DIUSULKAN',
      endTurn: true,
      events: [
        {
          type: 'plan_card',
          ringkasan: args.ringkasan,
          langkah: args.langkah.map((l, i) => ({
            id: `l${i + 1}`,
            judul: l.judul,
            jenis: l.jenis,
            bawa: l.bawa ?? [],
            sumber: [],
          })),
        },
      ],
    };
  },
});

/**
 * Jawaban persyaratan/prosedur: ditandai oleh tool ini (bukan regex). Tidak ada teks mentah yang di-stream;
 * hanya event progress, lalu objek tervalidasi (`grounded_answer`) atau `handoff`.
 */
export const urusanJawabPersyaratan = defineTool({
  name: 'urusan__jawab_persyaratan',
  description:
    'Susun jawaban bersumber atas pertanyaan persyaratan/prosedur dari potongan yang sudah dicari. Panggil setelah rag__cari_pengetahuan.',
  effect: 'answer',
  input: z.object({ pertanyaan: llmText().max(500) }),
  allowedStates: NON_TERMINAL_STATES,
  async execute(ctx, args): Promise<ToolResult> {
    const chunks = ctx.store.getChunks(ctx.urusan.id);
    const ctxHandoff = { kodeKabKota: ctx.urusan.kodeKabKota };
    const handoffEvent = (sebab: PayloadOf<'handoff'>['sebab']): ToolResult => ({
      content: 'Tidak ada sumber resmi yang cukup; warga diarahkan ke kanal resmi.',
      endTurn: true,
      events: [{ type: 'handoff', ...buildHandoff({ ...ctxHandoff, chunks }, sebab) }],
    });
    if (chunks.length === 0) return handoffEvent('tanpa_sumber');

    const gen = await generateGroundedAnswer({
      provider: ctx.deps.provider,
      model: ctx.deps.model,
      caps: ctx.deps.caps,
      pertanyaan: args.pertanyaan,
      chunks,
      signal: ctx.signal,
    });
    const verified = verifyGrounded(gen.data, chunks, ctxHandoff, ctx.deps.now());
    const usage = { usage: gen.usage, structuredMode: gen.method };
    if (verified.handoff) {
      return {
        ...handoffEvent(verified.handoff.sebab),
        events: [{ type: 'handoff', ...verified.handoff }],
        ...usage,
      };
    }
    const data: PayloadOf<'grounded_answer'> = {
      klaim: verified.klaim,
      klaimDibuang: verified.klaimDibuang,
      kalimatTetap: KALIMAT_TETAP,
    };
    return {
      content: `Jawaban bersumber (${verified.klaim.length} klaim) sudah ditampilkan kepada warga.`,
      endTurn: true,
      events: [{ type: 'grounded_answer', ...data }],
      ...usage,
    };
  },
});

/** Tool tulis: hanya untuk kota berstatus `kirim-asli`. Menghasilkan ExecutionRequest, tidak mengeksekusi apa pun sendiri. */
export const dukcapilAjukanLayanan = defineTool({
  name: 'dukcapil__ajukan_layanan',
  description:
    'Ajukan layanan di portal resmi kota lewat ekstensi (butuh confirmationId dari warga). Hanya kota berstatus kirim-asli.',
  effect: 'write',
  input: z.object({ kodeKabKota, layananId: z.number().int().positive() }),
  allowedStates: ['BERKAS_SIAP', 'MENGISI', 'MENUNGGU_KONFIRMASI', 'MENGUNGGAH'],
  origin(args) {
    const { entry } = routeByKode(args.kodeKabKota);
    return entry.validasi === 'kirim-asli' ? entry.portal?.origin : undefined;
  },
  execute(_ctx, args): ToolResult {
    const { entry } = routeByKode(args.kodeKabKota);
    return {
      content: 'Permintaan eksekusi dikirim ke ekstensi; warga akan diminta mengizinkan di overlay ekstensi.',
      execution: {
        executionId: `x_${randomUUID()}`,
        adapterId: entry.adapterId ?? `dukcapil.${entry.kodeKabKota}`,
        flowId: 'ajukan',
        ringkasan: `Ajukan layanan ${args.layananId} di ${entry.portal?.nama ?? entry.nama}. Data pribadi tersamar.`,
        params: { layanan_id: args.layananId },
        tool: 'dukcapil__ajukan_layanan',
        paramsHash: paramsHash('dukcapil__ajukan_layanan', args),
      },
    };
  },
});

/** Terdaftar supaya percobaan memanggilnya ditolak gate dengan aturan yang jelas; tidak pernah ditawarkan ke model. */
export const dukcapilKlikSelesai = defineTool({
  name: 'dukcapil__klik_selesai',
  description: 'Klik "Selesai" pada pengiriman akhir. Hanya warga yang boleh melakukannya (gate.human).',
  effect: 'final',
  input: z.object({}),
  allowedStates: NON_TERMINAL_STATES,
  execute(): ToolResult {
    throw new Error('tool final tidak boleh dijalankan agen');
  },
});

export function builtinTools(): ToolDef[] {
  return [
    ragCariPengetahuan,
    dukcapilCekPersyaratan,
    urusanUsulkanRencana,
    urusanJawabPersyaratan,
    dukcapilAjukanLayanan,
    dukcapilKlikSelesai,
  ] as unknown as ToolDef[];
}
