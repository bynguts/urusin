import { digitPng, silentWav } from './probe-assets.js';
import { accumulateStream } from './stream.js';
import type { ChatProvider, ChatTool } from './types.js';

export const CAPABILITIES = [
  'tools',
  'parallel_tool_calls',
  'json_schema_strict',
  'vision',
  'streaming_tools',
  'transcriptions',
  'embeddings',
] as const;

export type Capability = (typeof CAPABILITIES)[number];
export type CapabilityFlags = Record<Capability, boolean>;

export type ProbeOutcome = {
  ok: boolean;
  ms: number;
  error?: string | undefined;
  skipped?: boolean | undefined;
};

export type CapabilityReport = {
  key: string;
  baseURL: string;
  model: string;
  probedAt: string;
  flags: CapabilityFlags;
  details: Record<Capability, ProbeOutcome>;
};

/** Penyimpanan cache hasil probe (implementasi SQLite disuntikkan oleh @urusin/db nanti). */
export interface CapabilityStore {
  get(key: string): Promise<CapabilityReport | undefined>;
  set(key: string, report: CapabilityReport): Promise<void>;
}

export class MemoryCapabilityStore implements CapabilityStore {
  private readonly map = new Map<string, CapabilityReport>();
  async get(key: string) {
    return this.map.get(key);
  }
  async set(key: string, report: CapabilityReport) {
    this.map.set(key, report);
  }
}

export const ALL_OFF: CapabilityFlags = Object.freeze(
  Object.fromEntries(CAPABILITIES.map((c) => [c, false])) as CapabilityFlags,
);
export const ALL_ON: CapabilityFlags = Object.freeze(
  Object.fromEntries(CAPABILITIES.map((c) => [c, true])) as CapabilityFlags,
);

export const capabilityKey = (baseURL: string, model: string) => `${baseURL}|${model}`;

const ECHO_TOOL: ChatTool = {
  type: 'function',
  function: {
    name: 'echo',
    description: 'Kembalikan teks yang diberikan.',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
  },
};

const MAX_TOKENS = 64;

export type ProbeOptions = {
  provider: ChatProvider;
  models: {
    agent: string;
    vision?: string | undefined;
    transcribe?: string | undefined;
    embed?: string | undefined;
  };
  store?: CapabilityStore;
  /** TTL cache, default 24 jam. */
  ttlMs?: number;
  /** Batas waktu per probe, default 15 detik. */
  timeoutMs?: number;
  forcedOff?: Capability[];
  force?: boolean;
  now?: () => Date;
};

type ProbeFn = (signal: AbortSignal) => Promise<boolean>;

function buildProbes(
  provider: ChatProvider,
  models: ProbeOptions['models'],
): Record<Capability, ProbeFn | null> {
  const agent = models.agent;
  return {
    tools: async (signal) => {
      const r = await provider.create(
        {
          model: agent,
          max_tokens: MAX_TOKENS,
          messages: [{ role: 'user', content: 'Panggil tool echo dengan text "ok".' }],
          tools: [ECHO_TOOL],
          tool_choice: { type: 'function', function: { name: 'echo' } },
        },
        { signal },
      );
      const call = r.choices[0]?.message.tool_calls?.[0];
      return call?.type === 'function' && call.function.name === 'echo';
    },
    parallel_tool_calls: async (signal) => {
      const r = await provider.create(
        {
          model: agent,
          max_tokens: MAX_TOKENS * 2,
          messages: [{ role: 'user', content: 'Panggil tool echo DUA kali sekaligus: "a" dan "b".' }],
          tools: [ECHO_TOOL],
          tool_choice: 'required',
          parallel_tool_calls: true,
        },
        { signal },
      );
      return (r.choices[0]?.message.tool_calls?.length ?? 0) >= 2;
    },
    json_schema_strict: async (signal) => {
      const r = await provider.create(
        {
          model: agent,
          max_tokens: MAX_TOKENS,
          messages: [{ role: 'user', content: 'Balas JSON dengan field angka = 7.' }],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'probe',
              strict: true,
              schema: {
                type: 'object',
                properties: { angka: { type: 'integer' } },
                required: ['angka'],
                additionalProperties: false,
              },
            },
          },
        },
        { signal },
      );
      const parsed = JSON.parse(r.choices[0]?.message.content ?? 'null') as { angka?: unknown } | null;
      return typeof parsed?.angka === 'number';
    },
    vision: models.vision
      ? async (signal) => {
          const url = `data:image/png;base64,${digitPng().toString('base64')}`;
          const r = await provider.create(
            {
              model: models.vision as string,
              max_tokens: MAX_TOKENS,
              messages: [
                {
                  role: 'user',
                  content: [
                    { type: 'text', text: 'Angka berapa di gambar ini? Jawab satu digit saja.' },
                    { type: 'image_url', image_url: { url } },
                  ],
                },
              ],
            },
            { signal },
          );
          return /7/.test(r.choices[0]?.message.content ?? '');
        }
      : null,
    streaming_tools: async (signal) => {
      const stream = await provider.stream(
        {
          model: agent,
          max_tokens: MAX_TOKENS,
          stream: true,
          messages: [{ role: 'user', content: 'Panggil tool echo dengan text "ok".' }],
          tools: [ECHO_TOOL],
          tool_choice: { type: 'function', function: { name: 'echo' } },
        },
        { signal },
      );
      const result = await accumulateStream(stream);
      const call = result.toolCalls[0];
      if (call?.name !== 'echo') return false;
      JSON.parse(call.arguments);
      return true;
    },
    transcriptions: models.transcribe
      ? async () => {
          await provider.transcribe({
            model: models.transcribe as string,
            audio: silentWav(1),
            filename: 'probe.wav',
            language: 'id',
          });
          return true;
        }
      : null,
    embeddings: models.embed
      ? async () => {
          const [v] = await provider.embed({ model: models.embed as string, texts: ['uji'] });
          return Array.isArray(v) && v.length > 0;
        }
      : null,
  };
}

async function runProbe(fn: ProbeFn | null, timeoutMs: number): Promise<ProbeOutcome> {
  if (!fn)
    return { ok: false, ms: 0, skipped: true, error: 'model untuk kapabilitas ini tidak dikonfigurasi' };
  const started = performance.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const ok = await fn(ctrl.signal);
    return { ok, ms: Math.round(performance.now() - started) };
  } catch (err) {
    return { ok: false, ms: Math.round(performance.now() - started), error: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Uji kapabilitas provider dengan request kecil nyata, paralel. Probe yang gagal tidak melempar
 * (boot tidak boleh crash). Hasil di-cache di store (TTL 24 jam) dan override env diterapkan terakhir.
 */
export async function probeCapabilities(opts: ProbeOptions): Promise<CapabilityReport> {
  const now = opts.now ?? (() => new Date());
  const ttl = opts.ttlMs ?? 24 * 60 * 60 * 1000;
  const key = capabilityKey(opts.provider.baseURL, opts.models.agent);
  const forcedOff = opts.forcedOff ?? [];

  if (opts.store && !opts.force) {
    const cached = await opts.store.get(key);
    if (cached && now().getTime() - Date.parse(cached.probedAt) < ttl) {
      return applyForcedOff(cached, forcedOff);
    }
  }

  const probes = buildProbes(opts.provider, opts.models);
  const outcomes = await Promise.all(
    CAPABILITIES.map(async (c) => [c, await runProbe(probes[c], opts.timeoutMs ?? 15_000)] as const),
  );
  const details = Object.fromEntries(outcomes) as Record<Capability, ProbeOutcome>;
  const flags = Object.fromEntries(CAPABILITIES.map((c) => [c, details[c].ok])) as CapabilityFlags;
  const report: CapabilityReport = {
    key,
    baseURL: opts.provider.baseURL,
    model: opts.models.agent,
    probedAt: now().toISOString(),
    flags,
    details,
  };
  if (opts.store) await opts.store.set(key, report);
  return applyForcedOff(report, forcedOff);
}

export function applyForcedOff(report: CapabilityReport, forcedOff: Capability[]): CapabilityReport {
  if (forcedOff.length === 0) return report;
  const flags = { ...report.flags };
  for (const c of forcedOff) flags[c] = false;
  return { ...report, flags };
}
