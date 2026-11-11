import { z } from 'zod';
import { CAPABILITIES, type Capability } from './capabilities.js';

const num = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? fallback : Number(v)))
    .pipe(z.number().finite().nonnegative());

const optionalStr = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v));

const EnvSchema = z.object({
  LLM_BASE_URL: z.url(),
  LLM_API_KEY: z.string().min(1),
  LLM_AGENT_MODEL: z.string().min(1),
  LLM_VISION_MODEL: optionalStr,
  LLM_TRANSCRIBE_MODEL: optionalStr,
  LLM_TRANSCRIBE_BASE_URL: optionalStr,
  LLM_EMBED_MODEL: optionalStr,
  LLM_TIMEOUT_MS: num(60_000),
  LLM_MAX_RETRIES: num(2),
  LLM_PRICE_INPUT_PER_MTOK: num(0),
  LLM_PRICE_OUTPUT_PER_MTOK: num(0),
  LLM_PRICE_AUDIO_PER_MIN: num(0),
  LLM_REASONING_EFFORT: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim().toLowerCase()))
    .pipe(z.enum(['minimal', 'low', 'medium', 'high']).optional()),
});

export type LlmConfig = {
  baseURL: string;
  apiKey: string;
  models: {
    agent: string;
    vision?: string | undefined;
    transcribe?: string | undefined;
    embed?: string | undefined;
  };
  transcribeBaseURL?: string | undefined;
  timeoutMs: number;
  maxRetries: number;
  prices: { inputPerMTok: number; outputPerMTok: number; audioPerMin: number };
  /** Kapabilitas yang dipaksa mati lewat env LLM_FORCE_NO_*. */
  forcedOff: Capability[];
  /**
   * `reasoning_effort` untuk model bernalar (env LLM_REASONING_EFFORT). Kosong = tidak dikirim. Di proxy produksi
   * `low` memangkas token penalaran jawaban bersumber dari ~1000 ke ~150 (puluhan detik per giliran).
   */
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | undefined;
};

/** Nama env override per kapabilitas, mis. LLM_FORCE_NO_JSON_SCHEMA=1. */
export const FORCE_ENV: Record<Capability, string> = {
  tools: 'LLM_FORCE_NO_TOOLS',
  parallel_tool_calls: 'LLM_FORCE_NO_PARALLEL_TOOLS',
  json_schema_strict: 'LLM_FORCE_NO_JSON_SCHEMA',
  vision: 'LLM_FORCE_NO_VISION',
  streaming_tools: 'LLM_FORCE_NO_STREAM_TOOLS',
  transcriptions: 'LLM_FORCE_NO_TRANSCRIPTION',
  embeddings: 'LLM_FORCE_NO_EMBEDDINGS',
};

const truthy = (v: string | undefined) => v !== undefined && /^(1|true|yes)$/i.test(v.trim());

export function loadLlmConfig(env: Record<string, string | undefined> = process.env): LlmConfig {
  const e = EnvSchema.parse(env);
  return {
    baseURL: e.LLM_BASE_URL,
    apiKey: e.LLM_API_KEY,
    models: {
      agent: e.LLM_AGENT_MODEL,
      vision: e.LLM_VISION_MODEL,
      transcribe: e.LLM_TRANSCRIBE_MODEL,
      embed: e.LLM_EMBED_MODEL,
    },
    transcribeBaseURL: e.LLM_TRANSCRIBE_BASE_URL,
    timeoutMs: e.LLM_TIMEOUT_MS,
    maxRetries: Math.floor(e.LLM_MAX_RETRIES),
    prices: {
      inputPerMTok: e.LLM_PRICE_INPUT_PER_MTOK,
      outputPerMTok: e.LLM_PRICE_OUTPUT_PER_MTOK,
      audioPerMin: e.LLM_PRICE_AUDIO_PER_MIN,
    },
    forcedOff: CAPABILITIES.filter((c) => truthy(env[FORCE_ENV[c]])),
    reasoningEffort: e.LLM_REASONING_EFFORT,
  };
}
