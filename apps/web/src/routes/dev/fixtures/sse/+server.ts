import { bacaSkenarioSse, daftarFixture } from '@urusin/contracts/fixtures-node';
import { isDev } from '#lib/server/dev.js';
import { apiError, apiJson } from '#lib/server/http.js';
import { frame } from '#lib/server/sse.js';
import type { RequestHandler } from './$types';

const encoder = new TextEncoder();

/**
 * Pemutar fixture SSE untuk mendesain/menguji UI tanpa server agen. HANYA mode dev: di produksi 404 persis
 * seperti rute yang tidak ada. `?skenario=<layar>/<state>` memutar event fixture berurutan; `&jeda=<ms>` (default
 * 300, maks 5000) mengatur jeda antar event. Tanpa `skenario`: daftar skenario yang tersedia.
 */
export const GET: RequestHandler = ({ url, request }) => {
  if (!isDev()) return apiError(404, 'NOT_FOUND', 'Halaman tidak ditemukan.');

  const nama = url.searchParams.get('skenario');
  if (!nama) {
    const sse = daftarFixture()
      .map((f) => f.nama)
      .filter((n) => bacaSkenarioSse(n) !== null);
    return apiJson({ skenario: sse });
  }
  const events = bacaSkenarioSse(nama);
  if (!events) return apiError(404, 'SKENARIO_TIDAK_ADA', 'Skenario tidak ditemukan.');

  const jedaRaw = Number(url.searchParams.get('jeda') ?? 300);
  const jeda = Number.isFinite(jedaRaw) ? Math.min(5000, Math.max(0, jedaRaw)) : 300;
  const mulaiDari = Number.parseInt(request.headers.get('last-event-id') ?? '0', 10) || 0;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const antre = events.filter((e) => e.seq > mulaiDari);
      controller.enqueue(encoder.encode('retry: 3000\n\n'));
      const kirim = (i: number) => {
        const e = antre[i];
        if (!e) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(frame(e)));
        timer = setTimeout(() => kirim(i + 1), jeda);
      };
      kirim(0);
    },
    cancel() {
      clearTimeout(timer);
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
    },
  });
};
