import type { Handle } from '@sveltejs/kit/hooks';
import { installEgressBackstop } from '@urusin/egress';
import { assertHostEnv } from '#lib/server/hosts.js';
import { checkOrigin } from '#lib/server/origin.js';
import { publicOrigin } from '#lib/server/runtime.js';
import { ensureSession } from '#lib/server/sesi.js';

// Backstop egress (review v11 M2): web berjalan di network host. Jadikan Agent egress runtime (LLM + Jina,
// tolak loopback/privat) dispatcher global undici, agar fetch global, event.fetch, default SDK openai dan
// WebSocket undici tidak bisa menjangkau layanan loopback pengguna (mis. admin Caddy :2019).
installEgressBackstop();

// Gagal cepat saat startup bila DOMAIN/VERIFY_HOST/FIXTURES_HOST bukan salah satu set di deploy/hosts.json.
assertHostEnv(process.env);

/**
 * Anti-CSRF (rencana §3.2): request pengubah state wajib membawa `Origin` yang PERSIS sama dengan
 * URUSIN_PUBLIC_ORIGIN (default http://localhost:3000), kecuali yang terdaftar di `ORIGIN_EXCEPTIONS`
 * (lib/server/origin.ts). Penolakan 403 tanpa mencatat body.
 */
export const handle: Handle = async ({ event, resolve }) => {
  const verdict = checkOrigin(
    event.request.method,
    event.url.pathname,
    event.request.headers.get('origin'),
    publicOrigin(),
  );
  if (!verdict.allowed) {
    return new Response(
      JSON.stringify({
        kode: 'CSRF',
        pesanWarga: 'Permintaan ditolak karena berasal dari situs yang tidak dikenal.',
      }),
      { status: 403, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
    );
  }
  // Cookie sesi anonim hanya untuk API (identitas kuota); halaman statis tetap bebas cookie agar bisa di-cache.
  if (event.url.pathname.startsWith('/api/')) event.locals.sid = ensureSession(event.cookies, publicOrigin());
  return resolve(event);
};
