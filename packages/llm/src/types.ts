import type OpenAI from 'openai';

export type ChatCompletion = OpenAI.Chat.Completions.ChatCompletion;
export type ChatCompletionChunk = OpenAI.Chat.Completions.ChatCompletionChunk;
export type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
export type ChatTool = OpenAI.Chat.Completions.ChatCompletionTool;
export type ChatParams = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;
export type ChatStreamParams = OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming;
export type Usage = OpenAI.CompletionUsage;

export type RequestOptions = { signal?: AbortSignal | undefined };

/**
 * Antarmuka minimal yang dipakai gateway. Implementasi: OpenAIProvider (SDK resmi `openai`)
 * dan FakeProvider (tes). Hanya Chat Completions; tidak ada Responses API atau SDK vendor lain.
 */
export interface ChatProvider {
  readonly baseURL: string;
  create(params: ChatParams, opts?: RequestOptions): Promise<ChatCompletion>;
  stream(params: ChatStreamParams, opts?: RequestOptions): Promise<AsyncIterable<ChatCompletionChunk>>;
  transcribe(input: { model: string; audio: Uint8Array; filename: string; language?: string }): Promise<{
    text: string;
  }>;
  embed(input: { model: string; texts: string[] }): Promise<number[][]>;
}
