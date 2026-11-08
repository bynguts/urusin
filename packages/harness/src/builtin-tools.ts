import { randomUUID } from 'node:crypto';
import { llmText } from '@urusin/core';
import { cariPengetahuanTool } from '@urusin/rag';
import { routeByKode } from '@urusin/registry';
import { z } from 'zod';
import type { GroundedAnswerEvent, HandoffEvent } from './contracts.js';
import { KALIMAT_TETAP, buildHandoff, generateGroundedAnswer, verifyGrounded } from './grounding.js';
import { spotlight } from './spotlight.js';
import { paramsHash, type ChunkRecord } from './store.js';
import {
  NON_TERMINAL_STATES,
  clip,
  defineTool,
  type ToolContext,
  type ToolDef,
  type ToolResult,
} from './tools.js';

const kodeKabKota = z.string().regex(/^\d{4}$/);

type Hit = ReturnType<typeof cariPengetahuanTool.execute>['hasil'][number];

function formatHits(hits: readonly Hit[], nonce: string, max = 4): string {
  if (hits.length === 0) return 'Tidak ada hasil di basis pengetahuan resmi. Arahkan warga ke kanal resmi.';
  return hits
    .slice(0, max)
    .map(
      (h) =>
        `[${h.id}] ${h.kutipan.judul} — ${h.kutipan.instansi} (diverifikasi: ${h.verifiedAt ?? 'belum'})\n` +
        spotlight('rag', h.text, { nonce, id: h.id, maxChars: 500 }),
    )
    .join('\n');
}

function retrieve(ctx: ToolContext, query: string, kode: string | null | undefined, layanan?: string) {
  if (!ctx.deps.ragDb) return { hasil: [] as Hit[], tanpaHasil: true };
  const out = cariPengetahuanTool.execute(ctx.deps.ragDb, {
    query,
    ...(kode ? { kodeKabKota: kode } : {}),
    ...(layanan ? { layanan } : {}),
    k: 4,
  });
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
    layanan: llmText().max(80).optional(),
  }),
  allowedStates: NON_TERMINAL_STATES,
  execute(ctx, args): ToolResult {
    const out = retrieve(ctx, args.query, args.kodeKabKota ?? ctx.urusan.kodeKabKota, args.layanan);
    return { content: clip(formatHits(out.hasil, ctx.nonce)) };
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
  execute(ctx, args): ToolResult {
    const { entry } = routeByKode(args.kodeKabKota);
    const out = retrieve(ctx, `persyaratan ${args.layanan}`, args.kodeKabKota, undefined);
    const head = `${entry.nama}: tingkat ${entry.tier}, validasi ${entry.validasi}${entry.portal ? `, portal ${entry.portal.nama}` : ''}.`;
    return { content: clip(`${head}\n${formatHits(out.hasil, ctx.nonce)}`) };
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
          type: 'plan',
          data: {
            ringkasan: args.ringkasan,
            langkah: args.langkah.map((l, i) => ({ id: `l${i + 1}`, judul: l.judul, jenis: l.jenis })),
          },
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
    const handoffEvent = (alasan: HandoffEvent['data']['alasan']): ToolResult => ({
      content: 'Tidak ada sumber resmi yang cukup; warga diarahkan ke kanal resmi.',
      endTurn: true,
      events: [{ type: 'handoff', data: buildHandoff({ ...ctxHandoff, chunks }, alasan) }],
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
        ...handoffEvent(verified.handoff.alasan),
        events: [{ type: 'handoff', data: verified.handoff }],
        ...usage,
      };
    }
    const data: GroundedAnswerEvent['data'] = {
      klaim: verified.klaim,
      klaimDibuang: verified.klaimDibuang,
      kalimatTetap: KALIMAT_TETAP,
    };
    return {
      content: `Jawaban bersumber (${verified.klaim.length} klaim) sudah ditampilkan kepada warga.`,
      endTurn: true,
      events: [{ type: 'grounded_answer', data }],
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
