import OpenAI, { toFile } from 'openai';
import type { LlmConfig } from './config.js';
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatParams,
  ChatProvider,
  ChatStreamParams,
  RequestOptions,
} from './types.js';

/** Membuat klien SDK resmi `openai` dari konfigurasi env (baseURL, apiKey, timeout, maxRetries). */
export function createOpenAIClient(
  config: Pick<LlmConfig, 'baseURL' | 'apiKey' | 'timeoutMs' | 'maxRetries'>,
) {
  return new OpenAI({
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    timeout: config.timeoutMs,
    maxRetries: config.maxRetries,
  });
}

/** Provider nyata: Chat Completions via SDK `openai` ke endpoint OpenAI-compatible mana pun. */
export class OpenAIProvider implements ChatProvider {
  readonly baseURL: string;
  private readonly client: OpenAI;
  private readonly transcribeClient: OpenAI;

  constructor(config: LlmConfig) {
    this.baseURL = config.baseURL;
    this.client = createOpenAIClient(config);
    this.transcribeClient = config.transcribeBaseURL
      ? createOpenAIClient({ ...config, baseURL: config.transcribeBaseURL })
      : this.client;
  }

  create(params: ChatParams, opts: RequestOptions = {}): Promise<ChatCompletion> {
    return this.client.chat.completions.create(params, { signal: opts.signal });
  }

  async stream(
    params: ChatStreamParams,
    opts: RequestOptions = {},
  ): Promise<AsyncIterable<ChatCompletionChunk>> {
    return this.client.chat.completions.create(params, { signal: opts.signal });
  }

  async transcribe(input: { model: string; audio: Uint8Array; filename: string; language?: string }) {
    const file = await toFile(input.audio, input.filename);
    const res = await this.transcribeClient.audio.transcriptions.create({
      model: input.model,
      file,
      ...(input.language ? { language: input.language } : {}),
    });
    return { text: res.text };
  }

  async embed(input: { model: string; texts: string[] }): Promise<number[][]> {
    const res = await this.client.embeddings.create({ model: input.model, input: input.texts });
    return res.data.map((d) => d.embedding);
  }
}

/** Error 400 karena parameter tidak didukung provider: turunkan kapabilitas lalu ulang tanpa parameter itu. */
export function isUnsupportedParamError(err: unknown): boolean {
  if (!(err instanceof OpenAI.APIError) || err.status !== 400) return false;
  return /unsupported|not supported|unknown parameter|unrecognized|invalid.*(response_format|tool|parallel)/i.test(
    err.message,
  );
}

/** 429 dan 5xx layak di-retry (SDK sudah me-retry dengan backoff + retry-after sebanyak maxRetries). */
export function isRetryableError(err: unknown): boolean {
  return (
    err instanceof OpenAI.APIError && err.status !== undefined && (err.status === 429 || err.status >= 500)
  );
}
