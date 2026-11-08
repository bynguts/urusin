import { z } from 'zod';
import type { CapabilityFlags, ChatProvider, ChatTool, Usage } from '@urusin/llm';
import type { Db } from './db.js';
import type { ExecutionRequest, UrusanState, UrusinEvent } from './contracts.js';
import type { UrusanRow, HarnessStore } from './store.js';
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
  now: () => Date;
};

export type ToolContext = {
  urusan: UrusanRow;
  store: HarnessStore;
  deps: ToolDeps;
  /** Nonce spotlighting untuk turn ini. */
  nonce: string;
  signal: AbortSignal;
};

export type EmittableEvent = UrusinEvent;

export type ToolResult = {
  /** Teks ringkas untuk model; konten tak tepercaya SUDAH dibungkus spotlight oleh tool. */
  content: string;
  events?: EmittableEvent[];
  execution?: ExecutionRequest;
  /** Transisi state yang diminta tool; diterapkan harness lewat CAS dan state machine. */
  nextState?: UrusanState;
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
  /** Operasi span OTel; default `execute_tool`. */
  spanOperation?: 'execute_tool' | 'retrieval';
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

/** Potong hasil tool agar ringkas (hemat token). */
export function clip(text: string, max = 2000): string {
  return text.length <= max ? text : `${text.slice(0, max)}…[dipotong]`;
}
