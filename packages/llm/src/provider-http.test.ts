import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OpenAIProvider } from './client.js';
import { loadLlmConfig } from './config.js';

type Seen = { url: string; contentType: string; body: Record<string, unknown> | string };

let server: Server;
let baseURL: string;
const seen: Seen[] = [];

const completion = {
  id: 'c1',
  object: 'chat.completion',
  created: 0,
  model: 'm',
  choices: [{ index: 0, message: { role: 'assistant', content: 'halo' }, finish_reason: 'stop' }],
};

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const contentType = String(req.headers['content-type'] ?? '');
      const url = req.url ?? '';
      const body = contentType.includes('json') ? (JSON.parse(raw) as Record<string, unknown>) : raw;
      seen.push({ url, contentType, body });
      if (url.endsWith('/chat/completions')) {
        // Meniru provider nyata: stream hanya bila field `stream` bernilai true; bila dihilangkan, SSE.
        const stream = (body as Record<string, unknown>).stream;
        if ((body as Record<string, unknown>).model === 'sse-paksa') {
          // Proxy yang membalas SSE walau stream:false; tool call terpecah dua potongan + usage.
          res.setHeader('content-type', 'text/event-stream');
          const base = { id: 'c2', object: 'chat.completion.chunk', created: 5, model: 'sse-paksa' };
          const tc = (args: string, extra: object = {}, name?: string) => ({
            ...base,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    { index: 0, ...extra, function: { ...(name ? { name } : {}), arguments: args } },
                  ],
                },
                finish_reason: null,
              },
            ],
          });
          res.write(
            `data: ${JSON.stringify(tc('{"text":', { id: 'call_1', type: 'function' }, 'echo'))}\n\n`,
          );
          res.write(`data: ${JSON.stringify(tc('"ok"}'))}\n\n`);
          res.write(
            `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } })}\n\n`,
          );
          res.end('data: [DONE]\n\n');
          return;
        }
        if ((body as Record<string, unknown>).model === 'bukan-json') {
          res.setHeader('content-type', 'text/plain');
          res.end('proxy sibuk');
          return;
        }
        if (stream === false) {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(completion));
        } else {
          res.setHeader('content-type', 'text/event-stream');
          const chunk = {
            id: 'c1',
            object: 'chat.completion.chunk',
            created: 0,
            model: 'm',
            choices: [{ index: 0, delta: { content: 'ha' }, finish_reason: null }],
          };
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          res.end('data: [DONE]\n\n');
        }
        return;
      }
      res.setHeader('content-type', 'application/json');
      if (url.endsWith('/audio/transcriptions')) res.end(JSON.stringify({ text: 'tes suara' }));
      else if (url.endsWith('/embeddings')) {
        res.end(
          JSON.stringify({
            object: 'list',
            model: 'e',
            usage: { prompt_tokens: 1, total_tokens: 1 },
            data: [{ object: 'embedding', index: 0, embedding: [0.5, 0.25] }],
          }),
        );
      } else {
        res.statusCode = 404;
        res.end('{}');
      }
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(() => new Promise<void>((ok) => server.close(() => ok())));

const provider = (extra: Record<string, string> = {}) =>
  new OpenAIProvider(
    loadLlmConfig({
      LLM_BASE_URL: baseURL,
      LLM_API_KEY: 'sk-uji',
      LLM_AGENT_MODEL: 'agen',
      LLM_MAX_RETRIES: '0',
      ...extra,
    }),
    // Server uji di port loopback acak: egress (benar) memblokirnya, jadi tes memakai fetch global.
    { fetch: (u, i) => fetch(u, i) },
  );

const lastChatBody = () =>
  [...seen].reverse().find((s) => s.url.endsWith('/chat/completions'))!.body as Record<string, unknown>;

describe('OpenAIProvider lewat HTTP', () => {
  it('create() selalu mengirim stream:false walau pemanggil tidak menyebutnya', async () => {
    const res = await provider().create({ model: 'agen', messages: [{ role: 'user', content: 'hai' }] });
    expect(res.choices[0]?.message.content).toBe('halo');
    expect(lastChatBody().stream).toBe(false);
  });

  it('create() tahan proxy yang membalas SSE untuk stream:false (konten, tool call, usage)', async () => {
    const res = await provider().create({ model: 'sse-paksa', messages: [{ role: 'user', content: 'hai' }] });
    expect(lastChatBody().stream).toBe(false);
    const m = res.choices[0]!;
    expect(m.finish_reason).toBe('tool_calls');
    expect(m.message.tool_calls).toEqual([
      { id: 'call_1', type: 'function', function: { name: 'echo', arguments: '{"text":"ok"}' } },
    ]);
    expect(res.usage).toEqual({ prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 });
  });

  it('LLM_REASONING_EFFORT dikirim sebagai reasoning_effort; kosong = tidak dikirim', async () => {
    const msg = { model: 'agen', messages: [{ role: 'user' as const, content: 'hai' }] };
    await provider().create(msg);
    expect('reasoning_effort' in lastChatBody()).toBe(false);
    await provider({ LLM_REASONING_EFFORT: 'LOW' }).create(msg);
    expect(lastChatBody().reasoning_effort).toBe('low');
    await provider({ LLM_REASONING_EFFORT: 'low' }).stream({ ...msg, stream: true });
    expect(lastChatBody().reasoning_effort).toBe('low');
    expect(() => provider({ LLM_REASONING_EFFORT: 'super' })).toThrow();
  });

  it('reasoning_effort per panggilan menimpa global', async () => {
    const msg = { model: 'agen', messages: [{ role: 'user' as const, content: 'hai' }] };
    await provider({ LLM_REASONING_EFFORT: 'low' }).create({ ...msg, reasoning_effort: 'high' });
    expect(lastChatBody().reasoning_effort).toBe('high');
  });

  it('LLM_MAX_TOKENS_PARAM: bawaan max_tokens; max_completion_tokens mengganti nama field', async () => {
    const msg = { model: 'agen', max_tokens: 16_000, messages: [{ role: 'user' as const, content: 'hai' }] };
    await provider().create(msg);
    expect(lastChatBody().max_tokens).toBe(16_000);
    expect('max_completion_tokens' in lastChatBody()).toBe(false);
    await provider({ LLM_MAX_TOKENS_PARAM: 'max_completion_tokens' }).create(msg);
    expect(lastChatBody().max_completion_tokens).toBe(16_000);
    expect('max_tokens' in lastChatBody()).toBe(false);
    expect(() => provider({ LLM_MAX_TOKENS_PARAM: 'max_output_tokens' })).toThrow();
  });

  it('create(): balasan bukan JSON maupun SSE = galat (bukan teks mentah)', async () => {
    await expect(
      provider().create({ model: 'bukan-json', messages: [{ role: 'user', content: 'hai' }] }),
    ).rejects.toThrow(/bukan JSON maupun SSE/);
  });

  it('stream() selalu mengirim stream:true dan membaca potongan SSE', async () => {
    const it = await provider().stream({
      model: 'agen',
      messages: [{ role: 'user', content: 'hai' }],
      stream: true,
    });
    const parts: string[] = [];
    for await (const c of it) parts.push(c.choices[0]?.delta.content ?? '');
    expect(parts.join('')).toBe('ha');
    expect(lastChatBody().stream).toBe(true);
  });

  it('stream() tetap stream:true walau field dibuang oleh pemanggil', async () => {
    const params = { model: 'agen', messages: [{ role: 'user' as const, content: 'hai' }] };
    await provider().stream(params as unknown as Parameters<OpenAIProvider['stream']>[0]);
    expect(lastChatBody().stream).toBe(true);
  });

  it('transcribe() mengunggah multipart dan mengembalikan teks (bahasa opsional)', async () => {
    const p = provider();
    const a = await p.transcribe({ model: 'stt', audio: new Uint8Array([1, 2, 3]), filename: 'a.wav' });
    const b = await p.transcribe({
      model: 'stt',
      audio: new Uint8Array([1, 2, 3]),
      filename: 'a.wav',
      language: 'id',
    });
    expect(a).toEqual({ text: 'tes suara' });
    expect(b).toEqual({ text: 'tes suara' });
    const forms = seen.filter((s) => s.url.endsWith('/audio/transcriptions'));
    expect(forms.at(-2)!.body).not.toContain('name="language"');
    expect(forms.at(-1)!.body).toContain('name="language"');
  });

  it('transcribe() memakai transcribeBaseURL bila diset', async () => {
    const p = provider({ LLM_TRANSCRIBE_BASE_URL: baseURL });
    const before = seen.length;
    await p.transcribe({ model: 'stt', audio: new Uint8Array([9]), filename: 'b.wav' });
    expect(seen.length).toBe(before + 1);
  });

  it('embed() mengembalikan vektor per teks', async () => {
    expect(await provider().embed({ model: 'e', texts: ['a'] })).toEqual([[0.5, 0.25]]);
  });
});
