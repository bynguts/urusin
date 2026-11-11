import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ESLint } from 'eslint';
import OpenAI from 'openai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALL_ON, CAPABILITIES, MemoryCapabilityStore, probeCapabilities } from './capabilities.js';
import { OpenAIProvider, createOpenAIClient, isRetryableError, isUnsupportedParamError } from './client.js';
import { FORCE_ENV, loadLlmConfig } from './config.js';
import { CostMeter, usageCostUsd } from './cost.js';
import { FakeProvider, fakeChunk, fakeCompletion, unsupportedParam } from './fake.js';
import { digitPng, silentWav } from './probe-assets.js';

const ENV = {
  LLM_BASE_URL: 'https://llm.example.com/v1',
  LLM_API_KEY: 'sk-uji',
  LLM_AGENT_MODEL: 'agen',
  LLM_VISION_MODEL: 'visi',
  LLM_PRICE_INPUT_PER_MTOK: '0.5',
  LLM_PRICE_OUTPUT_PER_MTOK: '1.5',
  LLM_PRICE_AUDIO_PER_MIN: '0.006',
};

describe('konfigurasi dari env', () => {
  it('membaca baseURL, model, harga, dan default timeout/retry', () => {
    const c = loadLlmConfig(ENV);
    expect(c).toMatchObject({
      baseURL: 'https://llm.example.com/v1',
      models: { agent: 'agen', vision: 'visi', transcribe: undefined },
      timeoutMs: 60_000,
      maxRetries: 2,
      prices: { inputPerMTok: 0.5, outputPerMTok: 1.5, audioPerMin: 0.006 },
      forcedOff: [],
    });
  });
  it('LLM_FORCE_NO_* mematikan kapabilitas', () => {
    const c = loadLlmConfig({
      ...ENV,
      LLM_FORCE_NO_JSON_SCHEMA: '1',
      LLM_FORCE_NO_VISION: 'true',
      LLM_FORCE_NO_TOOLS: '',
    });
    expect(c.forcedOff).toEqual(['json_schema_strict', 'vision']);
  });
  it('setiap kapabilitas punya nama env override', () => {
    for (const cap of CAPABILITIES) expect(FORCE_ENV[cap]).toMatch(/^LLM_FORCE_NO_/);
  });
  it('menolak konfigurasi tanpa kunci atau URL tidak valid', () => {
    expect(() => loadLlmConfig({ ...ENV, LLM_API_KEY: '' })).toThrow();
    expect(() => loadLlmConfig({ ...ENV, LLM_BASE_URL: 'bukan url' })).toThrow();
  });
});

describe('klien SDK openai', () => {
  it('meneruskan baseURL, apiKey, timeout, maxRetries', () => {
    const client = createOpenAIClient({
      baseURL: 'https://x.example.com/v1',
      apiKey: 'k',
      timeoutMs: 1234,
      maxRetries: 5,
    });
    expect(client.baseURL).toBe('https://x.example.com/v1');
    expect(client.timeout).toBe(1234);
    expect(client.maxRetries).toBe(5);
  });
  it('OpenAIProvider bisa dibuat dari config', () => {
    expect(new OpenAIProvider(loadLlmConfig(ENV)).baseURL).toBe('https://llm.example.com/v1');
  });
  it('mengenali error 400 parameter tidak didukung dan error yang layak retry', () => {
    expect(isUnsupportedParamError(unsupportedParam('response_format'))).toBe(true);
    expect(isUnsupportedParamError(new Error('Unsupported parameter'))).toBe(false);
    expect(isRetryableError(OpenAI.APIError.generate(429, undefined, 'rate', new Headers()))).toBe(true);
    expect(isRetryableError(OpenAI.APIError.generate(503, undefined, 'down', new Headers()))).toBe(true);
    expect(isRetryableError(unsupportedParam('x'))).toBe(false);
  });
});

/** Provider yang menjawab probe dengan benar (dipakai bersama `without`). */
function capableProvider(without: (typeof CAPABILITIES)[number][] = []) {
  const reply = (params: Parameters<FakeProvider['create']>[0]) => {
    if (params.response_format?.type === 'json_schema') return fakeCompletion({ content: '{"angka":7}' });
    if (params.parallel_tool_calls) {
      return fakeCompletion({
        toolCalls: [
          { name: 'echo', arguments: '{"text":"a"}' },
          { name: 'echo', arguments: '{"text":"b"}' },
        ],
      });
    }
    if (params.tools) return fakeCompletion({ toolCalls: [{ name: 'echo', arguments: '{"text":"ok"}' }] });
    return fakeCompletion({ content: '7' });
  };
  return new FakeProvider({
    without,
    replies: Array.from({ length: 10 }, () => reply),
    streams: [
      [
        fakeChunk(
          {
            tool_calls: [
              { index: 0, id: 's', type: 'function', function: { name: 'echo', arguments: '{"text":"ok"}' } },
            ],
          },
          'tool_calls',
        ),
      ],
    ],
  });
}

const models = { agent: 'agen', vision: 'visi', transcribe: 'stt', embed: 'emb' };

describe('probeCapabilities', () => {
  it('provider lengkap → semua kapabilitas true', async () => {
    const report = await probeCapabilities({ provider: capableProvider(), models });
    expect(report.flags).toEqual(ALL_ON);
    expect(report.key).toBe('https://fake.llm.invalid/v1|agen');
  });

  it.each(CAPABILITIES)(
    'FakeProvider "tanpa %s" → hanya kapabilitas itu yang false, tanpa crash',
    async (cap) => {
      const report = await probeCapabilities({ provider: capableProvider([cap]), models });
      expect(report.flags[cap]).toBe(false);
      // Tanpa tools, probe yang bergantung pada tools (paralel, stream tool) ikut gagal.
      const dependents: string[] = cap === 'tools' ? ['parallel_tool_calls', 'streaming_tools'] : [];
      for (const other of CAPABILITIES.filter((c) => c !== cap)) {
        expect(report.flags[other]).toBe(!dependents.includes(other));
      }
      expect(report.details[cap].error).toBeTruthy();
    },
  );

  it('model opsional yang tidak dikonfigurasi ditandai skipped', async () => {
    const report = await probeCapabilities({ provider: capableProvider(), models: { agent: 'agen' } });
    expect(report.details.vision.skipped).toBe(true);
    expect(report.flags.transcriptions).toBe(false);
  });

  it('memakai cache dalam TTL dan probe ulang setelah kedaluwarsa', async () => {
    const store = new MemoryCapabilityStore();
    let t = Date.parse('2026-11-09T00:00:00Z');
    const now = () => new Date(t);
    const p1 = capableProvider();
    await probeCapabilities({ provider: p1, models, store, now });
    const p2 = capableProvider();
    await probeCapabilities({ provider: p2, models, store, now });
    expect(p2.calls).toHaveLength(0);
    t += 25 * 60 * 60 * 1000;
    await probeCapabilities({ provider: p2, models, store, now });
    expect(p2.calls.length).toBeGreaterThan(0);
  });

  it('override env diterapkan di atas hasil probe/cache', async () => {
    const report = await probeCapabilities({
      provider: capableProvider(),
      models,
      forcedOff: ['parallel_tool_calls'],
    });
    expect(report.flags.parallel_tool_calls).toBe(false);
    expect(report.details.parallel_tool_calls.ok).toBe(true);
  });
});

describe('meter biaya', () => {
  const prices = { inputPerMTok: 0.5, outputPerMTok: 1.5, audioPerMin: 0.006 };
  it('menghitung biaya dari usage', () => {
    expect(usageCostUsd({ prompt_tokens: 1_000_000, completion_tokens: 2_000_000 }, prices)).toBeCloseTo(3.5);
  });
  it('mengakumulasi token, audio, dan batas harian', () => {
    const m = new CostMeter(prices);
    m.addUsage({ prompt_tokens: 2000, completion_tokens: 1000 });
    m.addUsage(null);
    m.addAudio(30);
    const s = m.snapshot();
    expect(s).toMatchObject({ promptTokens: 2000, completionTokens: 1000, audioMinutes: 0.5, requests: 2 });
    expect(s.usd).toBeCloseTo(0.001 + 0.0015 + 0.003);
    expect(m.exceeds(0.001)).toBe(true);
    expect(m.exceeds(0)).toBe(false);
  });
});

describe('FakeProvider', () => {
  it('antrean habis memberi error jelas', async () => {
    await expect(new FakeProvider().create({ model: 'm', messages: [] })).rejects.toThrow(/antrean/);
  });
  it('menghormati AbortSignal', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const p = new FakeProvider({ replies: [fakeCompletion({ content: 'x' })] });
    await expect(p.create({ model: 'm', messages: [] }, { signal: ctrl.signal })).rejects.toBeInstanceOf(
      OpenAI.APIUserAbortError,
    );
  });
});

describe('aset probe', () => {
  it('PNG 64×64 valid', () => {
    const png = digitPng();
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(64);
  });
  it('WAV 1 detik 16 kHz', () => {
    const wav = silentWav(1);
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wav.length).toBe(44 + 32_000);
  });
});

describe('larangan SDK vendor lain', () => {
  const vendor = ['@anthropic', 'ai'].join('-');
  const root = resolve(import.meta.dirname, '../../..');

  it('ESLint menolak import SDK vendor lain', async () => {
    const eslint = new ESLint({ cwd: root });
    const [res] = await eslint.lintText(`import X from '${vendor}/sdk';\nexport default X;\n`, {
      filePath: join(root, 'packages/llm/src/contoh.ts'),
    });
    expect(res?.messages.map((m) => m.ruleId)).toContain('no-restricted-imports');
  }, 30_000);

  it('tidak ada import SDK vendor lain di source repo', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        // Folder tersembunyi (.svelte-kit, .turbo, .lighthouseci, ...) dan keluaran build/tes bukan source.
        if (
          name.startsWith('.') ||
          ['node_modules', 'dist', 'build', 'coverage', 'test-results', 'playwright-report'].includes(name)
        )
          continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|js|mjs|svelte|json)$/.test(name) && readFileSync(p, 'utf8').includes(`${vendor}/`)) {
          offenders.push(p);
        }
      }
    };
    for (const d of ['apps', 'packages', 'scripts']) {
      try {
        walk(join(root, d));
      } catch {
        // folder belum ada
      }
    }
    expect(offenders).toEqual([]);
    // Pemindaian disk ikut melambat saat turbo menjalankan banyak tugas paralel (CI): batas longgar.
  }, 60_000);
});

describe('stream selalu eksplisit di body permintaan', () => {
  afterEach(() => vi.unstubAllGlobals());
  const bodies: Record<string, unknown>[] = [];
  // fetch global di-stub; provider diarahkan ke sana (default-nya egress, yang tidak ikut di-stub).
  const globalFetch = { fetch: (u: string | URL | Request, i?: RequestInit) => fetch(u, i) };
  const stub = (respond: () => Response) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: unknown, init?: { body?: string }) => {
        bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        return respond();
      }),
    );
  const base = { model: 'm', messages: [{ role: 'user' as const, content: 'hai' }] };

  it('create() mengirim stream:false walau pemanggil menghilangkannya', async () => {
    bodies.length = 0;
    stub(
      () =>
        new Response(JSON.stringify(fakeCompletion({ content: 'ok' })), {
          headers: { 'content-type': 'application/json' },
        }),
    );
    const p = new OpenAIProvider(loadLlmConfig({ ...ENV, LLM_MAX_RETRIES: '0' }), globalFetch);
    await p.create(base);
    expect(bodies[0]).toHaveProperty('stream', false);
  });

  it('stream() mengirim stream:true', async () => {
    bodies.length = 0;
    stub(() => new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }));
    const p = new OpenAIProvider(loadLlmConfig({ ...ENV, LLM_MAX_RETRIES: '0' }), globalFetch);
    const it = await p.stream({ ...base, stream: true });
    for await (const _c of it) void _c;
    expect(bodies[0]).toHaveProperty('stream', true);
  });
});
