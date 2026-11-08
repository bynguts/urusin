import type { Handle } from '@sveltejs/kit/hooks';
import { publicOrigin } from '#lib/server/runtime.js';

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Anti-CSRF (rencana §3.2): setiap request pengubah state wajib membawa header `Origin` yang PERSIS sama
 * dengan URUSIN_PUBLIC_ORIGIN (default http://localhost:3000). Selain itu 403 tanpa log body.
 * Origin ekstensi tidak diterima di sini (pengecualian terdaftar hanya untuk /api/sync/status, milik S10).
 */
export const handle: Handle = async ({ event, resolve }) => {
  if (STATE_CHANGING.has(event.request.method)) {
    if (event.request.headers.get('origin') !== publicOrigin()) {
      return new Response(JSON.stringify({ kode: 'CSRF', pesan: 'origin ditolak' }), {
        status: 403,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      });
    }
  }
  return resolve(event);
};
