import type OpenAI from 'openai';
import type { ChatCompletion, ChatCompletionChunk, Usage } from './types.js';

export type AccumulatedToolCall = { id: string; name: string; arguments: string };

export type AccumulatedResult = {
  content: string;
  toolCalls: AccumulatedToolCall[];
  finishReason: string | null;
  usage: Usage | null;
};

type Slot = { id: string; name: string; arguments: string };

/**
 * Menggabungkan potongan stream Chat Completions menjadi tool call utuh.
 * Tahan terhadap variasi provider OpenAI-compatible:
 *  - argumen utuh dalam satu chunk atau terpecah ke banyak chunk;
 *  - `id` diulang di setiap chunk (tidak boleh menggandakan tool call);
 *  - `index` hilang (dicocokkan lewat `id`, atau dilanjutkan ke slot terakhir);
 *  - tool call baru muncul di chunk terakhir;
 *  - `finish_reason` "stop" walaupun ada tool call (dinormalisasi ke "tool_calls").
 */
export class ToolCallAccumulator {
  private content = '';
  private readonly slots: Slot[] = [];
  private readonly byIndex = new Map<number, Slot>();
  private readonly byId = new Map<string, Slot>();
  private finishReason: string | null = null;
  private usage: Usage | null = null;

  push(chunk: ChatCompletionChunk): void {
    if (chunk.usage) this.usage = chunk.usage;
    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta ?? {};
      if (typeof delta.content === 'string') this.content += delta.content;
      for (const tc of delta.tool_calls ?? []) this.pushToolDelta(tc);
      if (choice.finish_reason) this.finishReason = choice.finish_reason;
    }
  }

  private pushToolDelta(tc: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta.ToolCall): void {
    const index = typeof tc.index === 'number' ? tc.index : undefined;
    const id = tc.id || undefined;
    let slot: Slot | undefined;

    if (id !== undefined && this.byId.has(id)) slot = this.byId.get(id);
    else if (index !== undefined && this.byIndex.has(index)) {
      slot = this.byIndex.get(index);
      // Index sama tetapi id berbeda dan slot sudah punya id: provider memakai ulang index untuk call baru.
      if (slot && id !== undefined && slot.id !== '' && slot.id !== id) slot = undefined;
    } else if (id === undefined && index === undefined) slot = this.slots.at(-1);

    if (!slot) {
      slot = { id: id ?? '', name: '', arguments: '' };
      this.slots.push(slot);
    }
    if (index !== undefined) this.byIndex.set(index, slot);
    if (id !== undefined) {
      if (slot.id === '') slot.id = id;
      this.byId.set(id, slot);
    }
    const fn = tc.function;
    if (fn?.name) {
      // Sebagian provider mengirim ulang nama lengkap di setiap chunk; jangan digandakan.
      slot.name = slot.name === '' || slot.name === fn.name ? fn.name : slot.name + fn.name;
    }
    if (fn?.arguments) slot.arguments += fn.arguments;
  }

  result(): AccumulatedResult {
    const toolCalls = this.slots
      .filter((s) => s.name !== '')
      .map((s, i) => ({ id: s.id || `call_${i}`, name: s.name, arguments: s.arguments || '{}' }));
    let finishReason = this.finishReason;
    if (toolCalls.length > 0 && (finishReason === 'stop' || finishReason === null))
      finishReason = 'tool_calls';
    return { content: this.content, toolCalls, finishReason, usage: this.usage };
  }
}

/**
 * Sebagian proxy OpenAI-compatible membalas SSE (`text/event-stream`) walau request `stream:false`; SDK lalu
 * mengembalikan teks mentah. Rakit teks SSE itu menjadi `ChatCompletion` biasa (konten + tool call + usage).
 * Melempar bila tidak ada satu pun potongan `data:` yang sah.
 */
export function completionDariSse(teks: string): ChatCompletion {
  const acc = new ToolCallAccumulator();
  let pertama: ChatCompletionChunk | undefined;
  for (const baris of teks.split(/\r?\n/)) {
    if (!baris.startsWith('data:')) continue;
    const data = baris.slice(5).trim();
    if (data === '' || data === '[DONE]') continue;
    let chunk: ChatCompletionChunk;
    try {
      chunk = JSON.parse(data) as ChatCompletionChunk;
    } catch {
      continue;
    }
    if (!chunk || typeof chunk !== 'object' || !Array.isArray(chunk.choices)) continue;
    pertama ??= chunk;
    acc.push(chunk);
  }
  if (!pertama) throw new Error('respons non-stream bukan JSON maupun SSE chat.completion');
  const r = acc.result();
  return {
    id: pertama.id,
    object: 'chat.completion',
    created: pertama.created,
    model: pertama.model,
    choices: [
      {
        index: 0,
        finish_reason: (r.finishReason ?? 'stop') as ChatCompletion['choices'][number]['finish_reason'],
        logprobs: null,
        message: {
          role: 'assistant',
          content: r.content === '' && r.toolCalls.length > 0 ? null : r.content,
          refusal: null,
          ...(r.toolCalls.length > 0
            ? {
                tool_calls: r.toolCalls.map((t) => ({
                  id: t.id,
                  type: 'function' as const,
                  function: { name: t.name, arguments: t.arguments },
                })),
              }
            : {}),
        },
      },
    ],
    ...(r.usage ? { usage: r.usage } : {}),
  };
}

export async function accumulateStream(
  stream: AsyncIterable<ChatCompletionChunk>,
): Promise<AccumulatedResult> {
  const acc = new ToolCallAccumulator();
  for await (const chunk of stream) acc.push(chunk);
  return acc.result();
}
