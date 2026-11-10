import { toEvent } from '@urusin/harness';
import type { UrusinEvent } from '#lib/contracts.js';
import { apiError, errorResponse } from '#lib/server/http.js';
import { getRuntime } from '#lib/server/runtime.js';
import { frame, heartbeatFrame } from '#lib/server/sse.js';
import { urusanMilik } from '#lib/server/urusan-akses.js';
import type { RequestHandler } from './$types';

const encoder = new TextEncoder();

/**
 * SSE per urusan. Resume: header `Last-Event-ID` (atau `?lastEventId=`) memutar ulang event dari tabel `events`
 * dengan seq lebih besar, lalu melanjutkan secara langsung. Heartbeat (event `heartbeat`, tanpa `id:`) tiap 15 detik
 * menjaga koneksi di balik proxy. Saat klien putus: berhenti berlangganan; bila tidak ada pelanggan tersisa setelah
 * masa tenggang, loop LLM yang sedang berjalan dibatalkan (AbortController), sehingga tidak ada panggilan LLM berikutnya.
 */
export const GET: RequestHandler = async ({ params, request, url, locals }) => {
  try {
    const rt = await getRuntime();
    const id = params.id;
    if (!urusanMilik(rt, id, locals)) return apiError(404, 'NOT_FOUND', 'Urusan tidak ditemukan.');

    const raw = request.headers.get('last-event-id') ?? url.searchParams.get('lastEventId') ?? '0';
    const last = Number.parseInt(raw, 10);
    let lastSent = Number.isFinite(last) && last > 0 ? last : 0;

    let cleanup = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        const write = (chunk: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            close();
          }
        };
        const send = (ev: UrusinEvent) => {
          if (ev.seq <= lastSent) return;
          lastSent = ev.seq;
          write(frame(ev));
        };

        // Berlangganan DULU (buffer), lalu putar ulang dari DB, lalu kuras buffer: tidak ada event hilang/ganda.
        const buffer: UrusinEvent[] = [];
        let replaying = true;
        const unsubscribe = rt.bus.subscribe(id, (ev) => (replaying ? buffer.push(ev) : send(ev)));
        write('retry: 3000\n\n');
        for (;;) {
          const batch = rt.store.eventsAfter(id, lastSent, 500);
          if (batch.length === 0) break;
          for (const e of batch) send(toEvent(e));
        }
        replaying = false;
        for (const ev of buffer.sort((a, b) => a.seq - b.seq)) send(ev);

        const heartbeat = setInterval(
          () => write(heartbeatFrame(lastSent, rt.store.chainHead(id))),
          rt.config.heartbeatMs,
        );
        let graceTimer: ReturnType<typeof setTimeout> | undefined;

        function close() {
          if (closed) return;
          closed = true;
          clearInterval(heartbeat);
          unsubscribe();
          // Tidak ada pelanggan tersisa → batalkan turn yang berjalan setelah masa tenggang (jaringan HP sering putus-nyambung).
          // Tangkap controller SAAT ditutup: turn yang lebih baru (controller lain) tidak boleh ikut dibatalkan.
          const target = rt.running.get(id);
          if (rt.bus.subscriberCount(id) === 0 && target) {
            graceTimer = setTimeout(() => {
              if (rt.bus.subscriberCount(id) === 0 && rt.running.get(id) === target) target.abort();
            }, rt.config.disconnectGraceMs);
            graceTimer.unref?.();
          }
          try {
            controller.close();
          } catch {
            // sudah ditutup
          }
        }
        cleanup = close;
        request.signal.addEventListener('abort', close, { once: true });
        if (request.signal.aborted) close();
      },
      cancel() {
        cleanup();
      },
    });

    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store, no-transform',
        'x-accel-buffering': 'no',
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
};
