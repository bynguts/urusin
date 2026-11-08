import { assertAkunEnv } from '@urusin/akun';
import type { Handle } from '@sveltejs/kit/hooks';
import { AKUN_COOKIE, hapusAkunCookie } from '#lib/server/akun.js';
import { assertHostEnv } from '#lib/server/hosts.js';
import { checkOrigin } from '#lib/server/origin.js';
import { getRuntime, publicOrigin } from '#lib/server/runtime.js';
import { ensureSession } from '#lib/server/sesi.js';

// Gagal cepat saat startup bila DOMAIN/VERIFY_HOST/FIXTURES_HOST bukan salah satu set di deploy/hosts.json.
assertHostEnv(process.env);
// Produksi menolak start tanpa Resend (kecuali AUTH_EMAIL_DEV=1) atau tanpa URUSIN_PII_KEY (ADR 0028).
assertAkunEnv(process.env);

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
  // Sesi login: hanya bila cookie ada (tamu tidak menyentuh DB). Token tidak sah/kedaluwarsa → cookie dihapus.
  const token = event.cookies.get(AKUN_COOKIE);
  if (token) {
    const s = await getRuntime()
      .then((rt) => rt.akun.sesi(token))
      .catch(() => null);
    if (s) {
      event.locals.akun = {
        id: s.akun.id,
        email: s.akun.email,
        emailTerverifikasi: s.akun.emailVerifiedAt !== null,
      };
      event.locals.akunTokenHash = s.tokenHash;
    } else hapusAkunCookie(event.cookies);
  }
  return resolve(event);
};
