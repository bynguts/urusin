import type { Handle } from '@sveltejs/kit/hooks';
import { checkOrigin } from '#lib/server/origin.js';
import { publicOrigin } from '#lib/server/runtime.js';

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
  return resolve(event);
};
