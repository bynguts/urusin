import { encodePendampingFrame, type PendampingFrameMeta } from '@urusin/contracts';

/**
 * Backpressure layar ke ponsel (temuan arsitek M-2). Prinsip "frame terbaru menang":
 * - paling banyak `maxInflight` frame terkirim yang belum di-ack klien;
 * - frame dilewati selama buffer kirim WebSocket di atas `maxBuffered` byte;
 * - paling banyak `fps` frame per detik.
 * Frame yang tertahan diganti frame berikutnya (tidak pernah diantrekan). Ack yang hilang tidak membuat
 * aliran macet selamanya: entri in-flight lebih tua dari `ackTimeoutMs` dianggap selesai.
 */
export type FrameMasuk = { meta: PendampingFrameMeta; jpeg: Uint8Array };

export type FrameGate = {
  offer(f: FrameMasuk): void;
  ack(seq: number): void;
  close(): void;
};

export function createFrameGate(o: {
  write(buf: Uint8Array): void;
  buffered(): number;
  maxInflight: number;
  maxBuffered: number;
  fps: number;
  ackTimeoutMs?: number;
  now?: () => number;
}): FrameGate {
  const now = o.now ?? Date.now;
  const minJeda = 1000 / o.fps;
  const ackTimeout = o.ackTimeoutMs ?? 2_000;
  const inflight = new Map<number, number>();
  let pending: FrameMasuk | null = null;
  let seq = 0;
  let lastSent = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timerAt = Number.POSITIVE_INFINITY;
  let closed = false;

  /** Jadwalkan pump ulang; jadwal yang lebih cepat menggantikan yang lebih lambat. */
  const later = (ms: number) => {
    if (closed) return;
    const at = now() + ms;
    if (timer && at >= timerAt) return;
    clearTimeout(timer);
    timerAt = at;
    timer = setTimeout(
      () => {
        timer = undefined;
        timerAt = Number.POSITIVE_INFINITY;
        pump();
      },
      Math.max(1, Math.ceil(ms)),
    );
    timer.unref?.();
  };

  function pump(): void {
    if (closed || !pending) return;
    const t = now();
    for (const [s, sentAt] of inflight) if (t - sentAt > ackTimeout) inflight.delete(s);
    if (inflight.size >= o.maxInflight) return later(ackTimeout);
    if (o.buffered() > o.maxBuffered) return later(50);
    const tunggu = lastSent + minJeda - t;
    if (tunggu > 0) return later(tunggu);
    const f = pending;
    pending = null;
    const s = seq++;
    inflight.set(s, t);
    lastSent = t;
    o.write(encodePendampingFrame(s, f.meta, f.jpeg));
  }

  return {
    offer(f) {
      pending = f;
      pump();
    },
    ack(s) {
      inflight.delete(s);
      pump();
    },
    close() {
      closed = true;
      pending = null;
      clearTimeout(timer);
    },
  };
}
