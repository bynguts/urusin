import type { StreamEnvelope } from '#lib/contracts.js';

/** Satu frame SSE: `id` = seq (dipakai Last-Event-ID), `event` = tipe, `data` = StreamEnvelope JSON. */
export function frame(ev: StreamEnvelope): string {
  return `id: ${ev.seq}\nevent: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`;
}
