import OpenAI from 'openai';
import type { Capability } from './capabilities.js';
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatParams,
  ChatProvider,
  ChatStreamParams,
  RequestOptions,
  Usage,
} from './types.js';

export type FakeReply = ChatCompletion | Error | ((params: ChatParams) => ChatCompletion | Error);

export type FakeStreamReply = ChatCompletionChunk[] | Error;

export type FakeProviderOptions = {
  baseURL?: string;
  /** Antrean respons untuk create(), dipakai berurutan. */
  replies?: FakeReply[];
  /** Antrean rekaman chunk untuk stream(). */
  streams?: FakeStreamReply[];
  /** Tiru provider "tanpa X": request yang memakai X ditolak 400 seperti provider asli. */
  without?: Capability[];
  transcript?: string;
  embedding?: number[];
};

export type FakeCall =
  | { kind: 'create'; params: ChatParams }
  | { kind: 'stream'; params: ChatStreamParams }
  | { kind: 'transcribe'; model: string }
  | { kind: 'embed'; model: string; texts: string[] };

export function unsupportedParam(param: string): Error {
  return OpenAI.APIError.generate(
    400,
    { error: { message: `Unsupported parameter: '${param}'`, type: 'invalid_request_error', param } },
    `Unsupported parameter: '${param}'`,
    new Headers(),
  );
}

function hasImage(params: ChatParams | ChatStreamParams): boolean {
  return params.messages.some(
    (m) => Array.isArray(m.content) && m.content.some((p) => (p as { type?: string }).type === 'image_url'),
  );
}

/** Kembalikan error 400 bila request memakai kapabilitas yang sedang "dimatikan". */
function rejectionFor(params: ChatParams | ChatStreamParams, without: Set<Capability>, streaming: boolean) {
  if (without.has('tools') && params.tools?.length) return unsupportedParam('tools');
  if (without.has('parallel_tool_calls') && params.parallel_tool_calls !== undefined) {
    return unsupportedParam('parallel_tool_calls');
  }
  if (without.has('json_schema_strict') && params.response_format?.type === 'json_schema') {
    return unsupportedParam('response_format');
  }
  if (without.has('vision') && hasImage(params)) return unsupportedParam('image_url');
  if (streaming && without.has('streaming_tools') && params.tools?.length) return unsupportedParam('stream');
  return null;
}

/** Provider berskrip untuk tes: tanpa jaringan, perilaku deterministik, merekam setiap panggilan. */
export class FakeProvider implements ChatProvider {
  readonly baseURL: string;
  readonly calls: FakeCall[] = [];
  private readonly replies: FakeReply[];
  private readonly streams: FakeStreamReply[];
  private readonly without: Set<Capability>;
  private readonly transcript: string;
  private readonly embedding: number[];

  constructor(opts: FakeProviderOptions = {}) {
    this.baseURL = opts.baseURL ?? 'https://fake.llm.invalid/v1';
    this.replies = [...(opts.replies ?? [])];
    this.streams = [...(opts.streams ?? [])];
    this.without = new Set(opts.without ?? []);
    this.transcript = opts.transcript ?? '';
    this.embedding = opts.embedding ?? [0.1, 0.2, 0.3];
  }

  enqueue(...replies: FakeReply[]): this {
    this.replies.push(...replies);
    return this;
  }

  enqueueStream(...streams: FakeStreamReply[]): this {
    this.streams.push(...streams);
    return this;
  }

  get pending(): number {
    return this.replies.length;
  }

  async create(params: ChatParams, opts: RequestOptions = {}): Promise<ChatCompletion> {
    this.calls.push({ kind: 'create', params });
    if (opts.signal?.aborted) throw new OpenAI.APIUserAbortError();
    const rejected = rejectionFor(params, this.without, false);
    if (rejected) throw rejected;
    const next = this.replies.shift();
    if (next === undefined) throw new Error('FakeProvider: antrean respons habis');
    const value = typeof next === 'function' ? next(params) : next;
    if (value instanceof Error) throw value;
    return value;
  }

  async stream(
    params: ChatStreamParams,
    opts: RequestOptions = {},
  ): Promise<AsyncIterable<ChatCompletionChunk>> {
    this.calls.push({ kind: 'stream', params });
    if (opts.signal?.aborted) throw new OpenAI.APIUserAbortError();
    const rejected = rejectionFor(params, this.without, true);
    if (rejected) throw rejected;
    const next = this.streams.shift();
    if (next === undefined) throw new Error('FakeProvider: antrean stream habis');
    if (next instanceof Error) throw next;
    return (async function* () {
      for (const c of next) yield c;
    })();
  }

  async transcribe(input: { model: string; audio: Uint8Array; filename: string; language?: string }) {
    this.calls.push({ kind: 'transcribe', model: input.model });
    if (this.without.has('transcriptions'))
      throw OpenAI.APIError.generate(404, undefined, 'Not Found', new Headers());
    return { text: this.transcript };
  }

  async embed(input: { model: string; texts: string[] }) {
    this.calls.push({ kind: 'embed', model: input.model, texts: input.texts });
    if (this.without.has('embeddings'))
      throw OpenAI.APIError.generate(404, undefined, 'Not Found', new Headers());
    return input.texts.map(() => [...this.embedding]);
  }
}

// ---------------------------------------------------------------------------
// Pembuat respons palsu
// ---------------------------------------------------------------------------

let seq = 0;
const usageOf = (u?: Partial<Usage>): Usage => ({
  prompt_tokens: u?.prompt_tokens ?? 10,
  completion_tokens: u?.completion_tokens ?? 5,
  total_tokens: (u?.prompt_tokens ?? 10) + (u?.completion_tokens ?? 5),
});

export function fakeCompletion(opts: {
  content?: string | null;
  refusal?: string | null;
  toolCalls?: { name: string; arguments: string; id?: string }[];
  finishReason?: OpenAI.Chat.Completions.ChatCompletion.Choice['finish_reason'];
  usage?: Partial<Usage>;
  model?: string;
}): ChatCompletion {
  const toolCalls = opts.toolCalls?.map((t, i) => ({
    id: t.id ?? `call_${i}`,
    type: 'function' as const,
    function: { name: t.name, arguments: t.arguments },
  }));
  return {
    id: `fake-${++seq}`,
    object: 'chat.completion',
    created: 0,
    model: opts.model ?? 'fake-model',
    choices: [
      {
        index: 0,
        logprobs: null,
        finish_reason: opts.finishReason ?? (toolCalls?.length ? 'tool_calls' : 'stop'),
        message: {
          role: 'assistant',
          content: opts.content ?? null,
          refusal: opts.refusal ?? null,
          ...(toolCalls?.length ? { tool_calls: toolCalls } : {}),
        },
      },
    ],
    usage: usageOf(opts.usage),
  };
}

export function fakeChunk(
  delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta,
  finishReason: OpenAI.Chat.Completions.ChatCompletionChunk.Choice['finish_reason'] = null,
  usage?: Usage,
): ChatCompletionChunk {
  return {
    id: 'fake-chunk',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'fake-model',
    choices: [{ index: 0, delta, finish_reason: finishReason, logprobs: null }],
    ...(usage ? { usage } : {}),
  };
}
