import type { UrusinEvent as StreamEnvelope } from '@urusin/contracts';

type Listener = (ev: StreamEnvelope) => void;

/** Pub/sub in-process per urusan (server tunggal). Sumber kebenaran tetap tabel `events`; bus hanya mempercepat. */
export class EventBus {
  private readonly listeners = new Map<string, Set<Listener>>();

  subscribe(urusanId: string, fn: Listener): () => void {
    let set = this.listeners.get(urusanId);
    if (!set) this.listeners.set(urusanId, (set = new Set()));
    set.add(fn);
    return () => {
      set.delete(fn);
      if (set.size === 0) this.listeners.delete(urusanId);
    };
  }

  publish(urusanId: string, ev: StreamEnvelope): void {
    for (const fn of [...(this.listeners.get(urusanId) ?? [])]) {
      try {
        fn(ev);
      } catch {
        // pelanggan yang rusak tidak boleh mengganggu turn
      }
    }
  }

  subscriberCount(urusanId: string): number {
    return this.listeners.get(urusanId)?.size ?? 0;
  }
}
