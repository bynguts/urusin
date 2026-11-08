import { describe, expect, it } from 'vitest';
import { fakeChunk } from './fake.js';
import { ToolCallAccumulator, accumulateStream } from './stream.js';
import type { ChatCompletionChunk } from './types.js';

const run = (chunks: ChatCompletionChunk[]) => {
  const acc = new ToolCallAccumulator();
  for (const c of chunks) acc.push(c);
  return acc.result();
};

/** Rekaman fixture gaya provider berbeda (rencana §3.11: akumulator lolos 6 rekaman). */
describe('ToolCallAccumulator: rekaman fixture', () => {
  it('1. gaya OpenAI: argumen terpecah, id hanya di chunk pertama', () => {
    const r = run([
      fakeChunk({
        role: 'assistant',
        tool_calls: [
          { index: 0, id: 'c1', type: 'function', function: { name: 'cari_layanan', arguments: '' } },
        ],
      }),
      fakeChunk({ tool_calls: [{ index: 0, function: { arguments: '{"kata' } }] }),
      fakeChunk({ tool_calls: [{ index: 0, function: { arguments: '":"akta"}' } }] }),
      fakeChunk({}, 'tool_calls'),
    ]);
    expect(r.toolCalls).toEqual([{ id: 'c1', name: 'cari_layanan', arguments: '{"kata":"akta"}' }]);
    expect(r.finishReason).toBe('tool_calls');
  });

  it('2. argumen utuh dalam satu chunk', () => {
    const r = run([
      fakeChunk(
        {
          tool_calls: [
            { index: 0, id: 'c1', type: 'function', function: { name: 'echo', arguments: '{"text":"ok"}' } },
          ],
        },
        'tool_calls',
      ),
    ]);
    expect(r.toolCalls).toHaveLength(1);
    expect(JSON.parse(r.toolCalls[0]!.arguments)).toEqual({ text: 'ok' });
  });

  it('3. id dan nama diulang di setiap chunk tidak menggandakan call', () => {
    const r = run([
      fakeChunk({
        tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'echo', arguments: '{"te' } }],
      }),
      fakeChunk({
        tool_calls: [
          { index: 0, id: 'c1', type: 'function', function: { name: 'echo', arguments: 'xt":"a"}' } },
        ],
      }),
      fakeChunk({}, 'tool_calls'),
    ]);
    expect(r.toolCalls).toEqual([{ id: 'c1', name: 'echo', arguments: '{"text":"a"}' }]);
  });

  it('4. index hilang: dicocokkan lewat id, lanjutan tanpa id masuk slot terakhir', () => {
    const noIndex = (tc: object) => fakeChunk({ tool_calls: [tc as never] });
    const r = run([
      noIndex({ id: 'a', type: 'function', function: { name: 'echo', arguments: '{"text":' } }),
      noIndex({ function: { arguments: '"1"}' } }),
      noIndex({ id: 'b', type: 'function', function: { name: 'echo', arguments: '{"text":"2"}' } }),
      fakeChunk({}, 'tool_calls'),
    ]);
    expect(r.toolCalls.map((t) => [t.id, t.arguments])).toEqual([
      ['a', '{"text":"1"}'],
      ['b', '{"text":"2"}'],
    ]);
  });

  it('5. teks dulu, tool call hanya di chunk terakhir, finish_reason "stop" dinormalisasi', () => {
    const r = run([
      fakeChunk({ role: 'assistant', content: 'Sebentar, ' }),
      fakeChunk({ content: 'saya cek.' }),
      fakeChunk(
        {
          tool_calls: [
            { index: 0, id: 'z', type: 'function', function: { name: 'cek_status', arguments: '{}' } },
          ],
        },
        'stop',
      ),
    ]);
    expect(r.content).toBe('Sebentar, saya cek.');
    expect(r.toolCalls[0]?.name).toBe('cek_status');
    expect(r.finishReason).toBe('tool_calls');
  });

  it('6. dua tool call paralel saling selang + usage di chunk akhir', () => {
    const r = run([
      fakeChunk({
        tool_calls: [{ index: 0, id: 'p0', type: 'function', function: { name: 'a', arguments: '{"x"' } }],
      }),
      fakeChunk({
        tool_calls: [{ index: 1, id: 'p1', type: 'function', function: { name: 'b', arguments: '{"y"' } }],
      }),
      fakeChunk({ tool_calls: [{ index: 0, function: { arguments: ':1}' } }] }),
      fakeChunk({ tool_calls: [{ index: 1, function: { arguments: ':2}' } }] }),
      fakeChunk({}, 'tool_calls', { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 }),
    ]);
    expect(r.toolCalls).toEqual([
      { id: 'p0', name: 'a', arguments: '{"x":1}' },
      { id: 'p1', name: 'b', arguments: '{"y":2}' },
    ]);
    expect(r.usage?.total_tokens).toBe(70);
  });
});

describe('ToolCallAccumulator: kasus tepi', () => {
  it('teks saja dengan finish_reason stop tetap stop', () => {
    const r = run([fakeChunk({ content: 'Halo' }, 'stop')]);
    expect(r).toMatchObject({ content: 'Halo', toolCalls: [], finishReason: 'stop' });
  });
  it('tool call tanpa id diberi id sintetis dan argumen kosong menjadi {}', () => {
    const r = run([fakeChunk({ tool_calls: [{ index: 0, type: 'function', function: { name: 'ping' } }] })]);
    expect(r.toolCalls).toEqual([{ id: 'call_0', name: 'ping', arguments: '{}' }]);
  });
  it('accumulateStream membaca async iterable', async () => {
    async function* gen() {
      yield fakeChunk({ content: 'a' });
      yield fakeChunk({ content: 'b' }, 'stop');
    }
    expect((await accumulateStream(gen())).content).toBe('ab');
  });
});
