import { decodePendampingFrame } from '@urusin/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFrameGate } from './stream.js';

const META = { lebar: 390, tinggi: 844, skala: 1, offsetAtas: 0, scrollX: 0, scrollY: 0 };
const frame = (scrollY: number) => ({
  meta: { ...META, scrollY },
  jpeg: Uint8Array.from([0xff, 0xd8, scrollY]),
});

describe('gerbang frame (backpressure ke ponsel)', () => {
  let t = 0;
  let buffered = 0;
  let out: { seq: number; scrollY: number }[] = [];
  const gate = (over: { fps?: number; maxInflight?: number } = {}) =>
    createFrameGate({
      write: (b) => {
        const f = decodePendampingFrame(b)!;
        out.push({ seq: f.seq, scrollY: f.meta.scrollY });
      },
      buffered: () => buffered,
      maxInflight: over.maxInflight ?? 2,
      maxBuffered: 128 * 1024,
      fps: over.fps ?? 1000,
      now: () => t,
    });

  beforeEach(() => {
    vi.useFakeTimers();
    t = 0;
    buffered = 0;
    out = [];
  });
  afterEach(() => vi.useRealTimers());

  const maju = (ms: number) => {
    t += ms;
    vi.advanceTimersByTime(ms);
  };

  it('maks 2 frame belum di-ack; frame terbaru menggantikan yang tertahan; ack melepas', () => {
    const g = gate();
    g.offer(frame(1));
    maju(1);
    g.offer(frame(2));
    maju(1);
    g.offer(frame(3)); // tertahan (2 in-flight)
    g.offer(frame(4)); // menggantikan 3
    maju(5);
    expect(out.map((f) => f.scrollY)).toEqual([1, 2]);
    g.ack(0);
    expect(out.map((f) => f.scrollY)).toEqual([1, 2, 4]);
    expect(out.map((f) => f.seq)).toEqual([0, 1, 2]);
  });

  it('buffer WS di atas 128 KB: frame dilewati sampai buffer turun', () => {
    const g = gate();
    buffered = 200 * 1024;
    g.offer(frame(1));
    maju(100);
    expect(out).toEqual([]);
    buffered = 0;
    maju(60);
    expect(out.map((f) => f.scrollY)).toEqual([1]);
  });

  it('batas fps: frame berikutnya menunggu jeda 1000/fps', () => {
    const g = gate({ fps: 8, maxInflight: 10 });
    g.offer(frame(1));
    g.offer(frame(2));
    expect(out).toHaveLength(1);
    maju(100);
    expect(out).toHaveLength(1);
    maju(30);
    expect(out.map((f) => f.scrollY)).toEqual([1, 2]);
  });

  it('ack hilang tidak memacetkan aliran selamanya (timeout 2 detik); close menghentikan semuanya', () => {
    const g = gate({ maxInflight: 1 });
    g.offer(frame(1));
    maju(1);
    g.offer(frame(2));
    maju(1500);
    expect(out).toHaveLength(1);
    maju(600);
    expect(out.map((f) => f.scrollY)).toEqual([1, 2]);
    g.offer(frame(3));
    g.close();
    maju(5000);
    g.ack(1);
    expect(out).toHaveLength(2);
  });
});
