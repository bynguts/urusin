import type { RagSearcher } from '@urusin/rag';
import { FAKTA_HUKUM } from '@urusin/registry';
import {
  LlmContentFilterError,
  LlmLengthError,
  LlmRefusalError,
  assertCompletionUsable,
  generateStructured,
  isLlmTerminalError,
  isRetryableError,
  type CapabilityFlags,
  type ChatCompletion,
  type ChatMessage,
  type ChatParams,
  type ChatProvider,
  type ReasoningEffort,
  type Usage,
} from '@urusin/llm';
import { z } from 'zod';
import type { EventBus } from './bus.js';
import type { Db } from './db.js';
import type { EventOf, EventPayload, UrusanState, UrusinEvent } from '@urusin/contracts';
import { HarnessError, TurnInProgressError } from './errors.js';
import { tierUrusan, urusanRute, varianUrusan } from './rencana.js';
import { statusPendamping } from './status-pendamping.js';
import { toEvent } from './envelope.js';
import { ADMINDUK, buildHandoff, unsupportedFacts, type CacheJawaban } from './grounding.js';
import {
  INGAT_TOOL,
  blokIngatan,
  ingatPreferensi,
  ingatWilayah,
  muatKonteks,
  type IngatanTurn,
  type PenyimpanIngatan,
} from './ingatan.js';
import {
  BALASAN_DI_LUAR_URUSAN,
  alasanBukanJalurCepat,
  klasifikasiKataKunci,
  mintaDiLuarUrusan,
} from './intent.js';
import type { KlasifikasiIntentEmbedding } from './intent-embedding.js';
import { PiiInterceptor } from './pii.js';
import { PolicyGate } from './policy.js';
import { buildStateNote, buildSystemPrompt, mintaPemalsuan } from './prompt.js';
import type { QuotaMeter, QuotaStatus } from './quota.js';
import { GAMBAR_MAKS, bacaGambar, peringatanFoto } from './gambar.js';
import { newNonce, spotlight } from './spotlight.js';
import type { HarnessStore, TurnStatus, UrusanRow } from './store.js';
import { clip, ringkasRiwayat, type ToolContext, type ToolRegistry } from './tools.js';
import { OTEL, type Tracer } from './trace.js';
import type { LayananCariWeb } from './web-cari.js';
import {
  BERKAS_TOOL,
  MIME_BERKAS,
  mintaBerkas,
  rapikanIsianTemplat,
  MAKS_TEKS_TEMPLAT,
  type LayananBerkas,
} from './berkas.js';
import {
  hanyaTanyaWilayah,
  kalimatKanal,
  kartuRencana,
  kodeDisebut,
  kodeUntukPii,
  refWilayah,
  rencanaUrusan,
  selaraskanUsulan,
  tetapkanWilayah,
  tujuanDariPesan,
  usulkanRencanaOtomatis,
  wilayahBelumSiap,
  wilayahDariPesan,
  wilayahUrusan,
} from './wilayah.js';

/** Penanda lampiran dari klien (lihat `penandaLampiran` di apps/web): "[warga melampirkan dokumen: KTP (gambar)]". */
const PENANDA_LAMPIRAN_RE = /^\[warga melampirkan dokumen: [^\]()\n]{1,40} \((gambar|PDF|DOCX)\)\]$/gm;

/** Templat lampiran giliran ini: teks hasil ekstraksi server dari brankas (BELUM diredaksi; agen meredaksinya). */
export type TemplatTurn = { mime: string; teks: string };
/** Templat maksimal per giliran. */
export const TEMPLAT_MAKS = 3;

const CATATAN_TAK_TERBACA =
  '[Catatan sistem: sebagian lampiran di pesan ini (PDF, atau gambar yang tidak terkirim) BELUM bisa dibaca. Jangan menebak isinya; katakan terus terang dan minta warga menuliskan isi pentingnya (tanpa NIK, nomor KK, atau nomor HP).]';

/** Tool rencana karangan model (urusan tanpa rencana Peristiwa Hidup: KTP rusak, bansos, pajak kendaraan, ...). */
const TOOL_RENCANA = 'urusan__usulkan_rencana';

const TOOL_JAWAB = 'urusan__jawab_persyaratan';
const TOOL_CARI_KORPUS = 'rag__cari_pengetahuan';

/** Penanda daftar Markdown di awal baris ("1. ", "- "): angka urutan bukan fakta. */
const PENANDA_DAFTAR_RE = /^(\s*(?:\d{1,2}[.)]|[-*•])\s+)/;

/**
 * Buang kalimat balasan model yang memuat angka/URL yang tidak ada di bukti (`unsupportedFacts`): klaim dan kutipan
 * jawaban bersumber yang sudah tampil, potongan sumber urusan, fakta hukum, dan pesan warga sendiri. Baris daftar
 * yang semua kalimatnya dibuang ikut hilang; struktur Markdown lain tetap.
 */
export function saringFakta(teks: string, bukti: readonly string[]): string {
  return teks
    .split('\n')
    .flatMap((baris) => {
      const penanda = PENANDA_DAFTAR_RE.exec(baris)?.[1] ?? '';
      const isi = baris.slice(penanda.length);
      if (!isi.trim()) return [baris];
      const kalimat = isi.split(/(?<=[.!?])\s+/);
      const lolos = kalimat.filter((k) => unsupportedFacts(k, bukti).length === 0);
      if (lolos.length === kalimat.length) return [baris];
      return lolos.length > 0 ? [`${penanda}${lolos.join(' ')}`] : [];
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export type AgentConfig = {
  /** Batas waktu satu turn (env URUSIN_TURN_TIMEOUT_MS). */
  turnTimeoutMs: number;
  /** Batas waktu satu panggilan LLM, + 1 retry (env URUSIN_LLM_CALL_TIMEOUT_MS). */
  llmTimeoutMs: number;
  /** Iterasi tool maksimum per turn (env URUSIN_AGENT_MAX_STEPS). */
  maxSteps: number;
};

/** Model bernalar effort tinggi: satu panggilan bisa 30-90 detik (probe proxy: ~50 detik untuk jawaban panjang). */
export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  turnTimeoutMs: 300_000,
  llmTimeoutMs: 180_000,
  maxSteps: 12,
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
  /** Cache keluaran generator jawaban bersumber (lihat `CacheJawaban`). */
  cacheJawaban?: CacheJawaban | undefined;
  /** Jalur cepat intent lewat sidecar embedding (fail-open); tanpa ini klasifikasi = kata kunci lalu LLM. */
  intentEmbedding?: KlasifikasiIntentEmbedding | undefined;
  /** Cari web cadangan (Exa); tool `web__cari` hanya terdaftar bila ada. */
  cariWeb?: LayananCariWeb | undefined;
  /** Model pembaca gambar lampiran chat (env LLM_VISION_MODEL); tanpa ini agen berterus terang belum bisa membaca. */
  visionModel?: string | undefined;
  /** `reasoning_effort` panggilan utama agen (LLM_AGENT_REASONING_EFFORT); menimpa global. */
  reasoningEffort?: ReasoningEffort | undefined;
  /** `reasoning_effort` jawaban bersumber + pembaca gambar (LLM_GROUNDING_REASONING_EFFORT). */
  reasoningEffortJawaban?: ReasoningEffort | undefined;
  /** Render + simpan berkas buatan agen; `berkas__buat` hanya ditawarkan bila ada DAN giliran punya pemilik brankas. */
  berkas?: LayananBerkas | undefined;
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
  args: {
    urusanId: string;
    userText: string;
    expectedVersion?: number;
    gambar?: readonly string[];
    /** Teks templat DOCX/PDF lampiran giliran ini (dibaca server dari brankas pemilik). */
    templat?: readonly TemplatTurn[];
    /** Pemilik brankas peminta: tujuan simpan dan sumber nilai `berkas__buat`. */
    pemilikBerkas?: string | undefined;
  },
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
        gambar: args.gambar?.slice(0, GAMBAR_MAKS) ?? [],
        templat: args.templat?.slice(0, TEMPLAT_MAKS) ?? [],
        pemilikBerkas: args.pemilikBerkas,
      })
        .run(signal)
        .finally(() => locks.delete(args.urusanId)),
  };
}

/** Jalankan satu turn dari awal sampai akhir. */
export function runTurn(
  deps: AgentDeps,
  args: {
    urusanId: string;
    userText: string;
    expectedVersion?: number;
    signal?: AbortSignal;
    gambar?: readonly string[];
    templat?: readonly TemplatTurn[];
    pemilikBerkas?: string | undefined;
  },
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

const ULANG_RINGKAS = 'Balasanmu terpotong; lanjutkan dengan tool yang tepat atau balasan yang lebih padat.';

/** Sisipkan instruksi sebelum pesan terakhir (pesan pengguna tetap terakhir). */
function withInstruction(messages: ChatMessage[], instruction: ChatMessage): ChatMessage[] {
  return [...messages.slice(0, -1), instruction, ...messages.slice(-1)];
}

/** Hasil tool di mode degraded disisipkan sebagai pesan user `HASIL_TOOL <nama>: …`. */
const HASIL_TOOL_RE = /^HASIL_TOOL ([a-z0-9]+__[a-z0-9_]+):/;

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
  /** Label butir yang dicatat otomatis di giliran ini (petunjuk agar model tidak mencatat ulang). */
  private readonly ingatanBaru: string[] = [];
  /**
   * Konten tak tepercaya sudah masuk konteks: hasil tool bertanda `takTepercaya` di turn ini, atau hasil tool
   * `kontenLuar` yang masih ada di riwayat urusan. Selama itu ingatan__ingat tidak ditawarkan dan ditolak: injeksi
   * tidak bisa menanam/menghapus ingatan lintas urusan.
   */
  private kontenTakTepercaya = false;
  /** Wilayah KTP ditetapkan dari pesan giliran ini sendiri (`wilayahDariPesan`), syarat `jalurCepat`. */
  private wilayahDariTeks = false;
  /** Peringatan foto lampiran yang belum jelas (sudah tampil ke warga), diteruskan ke jawaban bersumber. */
  private catatanFoto: string | undefined;
  /**
   * Bukti yang sudah tampil di giliran ini: klaim + kutipan jawaban bersumber dan potongan sumber urusan. Terisi
   * sejak jawaban bersumber pertama; sejak itu balasan teks model disaring ke bukti ini (`saringFakta`).
   */
  private readonly buktiTampil: string[] = [];

  constructor(
    private readonly deps: AgentDeps,
    private readonly turn: {
      urusanId: string;
      userText: string;
      turnId: string;
      version: number;
      pii: PiiInterceptor;
      /** Data URL gambar lampiran giliran ini (sudah diperkecil klien), dibaca sekali oleh model vision. */
      gambar: readonly string[];
      templat: readonly TemplatTurn[];
      pemilikBerkas: string | undefined;
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
    if (this.ingatan) this.kontenTakTepercaya = this.riwayatMemuatKontenLuar();
  }

  /**
   * Riwayat urusan (jendela yang sama dengan prompt) memuat hasil tool `kontenLuar`: pesan `tool` biasa, atau
   * pesan `HASIL_TOOL <nama>: …` dari mode degraded (tanpa tool calling).
   */
  private riwayatMemuatKontenLuar(): boolean {
    const nama = new Map<string, string>();
    const luar = (n: string | undefined) => this.deps.registry.get(n ?? '')?.kontenLuar === true;
    for (const m of this.store.loadHistory(this.turn.urusanId)) {
      if (m.role === 'assistant' && m.tool_calls)
        for (const c of m.tool_calls) if (c.type === 'function') nama.set(c.id, c.function.name);
      if (m.role === 'tool' && luar(nama.get(m.tool_call_id))) return true;
      if (m.role === 'user' && typeof m.content === 'string' && luar(HASIL_TOOL_RE.exec(m.content)?.[1]))
        return true;
    }
    return false;
  }

  /** Tool `ingatan__ingat` hanya ditawarkan bila urusan punya pemilik vault. */
  private toolDitawarkan(nama: string): boolean {
    if (nama === BERKAS_TOOL) return Boolean(this.deps.berkas && this.turn.pemilikBerkas);
    return nama !== INGAT_TOOL || (this.ingatan !== null && !this.kontenTakTepercaya);
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
    return tierUrusan(urusanRute(this.store, this.urusan));
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
      varian: varianUrusan(this.store, this.urusan),
      tools: this.deps.registry.forState(this.urusan.state).filter((t) => this.toolDitawarkan(t.name)),
      confirmations: this.store.activeConfirmations(this.turn.urusanId),
      pesanWarga: this.turn.pii.redact(this.turn.userText).text,
      ingatanAktif: this.ingatan !== null,
      ingatanBaru: this.ingatanBaru,
      pendamping: statusPendamping(this.store, this.turn.urusanId),
      perluRencana: this.perluRencana(),
      now: this.now(),
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
        ...(this.urusan.jenis ? { jenis: this.urusan.jenis } : {}),
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

  /**
   * Gambar lampiran giliran ini dibaca model vision sekali; deskripsinya (diredaksi placeholder PII, dibungkus
   * spotlight sebagai data tak tepercaya) disambung ke pesan warga sehingga ikut riwayat urusan. Gagal/tidak
   * dikonfigurasi: catatan sistem meminta agen berterus terang bahwa gambarnya belum terbaca. Foto yang buram,
   * terpotong, dst. langsung disampaikan ke warga (pesan tetap dari harness, sebelum jawaban model) dan agen serta
   * jawaban bersumber dilarang menyatakan dokumennya sah atau dapat dipakai.
   */
  private async bacaLampiranGambar(): Promise<void> {
    const n = this.turn.gambar.length;
    const penanda = [...this.turn.userText.matchAll(PENANDA_LAMPIRAN_RE)].map((m) => m[1]);
    // PDF/DOCX yang teksnya terbaca server (templat) tidak dihitung "belum bisa dibaca".
    const takTerbaca =
      Math.max(0, penanda.filter((b) => b === 'PDF' || b === 'DOCX').length - this.turn.templat.length) +
      Math.max(0, penanda.filter((b) => b === 'gambar').length - n);
    if (n === 0) {
      if (takTerbaca > 0) this.sambungKePesanWarga(CATATAN_TAK_TERBACA);
      return;
    }
    if (this.deps.visionModel) this.progress('Membaca gambar lampiran…');
    const hasil = await bacaGambar({
      provider: this.deps.provider,
      model: this.deps.visionModel,
      gambar: this.turn.gambar,
      pertanyaan: this.teksWarga,
      signal: this.llmSignal(),
      reasoningEffort: this.deps.reasoningEffortJawaban,
    });
    if (hasil.usage.length) this.account(hasil.usage);
    const peringatan = hasil.ok && hasil.foto ? peringatanFoto(hasil.foto) : null;
    let catatanKualitas = '';
    if (peringatan) {
      this.catatanFoto = this.turn.pii.redact(peringatan).text;
      this.emit({ type: 'assistant_text', delta: this.catatanFoto, utuh: true });
      // Isi peringatan (turunan keluaran vision) hanya ada di dalam blok data; catatan ini teks tetap dari kode.
      catatanKualitas = `\n[Catatan sistem: foto lampiran belum jelas (lihat "Kondisi foto" pada data di atas) dan peringatan untuk memfoto ulang SUDAH ditampilkan kepada warga; jangan mengulanginya kata per kata. JANGAN menyatakan dokumen atau foto warga sah, lengkap, jelas, atau dapat dipakai sebelum warga mengirim foto yang jelas; boleh menjelaskan persyaratan umumnya.]`;
    }
    const blok = hasil.ok
      ? `[Isi ${n > 1 ? `${n} gambar` : 'gambar'} lampiran warga di pesan ini, dibaca otomatis oleh sistem pembaca gambar. Jawab berdasarkan isi ini; jangan katakan Anda tidak bisa melihat gambar. Nomor identitas yang terlihat sengaja tidak disalin; jangan meminta atau menuliskannya.]\n${spotlight(
          'user_file',
          this.turn.pii.redact(hasil.teks).text,
          { nonce: this.nonce, id: 'lampiran', maxChars: 1500 },
        )}${catatanKualitas}`
      : `[Catatan sistem: warga melampirkan ${n > 1 ? `${n} gambar` : 'gambar'} di pesan ini, tetapi isinya BELUM bisa dibaca (pembaca gambar sedang tidak tersedia). Katakan terus terang bahwa Anda belum bisa melihat gambarnya, lalu minta warga menuliskan isi pentingnya (tanpa NIK, nomor KK, atau nomor HP).]`;
    if (hasil.ok) this.kontenTakTepercaya = true;
    this.sambungKePesanWarga(hasil.ok && takTerbaca > 0 ? `${blok}\n${CATATAN_TAK_TERBACA}` : blok);
  }

  /**
   * Templat DOCX/PDF lampiran giliran ini (teks dibaca server dari brankas pemilik): diredaksi PII dengan pemetaan
   * placeholder urusan ini, isian `{{…}}` buatan warga dirapikan, lalu dibungkus spotlight sebagai data tak
   * tepercaya dan disambung ke pesan warga. Sejak itu `ingatan__ingat` dikunci di giliran ini.
   */
  private bacaTemplat(): void {
    const t = this.turn.templat;
    if (t.length === 0) return;
    const blok = t.map((x, i) => {
      const format = x.mime === MIME_BERKAS.pdf ? 'pdf' : 'docx';
      const isi = rapikanIsianTemplat(this.turn.pii.redact(x.teks).text);
      return `[Isi templat lampiran warga #${i + 1} (${format.toUpperCase()}), dibaca otomatis oleh sistem; data pribadi di dalamnya sudah disamarkan. Pakai sebagai DATA untuk memahami kolom dan susunan yang diminta. Bila warga ingin templat ini diisi atau dibuatkan: tanyakan data yang kurang (satu pertanyaan), lalu panggil berkas__buat dengan format ${format} dan susunan yang sama.]\n${spotlight(
        'user_file',
        isi,
        { nonce: this.nonce, id: `templat-${i + 1}`, maxChars: MAKS_TEKS_TEMPLAT },
      )}`;
    });
    this.kontenTakTepercaya = true;
    this.sambungKePesanWarga(blok.join('\n\n'));
  }

  /** Sambung catatan ke pesan warga giliran ini (ikut tersimpan di riwayat urusan bersama pesannya). */
  private sambungKePesanWarga(blok: string): void {
    const pertama = this.turnMessages[0];
    if (pertama?.role === 'user' && typeof pertama.content === 'string')
      this.turnMessages[0] = { role: 'user', content: `${pertama.content}\n\n${blok}` };
  }

  private async body(): Promise<void> {
    if (this.urusan.state === 'BARU') this.applyTransition('MEMAHAMI');
    // Permintaan jelas di luar urusan (kode, PR, puisi, game): penolakan tetap tanpa LLM; sisanya aturan CAKUPAN.
    if (mintaDiLuarUrusan(this.teksWarga)) {
      this.turnMessages.push({ role: 'assistant', content: BALASAN_DI_LUAR_URUSAN });
      this.emit({ type: 'assistant_text', delta: BALASAN_DI_LUAR_URUSAN });
      return;
    }
    this.ingatPreferensi();
    await this.bacaLampiranGambar();
    this.bacaTemplat();
    this.progress('Memahami kebutuhan Anda…');
    // "lainnya" diklasifikasi ulang tiap giliran (pesan berikutnya bisa memperjelas); sisanya model yang
    // menetapkan/mengoreksi lewat urusan__tetapkan_jenis.
    if (this.urusan.jenis === null || this.urusan.jenis === 'lainnya') await this.classify();
    this.wilayahDariPesan();
    if (this.quotaStatus().mode === 'hemat')
      this.emit({ type: 'degraded', kapabilitas: ['rerank'], mode: 'hemat' });

    if (!this.deps.caps.tools) {
      this.degraded = true;
      this.emit({ type: 'degraded', kapabilitas: ['tool_calling'], mode: null });
      await this.degradedAction();
      return;
    }
    // Ada gambar: model yang menanggapi isinya lebih dulu (jalur tanpa model hanya membaca tulisan warga).
    // Wilayah yang belum pasti tidak menghentikan giliran: agen yang memutuskan apakah wilayah perlu ditanyakan.
    // Templat atau permintaan membuat berkas: model yang menyusun (berkas__buat), bukan jalur cepat persyaratan.
    if (
      this.turn.gambar.length === 0 &&
      this.turn.templat.length === 0 &&
      !mintaBerkas(this.teksWarga) &&
      (await this.jalurCepat())
    )
      return;
    await this.toolLoop();
  }

  /**
   * Giliran pertama yang jenis dan wilayah KTP-nya ditetapkan dari pesan warga itu sendiri (kata kunci/klasifikasi +
   * `wilayahDariPesan`), tanpa riwayat: langkah model pertama di sini selalu
   * rag__cari_pengetahuan, jadi harness langsung (1) mengusulkan kartu rencana deterministik bila jenisnya punya
   * (tampil dalam hitungan milidetik, sebelum LLM) dan (2) mencari korpus dengan teks warga lewat gerbang tool yang
   * sama. Hemat satu round-trip LLM. Sesudahnya MODEL yang memutuskan (menjawab bersumber, bertanya, web__cari, ...)
   * dengan potongan itu di konteks. Hanya kependudukan (layanan lain bisa butuh tool baca lain, mis.
   * samsat__cek_pkb), dan pesan yang perlu ditanggapi model dulu (pemalsuan, data pribadi, cek status) tetap lewat
   * loop agen dari awal.
   */
  private async jalurCepat(): Promise<boolean> {
    const u = this.urusan;
    if (!this.wilayahDariTeks || u.state !== 'MEMAHAMI' || !u.jenis || !ADMINDUK.has(u.jenis)) return false;
    const w = wilayahUrusan(this.store, u);
    if (wilayahBelumSiap(u.jenis, w)) return false;
    const teks = this.teksWarga;
    // Saringan positif: hanya permintaan syarat/cara mengurus SATU urusan, tanpa penanda risiko (dituakan, orang
    // dalam, calo, ...), tanpa tindak lanjut pengajuan lama, tanpa negasi. Selebihnya model menanggapi lebih dulu.
    if (
      mintaPemalsuan(teks) ||
      /\{\{[A-Z]+\d*\.[A-Z_]+\}\}/.test(teks) ||
      alasanBukanJalurCepat(teks, u.jenis) !== null
    )
      return false;
    if (this.store.loadHistory(this.turn.urusanId, 1).length > 0) return false;
    const ada = new Set(this.deps.registry.forState(u.state).map((t) => t.name));
    if (!ada.has(TOOL_CARI_KORPUS) || !ada.has(TOOL_JAWAB) || this.quotaStatus().mode === 'habis')
      return false;

    // Kueri = judul rencana + teks warga: kueri model biasanya kalimat warga yang diringkas ("syarat ganti KTP-el
    // rusak"); judul menjaga cakupan leksikal (gerbang abstain RAG) untuk pesan yang panjang/santai.
    const judul = w.ktp
      ? rencanaUrusan(u.jenis, {
          ktp: w.ktp.kodeKabKota,
          domisili: w.domisili?.kodeKabKota ?? null,
          tujuan: w.tujuan?.kodeKabKota ?? null,
        })?.judul
      : undefined;
    // Kartu rencana deterministik (bila jenisnya punya) tampil SEKARANG, sebelum panggilan LLM mana pun.
    this.proposeRencana();
    const args = JSON.stringify({
      query: `${judul ? `persyaratan ${judul.toLowerCase()}. ` : ''}${teks}`.slice(0, 500),
      layanan: 'adminduk',
    });
    const id = 'call_cari_cepat';
    const r = await this.handleToolCall(TOOL_CARI_KORPUS, args);
    this.turnMessages.push(
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id, type: 'function' as const, function: { name: TOOL_CARI_KORPUS, arguments: args } },
        ],
      },
      { role: 'tool', tool_call_id: id, content: r.content },
    );
    await this.toolLoop();
    return true;
  }

  private get teksWarga(): string {
    return this.turn.pii.redact(this.turn.userText).text;
  }

  /**
   * Wilayah dulu tanpa round-trip LLM: KTP/KK yang disebut warga sendiri ("KTP saya Kota Makassar") langsung
   * ditetapkan (sama dengan wilayah__tetapkan atas sebutan warga); satu kab/kota tanpa kata KTP ("warga Kota
   * Medan") langsung tampil sebagai kartu usulan. Kematian dikecualikan: yang berwenang domisili almarhum.
   */
  private wilayahDariPesan(): void {
    const u = this.urusan;
    if (u.state !== 'MEMAHAMI' || !u.jenis || u.jenis === 'kematian') return;
    const w = wilayahUrusan(this.store, u);
    if (w.ktp) return;
    const hasil = wilayahDariPesan(this.teksWarga);
    if (!hasil) return;
    if (hasil.ktp) {
      // Pindah: tujuan "ke <kab/kota>" yang disebut warga sendiri ikut ditetapkan (sama dengan wilayah__tetapkan
      // atas sebutan warga), agar rencana tidak menunggu round-trip model hanya untuk mencatat tujuan.
      const ke = u.jenis === 'pindah' ? tujuanDariPesan(this.teksWarga) : null;
      const input = { ktp: hasil.kode, ...(ke && ke !== hasil.kode ? { tujuan: ke } : {}) };
      this.urusan = tetapkanWilayah(
        this.store,
        { ...u, version: this.version },
        input,
        (e) => void this.emit(e),
      );
      this.version = this.urusan.version;
      this.wilayahDariTeks = true;
      this.ingatWilayah(input);
      return;
    }
    const ktp = refWilayah(hasil.kode);
    if (ktp && w.usulan?.ktp.kodeKabKota !== hasil.kode)
      this.emit({ type: 'wilayah', status: 'usulan', ktp, sumber: 'warga' });
  }

  private async classify(): Promise<void> {
    const q = this.quotaStatus();
    if (q.mode === 'habis') return this.quotaStop(q);
    // Kata kunci lalu sidecar embedding (tanpa round-trip LLM). Tidak dikenali: jenis dibiarkan apa adanya dan
    // model yang menetapkannya lewat urusan__tetapkan_jenis.
    const teks = this.teksWarga;
    const jenis =
      klasifikasiKataKunci(teks) ??
      (await this.deps.intentEmbedding?.klasifikasi(teks, this.ctrl.signal).catch(() => null));
    if (!jenis || jenis === this.urusan.jenis) return;
    this.urusan = this.store.setJenis(this.turn.urusanId, this.version, jenis);
    this.version = this.urusan.version;
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

  /**
   * Rencana belum diusulkan (MEMAHAMI), wilayah sudah siap, dan urusan ini tidak punya rencana Peristiwa Hidup
   * deterministik (`proposeRencana` menanganinya di akhir turn): catatan state mengingatkan model untuk
   * mengusulkan rencana bila warga memang mau mengurus. Tidak pernah dipaksa (pertanyaan info saja tanpa rencana).
   */
  private perluRencana(): boolean {
    const u = this.urusan;
    if (u.state !== 'MEMAHAMI' || !u.jenis) return false;
    if (!this.deps.registry.forState(u.state).some((t) => t.name === TOOL_RENCANA)) return false;
    const w = wilayahUrusan(this.store, u);
    return !wilayahBelumSiap(u.jenis, w) && kartuRencana(u.jenis, w) === undefined;
  }

  /** Loop agen: model memilih tool atau membalas; setiap panggilan lewat gerbang. */
  private async toolLoop(): Promise<void> {
    for (let step = 0; step < this.cfg.maxSteps; step++) {
      const q = this.quotaStatus();
      if (q.mode === 'habis') return this.quotaStop(q);
      // Tool selesai, model berpikir lagi: indikator aktivitas di klien kembali ke "Berpikir…" (tanpa toolName).
      if (step > 0) this.progress('Berpikir…');
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
          ...(this.deps.reasoningEffort ? { reasoning_effort: this.deps.reasoningEffort } : {}),
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
        const text = this.saringBalasan(this.sanitizeOutput(msg?.content ?? ''));
        this.turnMessages.push({ role: 'assistant', content: text });
        if (text && this.digantiKartu(text)) this.terbitkanKartuWilayah(text);
        else if (text) this.emit({ type: 'assistant_text', delta: text });
        return;
      }

      const g = await this.jalankanPanggilan(msg.content ?? null, calls);
      if (g.ended) return;
    }
    this.emit({
      type: 'error',
      kode: 'LLM_FAILED',
      pesanWarga: 'Terlalu banyak langkah tanpa hasil. Coba pertanyaan yang lebih spesifik.',
      bisaUlang: true,
    });
  }

  /** Jalankan satu grup tool_calls model lewat gerbang (berurutan) dan catat grupnya di pesan turn. */
  private async jalankanPanggilan(
    content: string | null,
    calls: readonly { id: string; function: { name: string; arguments: string } }[],
  ): Promise<{ ended: boolean }> {
    const group: ChatMessage[] = [
      {
        role: 'assistant',
        content,
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
    return { ended };
  }

  /**
   * Sesudah jawaban bersumber tampil di giliran ini, balasan teks model hanya boleh memuat angka/URL yang ada di
   * bukti: klaim/kutipan yang tampil, potongan sumber urusan (korpus/web), fakta hukum terkini, dan pesan warga.
   * Sebelum itu balasan tidak disaring (perilaku lama: model tidak menjawab persyaratan tanpa sumber).
   */
  private saringBalasan(text: string): string {
    if (!text || this.buktiTampil.length === 0) return text;
    const bukti = [
      ...this.buktiTampil,
      ...this.store.getChunks(this.turn.urusanId).map((c) => `${c.text} ${c.url}`),
      ...FAKTA_HUKUM.map((f) => `${f.teks} ${f.pasal}`),
      this.teksWarga,
    ];
    // Kanal resmi wilayah (registry terverifikasi) yang juga disebut catatan state.
    const ktp = wilayahUrusan(this.store, this.urusan).ktp;
    if (ktp) bukti.push(kalimatKanal(ktp.kodeKabKota));
    return saringFakta(text, bukti);
  }

  /**
   * Balasan yang hanya menanyakan wilayah yang juga tampil sebagai kartu (usulan aktif, atau usulan yang akan
   * diterbitkan selaraskanUsulan dari balasan ini): tidak ditampilkan agar pertanyaan tidak muncul dua kali.
   * Tetap tersimpan di riwayat model.
   */
  private digantiKartu(text: string): boolean {
    const w = wilayahUrusan(this.store, this.urusan);
    if (w.ktp || !hanyaTanyaWilayah(text)) return false;
    const disebut = kodeDisebut(text);
    if (disebut.length !== 1) return false;
    return w.usulan?.ktp.kodeKabKota === disebut[0] || /\b(betul|benar)\s*\?/i.test(text);
  }

  /**
   * Pertanyaan wilayah agen diganti kartu: kartu terbit SAAT INI (sumber `warga`) agar muncul di titik obrolan
   * tempat agen bertanya. Usulan awal (Data Diri/pilihan/Ingatan) tidak ditampilkan sebagai pembuka obrolan
   * (lihat kartuWilayahSaatPerlu di web). Kab/kota yang berbeda dari usulan diterbitkan selaraskanUsulan.
   */
  private terbitkanKartuWilayah(text: string): void {
    const w = wilayahUrusan(this.store, this.urusan);
    const disebut = kodeDisebut(text);
    if (w.usulan && w.usulan.sumber !== 'warga' && w.usulan.ktp.kodeKabKota === disebut[0])
      this.emit({ type: 'wilayah', status: 'usulan', ktp: w.usulan.ktp, sumber: 'warga' });
  }

  private sanitizeOutput(text: string): string {
    // eslint-disable-next-line no-control-regex -- membuang karakter kontrol dari teks model
    const clean = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
    // Jaring pengaman ukuran saja (±16 rb token keluaran); panjang jawaban diatur prompt, bukan potongan.
    return this.turn.pii.redact(clean.slice(0, 64_000)).text.trim();
  }

  /** Satu-satunya jalur eksekusi tool (normal maupun degraded): selalu lewat policy gate. */
  private async handleToolCall(
    rawName: string,
    argsJson: string,
  ): Promise<{ content: string; end: boolean; answer?: boolean; handoff?: boolean }> {
    // Nama tool datang dari model: jangan pernah dicatat/dipantulkan mentah (bisa memuat PII atau berukuran besar).
    const name = safeToolName(rawName);
    if (name === INGAT_TOOL && this.kontenTakTepercaya) {
      const pesan = 'ingatan tidak bisa diubah sesudah membaca konten luar di giliran ini';
      this.emit({
        type: 'policy_gate',
        tool: name,
        keputusan: 'deny',
        aturan: 'UNTRUSTED_CONTENT_READ',
        pesan,
      });
      return {
        content: JSON.stringify({ is_error: true, aturan: 'UNTRUSTED_CONTENT_READ', pesan }),
        end: false,
      };
    }
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
        cacheJawaban: this.deps.cacheJawaban,
        cariWeb: this.deps.cariWeb,
        reasoningEffortJawaban: this.deps.reasoningEffortJawaban,
        berkas: this.deps.berkas,
        now: this.now,
      },
      nonce: this.nonce,
      pesanWarga: this.turn.userText,
      signal: this.llmSignal(),
      ingatan: this.ingatan ?? undefined,
      catatanFoto: this.catatanFoto,
      pemilikBerkas: this.turn.pemilikBerkas,
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
      for (const e of res.events ?? []) {
        this.emit(e);
        // Bukti yang sudah tampil: dasar saringan angka/URL balasan model sesudahnya (`saringBalasan`).
        if (e.type === 'grounded_answer')
          for (const k of e.klaim)
            this.buktiTampil.push(k.teks, ...k.kutipan.map((q) => `${q.kutipanPersis} ${q.url}`));
      }
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
      if (res.jenis) {
        try {
          this.urusan = this.store.setJenis(this.turn.urusanId, this.version, res.jenis);
          this.version = this.urusan.version;
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
      if (res.takTepercaya || tool.kontenLuar) this.kontenTakTepercaya = true;
      return {
        content: res.terbungkus ? res.content : clip(res.content),
        end: res.endTurn === true,
        answer: tool.effect === 'answer',
        handoff: res.handoff === true || (res.events ?? []).some((e) => e.type === 'handoff'),
      };
    } catch (e) {
      // Tindakan tidak sampai ke warga: konfirmasi tidak boleh hangus.
      if (outcome.confirmationId) this.store.releaseConfirmation(outcome.confirmationId);
      span.end({ status: 'error', errorCode: (e as Error).name, attrs: { [OTEL.toolName]: name } });
      if (this.ctrl.signal.aborted || isLlmTerminalError(e)) throw e;
      if (e instanceof HarnessError) throw e;
      return { content: JSON.stringify({ is_error: true, pesan: 'tool gagal dijalankan' }), end: false };
    }
  }

  /**
   * Preferensi yang warga nyatakan di pesan ini (lansia, bahasa sederhana, aksesibilitas, kanal) dicatat dengan
   * aturan tetap, bukan tebakan model; teks yang dipakai sudah diredaksi. Gagal simpan tidak menggagalkan turn.
   */
  private ingatPreferensi(): void {
    if (!this.ingatan) return;
    try {
      const teks = this.turn.pii.redact(this.turn.userText).text;
      for (const e of ingatPreferensi(this.ingatan, teks, this.now().toISOString())) {
        this.emit(e);
        if (e.type === 'ingatan')
          this.ingatanBaru.push(
            e.aksi === 'usulan' ? `${e.butir.label} (menunggu persetujuan warga di kartu)` : e.butir.label,
          );
      }
    } catch {
      // vault tidak tersedia: turn tetap berjalan tanpa ingatan baru.
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
