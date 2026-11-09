import { assertAkunEnv } from '@urusin/akun';
import type { Handle } from '@sveltejs/kit/hooks';
import { installEgressBackstop } from '@urusin/egress';
import { AKUN_COOKIE, hapusAkunCookie } from '#lib/server/akun.js';
import { assertHostEnv } from '#lib/server/hosts.js';
import { checkOrigin } from '#lib/server/origin.js';
import { pasangPemeriksaPemilikAkun } from '#lib/server/pendamping.js';
import { pemeriksaPemilikVault } from '#lib/server/pendamping/pemilik.js';
import { getRuntime, publicOrigin } from '#lib/server/runtime.js';
import { ensureSession, migrasiSid } from '#lib/server/sesi.js';
import { turnstileFromEnv } from '#lib/server/turnstile.js';

// Backstop egress (review v11 M2): web berjalan di network host. Jadikan Agent egress runtime (LLM + Jina,
// tolak loopback/privat) dispatcher global undici, agar fetch global, event.fetch, default SDK openai dan
// WebSocket undici tidak bisa menjangkau layanan loopback pengguna (mis. admin Caddy :2019).
installEgressBackstop();

// Gagal cepat saat startup bila DOMAIN/VERIFY_HOST/FIXTURES_HOST bukan salah satu set di deploy/hosts.json.
assertHostEnv(process.env);
// Produksi menolak start tanpa Resend (URUSIN_EMAIL_MODE=log hanya dev/CI), tanpa URUSIN_PII_KEY, atau dengan
// IdP/Turnstile tiruan (ADR 0028).
assertAkunEnv(process.env);
turnstileFromEnv(process.env);
// m6: setiap endpoint Browser Pendamping memeriksa pemilik urusan lewat modul akun (404 bila bukan milik).
pasangPemeriksaPemilikAkun(pemeriksaPemilikVault);

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
  migrasiSid(event.cookies);
  // Cookie sesi anonim hanya untuk API (identitas kuota); halaman statis tetap bebas cookie agar bisa di-cache.
  if (event.url.pathname.startsWith('/api/')) event.locals.sid = ensureSession(event.cookies);
  // Sesi login: hanya bila cookie ada (tamu tidak menyentuh DB). Token tidak sah/kedaluwarsa → cookie dihapus.
  const token = event.cookies.get(AKUN_COOKIE);
  if (token) {
    const s = await getRuntime()
      .then((rt) => rt.akun.sesi(token))
      .catch(() => null);
    if (s) {
      event.locals.akun = s.akun;
      event.locals.akunSesi = { tokenHash: s.tokenHash, authAt: s.authAt, pernahUnduh: s.pernahUnduh };
    } else hapusAkunCookie(event.cookies);
  }
  return resolve(event);
};
