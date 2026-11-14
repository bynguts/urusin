import type { RagSearcher } from '@urusin/rag';
import { z } from 'zod';
import type {
  CapabilityFlags,
  ChatMessage,
  ChatProvider,
  ChatTool,
  ReasoningEffort,
  Usage,
} from '@urusin/llm';
import type { Db } from './db.js';
import type { CacheJawaban } from './grounding.js';
import type { EventPayload, PayloadOf, UrusanState } from '@urusin/contracts';
import type { IngatanTurn } from './ingatan.js';
import type { UrusanRow, HarnessStore } from './store.js';
import type { LayananCariWeb } from './web-cari.js';
import type { LayananBerkas } from './berkas.js';
import { TERMINAL_STATES, URUSAN_STATES } from './state.js';

/**
 * Definisi tool bernamespace (`<server>__<tool>`). "LLM memutuskan APA, kode memutuskan BAGAIMANA":
 * model hanya memilih tool + parameter enum/teks; langkah eksekusi (selector, URL, field_map) tidak pernah
 * ditulis model: tool menghasilkan ExecutionRequest `{adapterId, flowId, params}` yang diterjemahkan adapter
 * bawaan di ekstensi.
 *
 *  - read   : membaca/menelusuri, tanpa efek samping
 *  - plan   : mengusulkan rencana/ubah state internal (bukan efek di situs luar)
 *  - answer : menyusun jawaban persyaratan/prosedur (grounding wajib, tanpa streaming teks mentah)
 *  - write  : mengubah data di situs luar; WAJIB `confirmationId` yang cocok (dibuat warga)
 *  - final  : pengiriman akhir; tidak pernah dijalankan agen (hanya `gate.human` oleh warga)
 */
export type ToolEffect = 'read' | 'plan' | 'answer' | 'write' | 'final';

export const NON_TERMINAL_STATES: readonly UrusanState[] = URUSAN_STATES.filter(
  (s) => !TERMINAL_STATES.has(s),
);

export type ToolDeps = {
  provider: ChatProvider;
  model: string;
  caps: CapabilityFlags;
  /** Basis pengetahuan RAG (opsional; tanpa ini tool retrieval mengembalikan "tanpa hasil"). */
  ragDb?: Db | undefined;
  /** Pencari produksi (hybrid + rerank, @urusin/rag createRagSearcher); tanpa ini BM25 sinkron atas ragDb. */
  ragSearch?: RagSearcher['search'] | undefined;
  /** Cache keluaran generator jawaban bersumber (lihat `CacheJawaban`); tanpa ini tiap jawaban memanggil model. */
  cacheJawaban?: CacheJawaban | undefined;
  /** Cari web cadangan (Exa) + batas lajunya; tanpa ini `web__cari` tidak terdaftar. */
  cariWeb?: LayananCariWeb | undefined;
  /** Effort penalaran generator jawaban bersumber (LLM_GROUNDING_REASONING_EFFORT); kosong = global. */
  reasoningEffortJawaban?: ReasoningEffort | undefined;
  /** Render + simpan berkas buatan agen (`berkas__buat`); tanpa ini tool itu tidak terdaftar. */
  berkas?: LayananBerkas | undefined;
  now: () => Date;
};

export type ToolContext = {
  urusan: UrusanRow;
  store: HarnessStore;
  deps: ToolDeps;
  /** Nonce spotlighting untuk turn ini. */
  nonce: string;
  /** Pesan warga turn ini (sudah diredaksi): bukti bahwa warga sendiri menyebut/membenarkan sesuatu. */
  pesanWarga: string;
  signal: AbortSignal;
  /** Ingatan warga pemilik urusan (ADR 0031); tidak ada = urusan tanpa pemilik vault. */
  ingatan?: IngatanTurn | undefined;
  /**
   * Foto dokumen lampiran giliran ini belum jelas (peringatan yang sudah tampil ke warga, diredaksi): jawaban
   * bersumber tidak boleh menyatakan dokumen/foto warga sah atau dapat dipakai.
   */
  catatanFoto?: string | undefined;
  /** Pemilik brankas (Dokumen) peminta giliran ini: tujuan simpan + sumber nilai placeholder `berkas__buat`. */
  pemilikBerkas?: string | undefined;
};

export type EmittableEvent = EventPayload;
export type ExecutionRequest = PayloadOf<'execution_request'>;

export type ToolResult = {
  /** Teks ringkas untuk model; konten tak tepercaya SUDAH dibungkus spotlight oleh tool. */
  content: string;
  /** Konten sudah dianggarkan per bagian dan dibungkus spotlight: harness TIDAK boleh memotongnya (penutup pembungkus hilang). */
  terbungkus?: boolean;
  /**
   * Hasil ini memuat konten tak tepercaya (potongan RAG, teks halaman/OCR/berkas, keluaran tool luar) atau klaim
   * turunannya. Sejak itu `ingatan__ingat` dikunci di turn ini (ADR 0031).
   */
  takTepercaya?: boolean;
  events?: EmittableEvent[];
  execution?: ExecutionRequest;
  /** Transisi state yang diminta tool; diterapkan harness lewat CAS dan state machine. */
  nextState?: UrusanState;
  /** Wilayah yang ditetapkan tool (`wilayah__tetapkan`); diterapkan harness lewat CAS + event audit. */
  wilayah?: { ktp: string; domisili?: string | null; tujuan?: string | null };
  /** Jenis urusan yang ditetapkan model (`urusan__tetapkan_jenis`); diterapkan harness lewat CAS (`setJenis`). */
  jenis?: string;
  /** Jawaban berakhir hand-off, termasuk hand-off ulang tanpa event baru: rencana paralel dibatalkan. */
  handoff?: boolean;
  /** Akhiri turn setelah tool ini (mis. jawaban bersumber sudah dikirim ke warga). */
  endTurn?: boolean;
  /** Pemakaian token dari panggilan LLM bersarang di dalam tool (untuk meter biaya). */
  usage?: Usage[];
  structuredMode?: string;
};

export type ToolDef<S extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  effect: ToolEffect;
  input: S;
  allowedStates: readonly UrusanState[];
  /** Origin situs luar yang disentuh (wajib terdaftar di registry domain resmi untuk tool write). */
  origin?: (args: z.infer<S>, ctx: { urusan: UrusanRow }) => string | undefined;
  /**
   * Gerbang wilayah: tool ditolak (WILAYAH_BELUM_DITETAPKAN) sampai wilayah KTP (dan tujuan pindah) ditetapkan.
   */
  butuhWilayah?: boolean;
  /** Operasi span OTel; default `execute_tool`. */
  spanOperation?: 'execute_tool' | 'retrieval';
  /**
   * Hasil tool ini dapat memuat konten tak tepercaya. Dipakai untuk riwayat: selama hasilnya masih ada di riwayat
   * urusan, `ingatan__ingat` tetap dikunci di turn berikutnya (hasil di riwayat tidak membawa `takTepercaya`).
   */
  kontenLuar?: boolean;
  /**
   * Parameter boleh memuat placeholder brankas sah (`{{PEMOHON.NIK}}`) yang diisi server saat render (`berkas__buat`).
   * Policy gate tetap menolak NIK/HP/email mentah dan kurung kurawal yang bukan placeholder sah.
   */
  placeholderBrankas?: boolean;
  execute(ctx: ToolContext, args: z.infer<S>): Promise<ToolResult> | ToolResult;
};

export function defineTool<S extends z.ZodType>(def: ToolDef<S>): ToolDef<S> {
  if (!/^[a-z0-9]+__[a-z0-9_]+$/.test(def.name)) {
    throw new Error(`nama tool harus bernamespace "<server>__<tool>": ${def.name}`);
  }
  return def;
}

export const CONFIRMATION_FIELD = 'confirmationId';

/** Skema yang dilihat model: tool write otomatis mendapat `confirmationId` opsional. */
export function modelFacingSchema(tool: ToolDef): z.ZodType {
  if (tool.effect === 'write' && tool.input instanceof z.ZodObject) {
    return tool.input.extend({ [CONFIRMATION_FIELD]: z.string().optional() });
  }
  return tool.input;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDef>();

  constructor(tools: readonly ToolDef[] = []) {
    for (const t of tools) this.register(t);
  }

  register(tool: ToolDef): this {
    if (this.tools.has(tool.name)) throw new Error(`tool ganda: ${tool.name}`);
    this.tools.set(tool.name, tool);
    return this;
  }

  get(name: string): ToolDef | undefined {
    return this.tools.get(name);
  }

  /** Urutan deterministik (nama) agar prefix caching provider bisa bekerja. */
  list(): ToolDef[] {
    return [...this.tools.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  /** Subset yang boleh dipanggil model di state ini; tool `final` tidak pernah ditawarkan. */
  forState(state: UrusanState): ToolDef[] {
    return this.list().filter((t) => t.effect !== 'final' && t.allowedStates.includes(state));
  }

  /** Deskripsi tool untuk model (nama, deskripsi, JSON Schema parameter). */
  describe(state: UrusanState): { name: string; description: string; parameters: Record<string, unknown> }[] {
    return this.forState(state).map((t) => ({
      name: t.name,
      description: t.description,
      parameters: z.toJSONSchema(modelFacingSchema(t), { target: 'draft-7', io: 'input' }) as Record<
        string,
        unknown
      >,
    }));
  }

  openaiTools(state: UrusanState): ChatTool[] {
    return this.describe(state).map((t) => ({ type: 'function', function: t }));
  }
}

/** Hasil tool giliran lama yang tetap utuh di riwayat: isi jawaban bersumber tidak boleh disangkal model. */
const RIWAYAT_UTUH = new Set(['urusan__jawab_persyaratan', 'wilayah__tetapkan']);

/**
 * Hemat konteks: hasil tool dari giliran SEBELUMNYA (potongan RAG, persyaratan portal) dipangkas. Potongan itu
 * sudah tersimpan di store untuk verifikasi kutipan dan bisa dicari ulang; di riwayat ia menyumbang ~65% karakter
 * (eval p02: 21 rb dari 33 rb karakter) dan dikirim ulang di setiap panggilan model.
 */
export function ringkasRiwayat(history: readonly ChatMessage[], max = 400): ChatMessage[] {
  const nama = new Map<string, string>();
  return history.map((m) => {
    if (m.role === 'assistant' && m.tool_calls)
      for (const c of m.tool_calls) if (c.type === 'function') nama.set(c.id, c.function.name);
    if (m.role !== 'tool' || typeof m.content !== 'string' || m.content.length <= max) return m;
    if (RIWAYAT_UTUH.has(nama.get(m.tool_call_id) ?? '')) return m;
    return {
      ...m,
      content: `${m.content.slice(0, max)}…[hasil lama diringkas; panggil tool lagi bila perlu]`,
    };
  });
}

/** Potong hasil tool agar ringkas (hemat token). */
export function clip(text: string, max = 2000): string {
  return text.length <= max ? text : `${text.slice(0, max)}…[dipotong]`;
}
