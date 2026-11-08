import type { ChatCompletion } from './types.js';

/** Model menolak menjawab (`message.refusal`). Tidak boleh memicu turun tangga: penolakan bukan kegagalan kapabilitas. */
export class LlmRefusalError extends Error {
  constructor(readonly refusal: string) {
    super(`model menolak menjawab: ${refusal}`);
    this.name = 'LlmRefusalError';
  }
}

/** Jawaban terpotong (`finish_reason: length`): JSON/teks tidak utuh, jadi tidak boleh di-parse atau diperbaiki diam-diam. */
export class LlmLengthError extends Error {
  constructor(readonly maxTokens?: number) {
    super('keluaran model terpotong karena batas token (finish_reason=length)');
    this.name = 'LlmLengthError';
  }
}

/** Disaring filter konten provider (`finish_reason: content_filter`). */
export class LlmContentFilterError extends Error {
  constructor() {
    super('keluaran model disaring filter konten provider (finish_reason=content_filter)');
    this.name = 'LlmContentFilterError';
  }
}

export type LlmTerminalError = LlmRefusalError | LlmLengthError | LlmContentFilterError;

export function isLlmTerminalError(err: unknown): err is LlmTerminalError {
  return (
    err instanceof LlmRefusalError || err instanceof LlmLengthError || err instanceof LlmContentFilterError
  );
}

/**
 * Periksa satu respons: lempar error bertipe untuk refusal / length / content_filter.
 * Dipanggil sebelum konten apa pun dibaca, sehingga tidak ada penurunan tangga diam-diam.
 */
export function assertCompletionUsable(completion: ChatCompletion, maxTokens?: number): void {
  const choice = completion.choices[0];
  if (!choice) return;
  const refusal = choice.message.refusal;
  if (typeof refusal === 'string' && refusal.length > 0) throw new LlmRefusalError(refusal);
  if (choice.finish_reason === 'content_filter') throw new LlmContentFilterError();
  if (choice.finish_reason === 'length') throw new LlmLengthError(maxTokens);
}
