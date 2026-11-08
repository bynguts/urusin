import type { UrusinEvent } from '@urusin/contracts';
import type { StoredEvent } from './store.js';

/** Event tersimpan (baris tabel `events`) → event SSE datar: `{type, seq, at, chainHead, ...isi}`. */
export function toEvent(e: Pick<StoredEvent, 'seq' | 'at' | 'hash' | 'type' | 'payload'>): UrusinEvent {
  return {
    ...(e.payload as Record<string, unknown>),
    type: e.type,
    seq: e.seq,
    at: e.at,
    chainHead: e.hash,
  } as UrusinEvent;
}
