import type { RagSearcher } from '@urusin/rag';
import {
  LlmContentFilterError,
  LlmLengthError,
  LlmRefusalError,
  StructuredOutputError,
  assertCompletionUsable,
  generateStructured,
  isLlmTerminalError,
  isRetryableError,
  type CapabilityFlags,
  type ChatCompletion,
  type ChatMessage,
  type ChatParams,
  type ChatProvider,
  type Usage,
} from '@urusin/llm';
import { z } from 'zod';
import type { EventBus } from './bus.js';
import type { Db } from './db.js';
import type { EventOf, EventPayload, UrusanState, UrusinEvent } from '@urusin/contracts';
import { HarnessError, TurnInProgressError } from './errors.js';
import { tierUrusan } from './rencana.js';
import { toEvent } from './envelope.js';
import { buildHandoff } from './grounding.js';
import {
  INGAT_TOOL,
  blokIngatan,
  ingatWilayah,
  muatKonteks,
  type IngatanTurn,
  type PenyimpanIngatan,
} from './ingatan.js';
import { classifyIntent } from './intent.js';
import { PiiInterceptor } from './pii.js';
import { PolicyGate } from './policy.js';
import { buildStateNote, buildSystemPrompt } from './prompt.js';
import type { QuotaMeter, QuotaStatus } from './quota.js';
import { newNonce } from './spotlight.js';
import type { HarnessStore, TurnStatus, UrusanRow } from './store.js';
import { clip, ringkasRiwayat, type ToolContext, type ToolRegistry } from './tools.js';
import { OTEL, type Tracer } from './trace.js';
import {
  kodeUntukPii,
  selaraskanUsulan,
  tetapkanWilayah,
  usulkanRencanaOtomatis,
  wilayahUrusan,
} from './wilayah.js';

export type AgentConfig = {
  /** Batas waktu satu turn (rencana: 120 detik). */
  turnTimeoutMs: number;
  /** Batas waktu satu panggilan LLM (rencana: 60 detik + 1 retry). */
  llmTimeoutMs: number;
  /** Iterasi tool maksimum per turn (rencana: 8). */
  maxSteps: number;
};

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  turnTimeoutMs: 120_000,
  llmTimeoutMs: 60_000,
  maxSteps: 8,
};

export type AgentDeps = {
  store: HarnessStore;
  provider: ChatProvider;
  model: string;
  caps: CapabilityFlags;
  registry: ToolRegistry;
  quota: QuotaMeter;
  tracer: Tracer;
  ragDb?: Db | undefined;
  ragSearch?: RagSearcher['search'] | undefined;
  bus?: EventBus | undefined;
  config?: Partial<AgentConfig> | undefined;
  now?: (() => Date) | undefined;
  /** Mutex per-urusan in-process (server tunggal). Dibagi antar pemanggilan; default instance global modul. */
  locks?: Set<string> | undefined;
  /** Ingatan warga lintas urusan (ADR 0031); tanpa ini tidak ada blok ingatan dan tool `ingatan__ingat`. */
  ingatan?: PenyimpanIngatan | undefined;
};

export type TurnOutcome = {
  turnId: string;
  status: 'selesai' | 'timeout' | 'galat' | 'dibatalkan';
  degraded: boolean;
  /** Event yang dipancarkan turn ini (berurutan). */
  events: UrusinEvent[];
  tokensIn: number;
  tokensOut: number;
  costIdr: number;
};

const GLOBAL_LOCKS = new Set<string>();

/** Nama tool sah: huruf kecil, angka, garis bawah; maksimal 64 karakter. */
const TOOL_NAME_RE = /^[a-z0-9_]{1,64}$/;
const safeToolName = (n: string) => (TOOL_NAME_RE.test(n) ? n : 'tool_tak_valid');

class TurnAbort extends Error {
  constructor(readonly kind: 'timeout' | 'external') {
    super(`turn dihentikan: ${kind}`);
    this.name = 'TurnAbort';
  }
}

const ActionSchema = z.object({
  jenis: z.enum(['balas', 'tool']),
  teks: z.string().optional(),
  nama: z.string().optional(),
  argsJson: z.string().optional(),
  confirmationId: z.string().optional(),
});

/**
 * Klaim satu turn secara sinkron (CAS + BEGIN IMMEDIATE + mutex per-urusan) dan kembalikan `run()`.
 * Dipisah agar endpoint bisa menjawab 409 sebelum mengalirkan apa pun.
 */
export function prepareTurn(
  deps: AgentDeps,
  args: { urusanId: string; userText: string; expectedVersion?: number },
): { turnId: string; run(signal?: AbortSignal): Promise<TurnOutcome> } {
  const locks = deps.locks ?? GLOBAL_LOCKS;
  if (locks.has(args.urusanId)) throw new TurnInProgressError();
  locks.add(args.urusanId);
  let claim: ReturnType<HarnessStore['claimTurn']>;
  const pii = new PiiInterceptor(
    undefined,
    { kodeKabKota: kodeUntukPii(deps.store, deps.store.getUrusan(args.urusanId)) },
    deps.store.placeholderPersistence(args.urusanId),
  );
  const userText = pii.redact(args.userText).text;
  try {
    claim = deps.store.claimTurn(args.urusanId, userText, {
      ...(args.expectedVersion !== undefined ? { expectedVersion: args.expectedVersion } : {}),
    });
  } catch (e) {
    locks.delete(args.urusanId);
    throw e;
  }
  return {
    turnId: claim.turnId,
    run: (signal) =>
      new TurnRunner(deps, {
        urusanId: args.urusanId,
        userText,
        turnId: claim.turnId,
        version: claim.version,
        pii,
      })
        .run(signal)
        .finally(() => locks.delete(args.urusanId)),
  };
}

/** Jalankan satu turn dari awal sampai akhir. */
export function runTurn(
  deps: AgentDeps,
  args: { urusanId: string; userText: string; expectedVersion?: number; signal?: AbortSignal },
): Promise<TurnOutcome> {
  return prepareTurn(deps, args).run(args.signal);
}

function toErrorEvent(err: unknown): EventPayload & { type: 'error' } {
  const mk = (kode: EventOf<'error'>['kode'], pesanWarga: string, bisaUlang: boolean) => ({
    type: 'error' as const,
    kode,
    pesanWarga,
    bisaUlang,
  });
  if (err instanceof LlmRefusalError) {
    return mk(
      'LLM_REFUSAL',
      'Asisten menolak menjawab permintaan ini. Coba ubah pertanyaan, atau tanyakan ke kanal resmi.',
      false,
    );
  }
  if (err instanceof LlmLengthError) {
    return mk(
      'LLM_LENGTH',
      'Jawaban terpotong karena terlalu panjang. Coba pertanyaan yang lebih spesifik.',
      true,
    );
  }
  if (err instanceof LlmContentFilterError) {
    return mk('LLM_CONTENT_FILTER', 'Jawaban disaring oleh penyedia AI. Coba ubah pertanyaan.', false);
  }
  if (err instanceof HarnessError)
    return mk(err.status === 409 ? 'CONFLICT' : 'INTERNAL', err.message, err.status === 409);
  return mk('LLM_FAILED', 'Layanan AI sedang bermasalah. Silakan coba lagi.', true);
}

const ULANG_RINGKAS =
  'Balasanmu tadi terpotong karena terlalu panjang. Sekarang panggil tool yang tepat, atau balas SANGAT singkat (paling banyak 3 kalimat pendek).';

/** Sisipkan instruksi sebelum pesan terakhir (pesan pengguna tetap terakhir). */
function withInstruction(messages: ChatMessage[], instruction: ChatMessage): ChatMessage[] {
  return [...messages.slice(0, -1), instruction, ...messages.slice(-1)];
}

class TurnRunner {
  private readonly cfg: AgentConfig;
  private readonly store: HarnessStore;
  private readonly gate: PolicyGate;
  private readonly now: () => Date;
  private readonly nonce = newNonce();
  private readonly ctrl = new AbortController();
  private readonly events: UrusinEvent[] = [];
  private readonly turnMessages: ChatMessage[] = [];
  /** Balasan model terpotong (finish_reason=length) sekali di turn ini: diulang sekali dengan instruksi ringkas. */
  private terpotong = false;
  private urusan: UrusanRow;
  private version: number;
  private tokensIn = 0;
  private tokensOut = 0;
  private costIdr = 0;
  private degraded = false;
  private lanjutkan = false;
  /** Ingatan pemilik urusan, dimuat sekali per turn (blok prompt stabil selama turn). */
  private readonly ingatan: IngatanTurn | null;
  private readonly blokIngatan: string | null;

  constructor(
    private readonly deps: AgentDeps,
    private readonly turn: {
      urusanId: string;
      userText: string;
      turnId: string;
      version: number;
      pii: PiiInterceptor;
    },
  ) {
    this.cfg = { ...DEFAULT_AGENT_CONFIG, ...deps.config };
    this.store = deps.store;
    this.now = deps.now ?? (() => new Date());
    this.gate = new PolicyGate(deps.registry, deps.store, this.now);
    this.urusan = deps.store.getUrusanOrThrow(turn.urusanId);
    this.version = turn.version;
    this.turnMessages.push({ role: 'user', content: turn.userText });
    const k = deps.ingatan ? muatKonteks(deps.ingatan, deps.store, turn.urusanId) : null;
    this.ingatan = k && deps.ingatan ? { pemilik: k.pemilik, penyimpan: deps.ingatan } : null;
    this.blokIngatan = k ? blokIngatan(k, this.nonce) : null;
  }

  /** Tool `ingatan__ingat` hanya ditawarkan bila urusan punya pemilik vault. */
  private toolDitawarkan(nama: string): boolean {
    return nama !== INGAT_TOOL || this.ingatan !== null;
  }

  private get scope() {
    return { urusanId: this.turn.urusanId, turnId: this.turn.turnId };
  }

  private emit(e: EventPayload): UrusinEvent {
    const { type, ...isi } = e;
    const env = toEvent(this.store.appendEvent(this.turn.urusanId, type, isi));
    this.events.push(env);
    this.deps.bus?.publish(this.turn.urusanId, env);
    return env;
  }

  private progress(label: string, toolName?: string) {
    this.emit({ type: 'progress', label, ...(toolName ? { toolName } : {}) });
  }

  private tier(): 'semi' | 'dipandu' | null {
    return tierUrusan(this.urusan);
  }

  private applyTransition(to: UrusanState): void {
    const from = this.urusan.state;
    this.urusan = this.store.transition(this.turn.urusanId, this.version, to);
    this.version = this.urusan.version;
    this.emit({ type: 'state', state: to, tier: this.tier(), version: this.version, dari: from });
  }

  private account(usage: readonly Usage[]): { tokensIn: number; tokensOut: number; costIdr: number } {
    let tokensIn = 0;
    let tokensOut = 0;
    let costIdr = 0;
    for (const u of usage) {
      tokensIn += u.prompt_tokens;
      tokensOut += u.completion_tokens;
      costIdr += this.deps.quota.costIdr(u);
      this.store.addUsage(this.turn.urusanId, {
        tokensIn: u.prompt_tokens,
        tokensOut: u.completion_tokens,
        costIdr: this.deps.quota.costIdr(u),
        degraded: this.degraded,
      });
    }
    this.tokensIn += tokensIn;
    this.tokensOut += tokensOut;
    this.costIdr += costIdr;
    this.urusan = this.store.getUrusanOrThrow(this.turn.urusanId);
    return { tokensIn, tokensOut, costIdr };
  }

  private llmSignal(): AbortSignal {
    return AbortSignal.any([this.ctrl.signal, AbortSignal.timeout(this.cfg.llmTimeoutMs)]);
  }

  private quotaStatus(): QuotaStatus {
    return this.deps.quota.check(this.urusan);
  }

  /** Semua pesan diredaksi (lapis 1) tepat sebelum dikirim; catatan state disisipkan sebelum pesan terakhir. */
  private buildMessages(note: string, extra: ChatMessage[] = []): ChatMessage[] {
    const turnMsgs = [...this.turnMessages, ...extra];
    const history = ringkasRiwayat(this.store.loadHistory(this.turn.urusanId));
    // Catatan tidak boleh memisahkan assistant(tool_calls) dari hasil tool-nya: penyedia menolak urutan itu
    // (400). Bila pesan terakhir hasil tool, sisipkan sebelum assistant pemilik grup tool terakhir.
    let cut = turnMsgs.length - 1;
    while (cut > 0 && turnMsgs[cut]?.role === 'tool') cut--;
    cut = Math.max(cut, 0);
    return this.turn.pii.redactMessages([
      { role: 'system', content: buildSystemPrompt() },
      // Ingatan warga (ADR 0031) sesudah prompt statis: prefix statis tetap bisa di-cache provider.
      ...(this.blokIngatan ? [{ role: 'system' as const, content: this.blokIngatan }] : []),
      ...history,
      ...turnMsgs.slice(0, cut),
      { role: 'system', content: note },
      ...turnMsgs.slice(cut),
    ]);
  }

  private stateNote(): string {
    return buildStateNote({
      state: this.urusan.state,
      jenis: this.urusan.jenis,
      kodeKabKota: this.urusan.kodeKabKota,
      wilayah: wilayahUrusan(this.store, this.urusan),
      tools: this.deps.registry.forState(this.urusan.state).filter((t) => this.toolDitawarkan(t.name)),
      confirmations: this.store.activeConfirmations(this.turn.urusanId),
      pesanWarga: this.turn.pii.redact(this.turn.userText).text,
      ingatanAktif: this.ingatan !== null,
    });
  }

  private async callLlm(params: ChatParams): Promise<ChatCompletion> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.deps.provider.create(params, { signal: this.llmSignal() });
      } catch (e) {
        if (this.ctrl.signal.aborted) throw e;
        const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'APIUserAbortError');
        if (attempt === 0 && (isRetryableError(e) || timedOut)) continue;
        throw e;
      }
    }
  }

  async run(externalSignal?: AbortSignal): Promise<TurnOutcome> {
    const onExternal = () => this.ctrl.abort(new TurnAbort('external'));
    if (externalSignal?.aborted) onExternal();
    externalSignal?.addEventListener('abort', onExternal, { once: true });
    const timer = setTimeout(() => this.ctrl.abort(new TurnAbort('timeout')), this.cfg.turnTimeoutMs);
    // Lease diperpanjang selama turn hidup; instance lain tidak boleh menganggap turn ini yatim.
    const lease = setInterval(
      () => this.store.renewLease(this.turn.turnId),
      Math.max(10, this.store.leaseMs / 3),
    );
    lease.unref();
    let status: TurnOutcome['status'] = 'selesai';
    let dbStatus: Exclude<TurnStatus, 'running'> = 'done';
    let errorCode: string | undefined;
    try {
      await this.body();
      this.proposeRencana();
      this.selaraskanKartuWilayah();
    } catch (err) {
      const reason = this.ctrl.signal.aborted ? (this.ctrl.signal.reason as unknown) : undefined;
      if (reason instanceof TurnAbort && reason.kind === 'timeout') {
        status = 'timeout';
        dbStatus = 'timeout';
        errorCode = 'TIMEOUT';
        this.emit({ type: 'timeout' });
      } else if (reason instanceof TurnAbort) {
        status = 'dibatalkan';
        dbStatus = 'aborted';
        errorCode = 'ABORTED';
      } else {
        status = 'galat';
        dbStatus = 'error';
        const ev = toErrorEvent(err);
        errorCode = ev.kode;
        this.emit(ev);
      }
    } finally {
      clearTimeout(timer);
      clearInterval(lease);
      externalSignal?.removeEventListener('abort', onExternal);
    }
    this.store.finishTurn(this.turn.turnId, {
      status: dbStatus,
      messages: this.turnMessages,
      tokensIn: this.tokensIn,
      tokensOut: this.tokensOut,
      costIdr: this.costIdr,
      degraded: this.degraded,
      errorCode,
    });
    {
      this.emit({
        type: 'done',
        turnId: this.turn.turnId,
        status,
        lanjutkan: this.lanjutkan,
        degraded: this.degraded,
        version: this.version,
      });
    }
    return {
      turnId: this.turn.turnId,
      status,
      degraded: this.degraded,
      events: this.events,
      tokensIn: this.tokensIn,
      tokensOut: this.tokensOut,
      costIdr: this.costIdr,
    };
  }

  /** Rencana deterministik dari wilayah KTP (lihat `usulkanRencanaOtomatis`); juga saat AI mati/kuota habis. */
  private proposeRencana(): void {
    this.urusan = usulkanRencanaOtomatis(
      this.store,
      { ...this.urusan, version: this.version },
      (e) => void this.emit(e),
      this.deps.ragDb,
    );
    this.version = this.urusan.version;
  }

  /** Kartu usulan wilayah mengikuti kab/kota yang terakhir ditanyakan agen (lihat `selaraskanUsulan`). */
  private selaraskanKartuWilayah(): void {
    const teks = [...this.turnMessages]
      .reverse()
      .find((m) => m.role === 'assistant' && typeof m.content === 'string' && m.content);
    if (teks?.role !== 'assistant' || typeof teks.content !== 'string') return;
    selaraskanUsulan(this.store, this.urusan, teks.content, (e) => void this.emit(e));
  }

  private async body(): Promise<void> {
    if (this.urusan.state === 'BARU') this.applyTransition('MEMAHAMI');
    this.progress('Memahami kebutuhan Anda…');
    if (this.urusan.jenis === null) await this.classify();
    if (this.quotaStatus().mode === 'hemat')
      this.emit({ type: 'degraded', kapabilitas: ['rerank'], mode: 'hemat' });

    if (!this.deps.caps.tools) {
      this.degraded = true;
      this.emit({ type: 'degraded', kapabilitas: ['tool_calling'], mode: null });
      await this.degradedAction();
      return;
    }
    await this.toolLoop();
  }

  private async classify(): Promise<void> {
    const q = this.quotaStatus();
    if (q.mode === 'habis') return this.quotaStop(q);
    const span = this.deps.tracer.start(this.scope, `chat ${this.deps.model}`, 'chat');
    try {
      const r = await classifyIntent({
        provider: this.deps.provider,
        model: this.deps.model,
        caps: this.deps.caps,
        text: this.turn.pii.redact(this.turn.userText).text,
        signal: this.llmSignal(),
      });
      const acc = this.account(r.usage);
      span.end({
        model: this.deps.model,
        ...acc,
        structuredMode: r.method,
        degraded: r.degraded,
        attrs: { [OTEL.operationName]: 'chat', 'urusin.step': 'klasifikasi' },
      });
      this.urusan = this.store.setJenis(this.turn.urusanId, this.version, r.data.jenis);
      this.version = this.urusan.version;
    } catch (e) {
      span.end({ status: 'error', errorCode: (e as Error).name, model: this.deps.model });
      if (isLlmTerminalError(e) || this.ctrl.signal.aborted) throw e;
      if (!(e instanceof StructuredOutputError)) throw e;
      this.urusan = this.store.setJenis(this.turn.urusanId, this.version, 'lainnya');
      this.version = this.urusan.version;
    }
  }

  private quotaStop(q: QuotaStatus): void {
    const handoff = buildHandoff({ kodeKabKota: this.urusan.kodeKabKota, jenis: this.urusan.jenis }, 'kuota');
    this.emit({ type: 'degraded', kapabilitas: ['llm'], mode: 'tanpa_ai' });
    this.emit({
      type: 'error',
      kode: 'QUOTA',
      pesanWarga: `Kuota layanan AI habis (${q.reason ?? 'batas'}). Jalur dipandu tetap tersedia.`,
      bisaUlang: false,
    });
    this.emit({ type: 'handoff', ...handoff });
  }

  // --- mode normal: tool-calling ---

  private async toolLoop(): Promise<void> {
    for (let step = 0; step < this.cfg.maxSteps; step++) {
      const q = this.quotaStatus();
      if (q.mode === 'habis') return this.quotaStop(q);
      const tools = this.deps.registry
        .openaiTools(this.urusan.state)
        .filter((t) => t.type !== 'function' || this.toolDitawarkan(t.function.name));
      const span = this.deps.tracer.start(this.scope, `chat ${this.deps.model}`, 'chat');
      let completion: ChatCompletion;
      // Setelah terpotong: ruang token dua kali lipat dan instruksi balasan singkat (eval p06: satu balasan
      // pembuka melewati batas, padahal rata-rata balasan < 100 token).
      const maxTokens = this.terpotong ? q.maxTokens * 2 : q.maxTokens;
      const messages = this.buildMessages(this.stateNote());
      try {
        completion = await this.callLlm({
          model: this.deps.model,
          max_tokens: maxTokens,
          messages: this.terpotong
            ? withInstruction(messages, { role: 'system', content: ULANG_RINGKAS })
            : messages,
          ...(tools.length > 0 ? { tools, tool_choice: 'auto' as const } : {}),
        });
        const acc = this.account(completion.usage ? [completion.usage] : []);
        span.end({
          model: this.deps.model,
          ...acc,
          degraded: false,
          attrs: { [OTEL.operationName]: 'chat' },
        });
        assertCompletionUsable(completion, maxTokens);
      } catch (e) {
        span.end({ status: 'error', errorCode: (e as Error).name, model: this.deps.model });
        if (e instanceof LlmLengthError && !this.terpotong) {
          this.terpotong = true;
          continue;
        }
        throw e;
      }

      const msg = completion.choices[0]?.message;
      const calls = (msg?.tool_calls ?? []).filter((c) => c.type === 'function');
      if (!msg || calls.length === 0) {
        const text = this.sanitizeOutput(msg?.content ?? '');
        this.turnMessages.push({ role: 'assistant', content: text });
        if (text) this.emit({ type: 'assistant_text', delta: text });
        return;
      }

      const group: ChatMessage[] = [
        {
          role: 'assistant',
          content: msg.content ?? null,
          tool_calls: calls.map((c) => ({
            id: c.id,
            type: 'function' as const,
            function: { ...c.function, name: safeToolName(c.function.name) },
          })),
        },
      ];
      let ended = false;
      for (const call of calls) {
        if (ended) {
          group.push({ role: 'tool', tool_call_id: call.id, content: 'dilewati: turn sudah selesai' });
          continue;
        }
        const r = await this.handleToolCall(call.function.name, call.function.arguments);
        group.push({ role: 'tool', tool_call_id: call.id, content: r.content });
        ended = r.end;
      }
      this.turnMessages.push(...group);
      if (ended) return;
    }
    this.emit({
      type: 'error',
      kode: 'LLM_FAILED',
      pesanWarga: 'Terlalu banyak langkah tanpa hasil. Coba pertanyaan yang lebih spesifik.',
      bisaUlang: true,
    });
  }

  private sanitizeOutput(text: string): string {
    // eslint-disable-next-line no-control-regex -- membuang karakter kontrol dari teks model
    const clean = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
    return this.turn.pii.redact(clean.slice(0, 4000)).text.trim();
  }

  /** Satu-satunya jalur eksekusi tool (normal maupun degraded): selalu lewat policy gate. */
  private async handleToolCall(
    rawName: string,
    argsJson: string,
  ): Promise<{ content: string; end: boolean }> {
    // Nama tool datang dari model: jangan pernah dicatat/dipantulkan mentah (bisa memuat PII atau berukuran besar).
    const name = safeToolName(rawName);
    let raw: unknown;
    try {
      raw = JSON.parse(argsJson || '{}');
    } catch {
      this.emit({
        type: 'policy_gate',
        tool: name,
        keputusan: 'deny',
        aturan: 'SCHEMA_INVALID',
        pesan: 'argumen bukan JSON valid',
      });
      return {
        content: JSON.stringify({
          is_error: true,
          aturan: 'SCHEMA_INVALID',
          pesan: 'argumen bukan JSON valid',
        }),
        end: false,
      };
    }
    const gSpan = this.deps.tracer.start(this.scope, `gate ${name}`, 'urusin.gate');
    const outcome = this.gate.evaluate({
      urusan: this.urusan,
      state: this.urusan.state,
      toolName: name,
      rawArgs: raw,
      quota: this.quotaStatus(),
    });
    gSpan.end({
      attrs: {
        [OTEL.toolName]: name,
        'urusin.gate.decision': outcome.allow ? 'allow' : 'deny',
        ...(outcome.allow ? {} : { 'urusin.gate.rule': outcome.rule }),
      },
    });

    if (!outcome.allow) {
      this.emit({
        type: 'policy_gate',
        tool: name,
        keputusan: 'deny',
        aturan: outcome.rule,
        pesan: outcome.message,
      });
      if (outcome.rule === 'CONFIRMATION_REQUIRED' || outcome.rule === 'FINAL_REQUIRES_CITIZEN') {
        this.emit({
          type: 'gate',
          jenis: outcome.rule === 'FINAL_REQUIRES_CITIZEN' ? 'final' : 'konfirmasi',
          pesan: outcome.message,
          ...(outcome.paramsHash ? { tool: name, paramsHash: outcome.paramsHash } : {}),
        });
      }
      return {
        content: JSON.stringify({ is_error: true, aturan: outcome.rule, pesan: outcome.message }),
        end: false,
      };
    }
    const tool = outcome.tool;
    if (tool.effect === 'write') this.emit({ type: 'policy_gate', tool: name, keputusan: 'allow' });
    this.progress(`Menjalankan ${name}…`, name);

    const span = this.deps.tracer.start(
      this.scope,
      `${tool.spanOperation ?? 'execute_tool'} ${name}`,
      tool.spanOperation ?? 'execute_tool',
    );
    const ctx: ToolContext = {
      urusan: this.urusan,
      store: this.store,
      deps: {
        provider: this.deps.provider,
        model: this.deps.model,
        caps: this.deps.caps,
        ragDb: this.deps.ragDb,
        ragSearch: this.deps.ragSearch,
        now: this.now,
      },
      nonce: this.nonce,
      pesanWarga: this.turn.userText,
      signal: this.llmSignal(),
      ingatan: this.ingatan ?? undefined,
    };
    try {
      const res = await tool.execute(ctx, outcome.args as never);
      const acc = res.usage ? this.account(res.usage) : undefined;
      span.end({
        ...(acc ? { model: this.deps.model, ...acc } : {}),
        ...(res.structuredMode ? { structuredMode: res.structuredMode } : {}),
        attrs: { [OTEL.toolName]: name, [OTEL.operationName]: tool.spanOperation ?? 'execute_tool' },
      });
      if (tool.effect === 'answer') this.progress('Memverifikasi kutipan ke sumber resmi…');
      for (const e of res.events ?? []) this.emit(e);
      if (res.execution) {
        this.emit({ type: 'execution_request', ...res.execution });
        // Tool baca: belum ada gate konfirmasi sebelumnya, jadi warga tetap menyetujui sebelum peramban dibuka.
        // Gate dikirim SESUDAH permintaan agar kartu konfirmasi menemukannya lewat paramsHash.
        if (tool.effect !== 'write')
          this.emit({
            type: 'gate',
            jenis: 'konfirmasi',
            pesan: 'Izinkan Browser Pendamping membuka situs resmi untuk membaca saja?',
            tool: res.execution.tool,
            paramsHash: res.execution.paramsHash,
          });
      }
      if (res.wilayah) {
        try {
          this.urusan = tetapkanWilayah(
            this.store,
            { ...this.urusan, version: this.version },
            res.wilayah,
            (e) => void this.emit(e),
          );
          this.version = this.urusan.version;
          this.ingatWilayah(res.wilayah);
        } catch (e) {
          if (!(e instanceof HarnessError)) throw e;
          return { content: JSON.stringify({ is_error: true, pesan: e.message }), end: false };
        }
      }
      if (res.nextState) {
        try {
          this.applyTransition(res.nextState);
        } catch (e) {
          if (!(e instanceof HarnessError)) throw e;
          return { content: JSON.stringify({ is_error: true, pesan: e.message }), end: false };
        }
      }
      return { content: res.terbungkus ? res.content : clip(res.content), end: res.endTurn === true };
    } catch (e) {
      // Tindakan tidak sampai ke warga: konfirmasi tidak boleh hangus.
      if (outcome.confirmationId) this.store.releaseConfirmation(outcome.confirmationId);
      span.end({ status: 'error', errorCode: (e as Error).name, attrs: { [OTEL.toolName]: name } });
      if (this.ctrl.signal.aborted || isLlmTerminalError(e)) throw e;
      if (e instanceof HarnessError) throw e;
      return { content: JSON.stringify({ is_error: true, pesan: 'tool gagal dijalankan' }), end: false };
    }
  }

  /** Wilayah yang baru ditetapkan warga dicatat ke ingatan (kartu "Urusin mengingat"); gagal simpan tidak menggagalkan turn. */
  private ingatWilayah(w: { ktp: string; domisili?: string | null; tujuan?: string | null }): void {
    if (!this.ingatan) return;
    try {
      for (const e of ingatWilayah(this.ingatan, this.urusan.jenis, w, this.now().toISOString()))
        this.emit(e);
    } catch {
      // vault tidak tersedia (mis. pemilik baru saja dihapus): wilayah urusan tetap tercatat.
    }
  }

  // --- mode degraded: JSON satu aksi per turn (json_object + zod), tetap lewat policy gate ---

  private async degradedAction(): Promise<void> {
    const q = this.quotaStatus();
    if (q.mode === 'habis') return this.quotaStop(q);
    const tools = this.deps.registry.forState(this.urusan.state).filter((t) => this.toolDitawarkan(t.name));
    const catalog = this.deps.registry
      .describe(this.urusan.state)
      .filter((t) => this.toolDitawarkan(t.name))
      .map((t) => `- ${t.name}: ${t.description} parameter=${JSON.stringify(t.parameters)}`)
      .join('\n');
    const instruction: ChatMessage = {
      role: 'system',
      content: [
        'MODE TERBATAS: kamu tidak bisa memanggil tool secara langsung. Pilih SATU aksi per giliran dan balas JSON:',
        '{jenis:"balas", teks} untuk membalas warga, atau {jenis:"tool", nama, argsJson (string JSON parameter), confirmationId?} untuk memanggil tool.',
        `Tool yang tersedia (${tools.length}):`,
        catalog || '(tidak ada)',
      ].join('\n'),
    };
    const span = this.deps.tracer.start(this.scope, `chat ${this.deps.model}`, 'chat');
    try {
      const gen = await generateStructured({
        provider: this.deps.provider,
        model: this.deps.model,
        caps: { json_schema_strict: this.deps.caps.json_schema_strict, tools: false },
        schema: ActionSchema,
        name: 'aksi_agen',
        maxTokens: q.maxTokens,
        signal: this.llmSignal(),
        messages: withInstruction(this.buildMessages(this.stateNote()), instruction),
      });
      const acc = this.account(gen.usage);
      span.end({
        model: this.deps.model,
        ...acc,
        structuredMode: gen.method,
        degraded: true,
        attrs: { [OTEL.operationName]: 'chat', 'urusin.mode': 'degraded_json_action' },
      });
      const a = gen.data;
      if (a.jenis === 'balas' || !a.nama) {
        const text = this.sanitizeOutput(a.teks ?? '');
        this.turnMessages.push({ role: 'assistant', content: text });
        if (text) this.emit({ type: 'assistant_text', delta: text });
        return;
      }
      let args: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(a.argsJson ?? '{}');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
          args = parsed as Record<string, unknown>;
      } catch {
        args = { __tidak_valid__: true };
      }
      if (a.confirmationId && args.confirmationId === undefined) args.confirmationId = a.confirmationId;
      const r = await this.handleToolCall(a.nama, JSON.stringify(args));
      this.turnMessages.push(
        { role: 'assistant', content: `[aksi] ${a.nama}` },
        { role: 'user', content: `HASIL_TOOL ${a.nama}: ${r.content}` },
      );
      this.lanjutkan = !r.end;
    } catch (e) {
      span.end({ status: 'error', errorCode: (e as Error).name, model: this.deps.model, degraded: true });
      throw e;
    }
  }
}
