import type { UrusinEvent } from '#lib/contracts.js';

/** Satu frame SSE: `id` = seq (dipakai Last-Event-ID), `event` = tipe, `data` = event JSON datar. */
export function frame(ev: UrusinEvent): string {
  return `id: ${ev.seq}\nevent: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`;
}

/**
 * Heartbeat sebagai event bernama (EventSource tidak mengekspos komentar). Sengaja TANPA `id:` supaya
 * `Last-Event-ID` klien tidak bergeser; `seq` = seq terakhir yang sudah dikirim.
 */
export function heartbeatFrame(lastSeq: number, chainHead: string): string {
  const ev = { type: 'heartbeat', seq: lastSeq, at: new Date().toISOString(), chainHead };
  return `event: heartbeat\ndata: ${JSON.stringify(ev)}\n\n`;
}
