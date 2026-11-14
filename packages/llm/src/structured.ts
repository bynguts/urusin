import { z } from 'zod';
import { isUnsupportedParamError } from './client.js';
import { assertCompletionUsable } from './errors.js';
import { strictSchemaFor, type StrictSchema } from './strict-schema.js';
import type { CapabilityFlags } from './capabilities.js';
import type { ReasoningEffort } from './config.js';
import type { ChatMessage, ChatProvider, RequestOptions, Usage } from './types.js';

export type StructuredMethod = 'json_schema' | 'forced_tool' | 'json_object';

export type StructuredResult<T> = {
  data: T;
  method: StructuredMethod;
  /** True bila tangga turun dari pilihan terbaik (json_schema strict). */
  degraded: boolean;
  attempts: number;
  usage: Usage[];
};

export class StructuredOutputError extends Error {
  constructor(
    message: string,
    readonly attempts: number,
  ) {
    super(message);
    this.name = 'StructuredOutputError';
  }
}

export type StructuredOptions<T> = {
  provider: ChatProvider;
  model: string;
  messages: ChatMessage[];
  schema: z.ZodType<T>;
  /** Nama skema / tool; [a-zA-Z0-9_-]. */
  name: string;
  caps: Pick<CapabilityFlags, 'json_schema_strict' | 'tools'>;
  /** Maksimal retry perbaikan pada mode json_object (rencana: ≤ 2). */
  maxRepairs?: number;
  maxTokens?: number;
  /** `reasoning_effort` per panggilan (menimpa LLM_REASONING_EFFORT global); kosong = global. */
  reasoningEffort?: ReasoningEffort | undefined;
  signal?: RequestOptions['signal'];
};

const EMIT_TOOL = 'emit_result';

function parseWith<T>(
  strict: StrictSchema<T>,
  raw: string | null | undefined,
): { ok: true; data: T } | { ok: false; error: string } {
  if (!raw) return { ok: false, error: 'respons kosong' };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: `JSON tidak valid: ${(e as Error).message}` };
  }
  const r = strict.parse(json);
  return r.success ? { ok: true, data: r.data } : { ok: false, error: z.prettifyError(r.error) };
}

/**
 * Tangga structured output (rencana §3.11):
 *   json_schema strict → forced tool `emit_result` → json_object + zod (≤ maxRepairs perbaikan).
 * Error 400 "unsupported parameter" pada satu anak tangga membuat gateway turun ke anak tangga berikutnya.
 */
export async function generateStructured<T>(opts: StructuredOptions<T>): Promise<StructuredResult<T>> {
  const usage: Usage[] = [];
  const maxTokens = opts.maxTokens ?? 1024;
  const effort = opts.reasoningEffort ? { reasoning_effort: opts.reasoningEffort } : {};
  const reqOpts = { signal: opts.signal };
  let attempts = 0;
  const strict = strictSchemaFor(opts.schema);
  const schemaJson = strict.json;
  const failures: string[] = [];

  if (opts.caps.json_schema_strict) {
    attempts++;
    try {
      const r = await opts.provider.create(
        {
          ...effort,
          model: opts.model,
          max_tokens: maxTokens,
          messages: opts.messages,
          response_format: {
            type: 'json_schema',
            json_schema: { name: opts.name, strict: true, schema: schemaJson },
          },
        },
        reqOpts,
      );
      if (r.usage) usage.push(r.usage);
      assertCompletionUsable(r, maxTokens);
      const parsed = parseWith(strict, r.choices[0]?.message.content);
      if (parsed.ok) return { data: parsed.data, method: 'json_schema', degraded: false, attempts, usage };
      failures.push(`json_schema: ${parsed.error}`);
    } catch (err) {
      if (!isUnsupportedParamError(err)) throw err;
      failures.push(`json_schema: ${(err as Error).message}`);
    }
  }

  if (opts.caps.tools) {
    attempts++;
    try {
      const r = await opts.provider.create(
        {
          ...effort,
          model: opts.model,
          max_tokens: maxTokens,
          messages: opts.messages,
          tools: [
            {
              type: 'function',
              function: { name: EMIT_TOOL, description: `Kirim hasil ${opts.name}.`, parameters: schemaJson },
            },
          ],
          tool_choice: { type: 'function', function: { name: EMIT_TOOL } },
        },
        reqOpts,
      );
      if (r.usage) usage.push(r.usage);
      assertCompletionUsable(r, maxTokens);
      const call = r.choices[0]?.message.tool_calls?.find(
        (c) => c.type === 'function' && c.function.name === EMIT_TOOL,
      );
      const parsed = parseWith(strict, call?.type === 'function' ? call.function.arguments : undefined);
      if (parsed.ok) return { data: parsed.data, method: 'forced_tool', degraded: true, attempts, usage };
      failures.push(`forced_tool: ${parsed.error}`);
    } catch (err) {
      if (!isUnsupportedParamError(err)) throw err;
      failures.push(`forced_tool: ${(err as Error).message}`);
    }
  }

  const messages: ChatMessage[] = [
    ...opts.messages,
    {
      role: 'system',
      content: `Balas HANYA dengan satu objek JSON yang valid sesuai JSON Schema berikut:\n${JSON.stringify(schemaJson)}`,
    },
  ];
  const maxRepairs = opts.maxRepairs ?? 2;
  for (let repair = 0; repair <= maxRepairs; repair++) {
    attempts++;
    const r = await opts.provider.create(
      {
        ...effort,
        model: opts.model,
        max_tokens: maxTokens,
        messages,
        response_format: { type: 'json_object' },
      },
      reqOpts,
    );
    if (r.usage) usage.push(r.usage);
    assertCompletionUsable(r, maxTokens);
    const content = r.choices[0]?.message.content;
    const parsed = parseWith(strict, content);
    if (parsed.ok) return { data: parsed.data, method: 'json_object', degraded: true, attempts, usage };
    failures.push(`json_object#${repair}: ${parsed.error}`);
    messages.push(
      { role: 'assistant', content: content ?? '' },
      {
        role: 'user',
        content: `JSON tidak sesuai skema. Perbaiki dan kirim ulang JSON saja.\nKesalahan:\n${parsed.error}`,
      },
    );
  }

  throw new StructuredOutputError(
    `structured output gagal setelah ${attempts} percobaan: ${failures.join(' | ')}`,
    attempts,
  );
}
