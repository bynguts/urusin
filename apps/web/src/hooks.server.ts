import { randomBytes } from 'node:crypto';
import { assertAkunEnv } from '@urusin/akun';
import { aturJaringanId } from '@urusin/harness';
import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { installEgressBackstop } from '@urusin/egress';
import { AKUN_COOKIE, hapusAkunCookie } from '#lib/server/akun.js';
import { assertHostEnv } from '#lib/server/hosts.js';
import { apiError } from '#lib/server/http.js';
import { catatGalatApi } from '#lib/server/log-galat.js';
import { checkOrigin } from '#lib/server/origin.js';
import {
  asalWsUntukCsp,
  jaringanIdSiap,
  panaskanJaringanId,
  pasangPemeriksaPemilikAkun,
  tambahConnectSrc,
} from '#lib/server/pendamping.js';
import { pemeriksaPemilikVault } from '#lib/server/pendamping/pemilik.js';
import { getRuntime, publicOrigin } from '#lib/server/runtime.js';
import { ensureSession, hapusTerakhir, migrasiSid, rotasiSid, SID_COOKIE } from '#lib/server/sesi.js';
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
// Rute rencana untuk portal `id-only` (Semarang) mengikuti worker berjaringan Indonesia yang benar-benar sehat:
// tanpa itu dipandu sejak kartu rencana, bukan baru saat sesi dimulai.
aturJaringanId(jaringanIdSiap);
panaskanJaringanId();

/** API urusan, brankas, dan ingatan hanya untuk akun/demo yang masuk (wajib akun, tanpa mode tamu). */
const API_WAJIB_AKUN = /^\/api\/(urusan|vault|ingatan)(\/|$)/;
/** Halaman aplikasi (bukan halaman informatif): tanpa sesi → /masuk lalu kembali ke sini. /beranda punya load sendiri. */
const HALAMAN_WAJIB_AKUN = new Set([
  '/urusan/[id]',
  '/jejak/[id]',
  '/urusanku',
  '/data-diri',
  '/dokumen',
  '/pengaturan',
]);

/**
 * Wajib akun: membuka atau memulai urusan butuh sesi login. API → 401 `BELUM_MASUK`; halaman → 303 ke /masuk
 * dengan `next` (redirect yang dilempar di hook dijawab SvelteKit sebagai JSON untuk permintaan data klien).
 */
function wajibAkun(routeId: string | null, url: URL): Response | undefined {
  if (API_WAJIB_AKUN.test(url.pathname))
    return apiError(401, 'BELUM_MASUK', 'Masuk atau daftar dulu untuk memulai dan membuka urusan.');
  if (routeId && HALAMAN_WAJIB_AKUN.has(routeId))
    redirect(303, `/masuk?next=${encodeURIComponent(url.pathname + url.search)}`);
  return undefined;
}

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
  // Sesi login: hanya bila cookie ada (tamu tidak menyentuh DB). Token tidak sah/kedaluwarsa → cookie dihapus
  // dan urusin_sid diputar seperti Keluar: pemakai berikutnya di perangkat bersama tidak mengadopsi urusan tamu
  // atau vault satu-perangkat pemakai sebelumnya. Runtime gagal (bukan sesi kedaluwarsa) tidak memutar apa pun.
  const token = event.cookies.get(AKUN_COOKIE);
  if (token) {
    const rt = await getRuntime().catch(() => null);
    const s = rt ? (rt.akun.sesi(token) ?? 'kedaluwarsa') : null;
    if (rt && s && s !== 'kedaluwarsa') {
      event.locals.akun = s.akun;
      event.locals.akunSesi = { tokenHash: s.tokenHash, authAt: s.authAt, pernahUnduh: s.pernahUnduh };
      // Sesi akun aktif tetapi urusin_sid masih memegang data tamu (mis. vault satu perangkat akun lama sebelum
      // ADR 0032, atau urusan tamu yang dibuat sebelum cookie akun terbaca): gabungkan ke akun (data akun menang,
      // tidak ditimpa) lalu putar sid (anti fiksasi), agar data itu tidak tertinggal lalu disapu penyapu tamu.
      // Hanya sid milik cookie permintaan ini; data tamu sid lain tidak tersentuh.
      const sidLama = event.cookies.get(SID_COOKIE);
      if (s.akun.jenis === 'akun' && rt.akun.sidMemegangDataTamu(sidLama)) {
        const sidBaru = randomBytes(16).toString('hex');
        rt.akun.rotasiPemilik({ sidLama, sidBaru, userId: s.akun.id, akunId: s.akun.id });
        rotasiSid(event.cookies, sidBaru);
        if (event.locals.sid) event.locals.sid = sidBaru;
      }
    } else {
      hapusAkunCookie(event.cookies);
      if (s === 'kedaluwarsa') {
        const sid = rotasiSid(event.cookies);
        if (event.locals.sid) event.locals.sid = sid;
        hapusTerakhir(event.cookies);
      }
    }
  }
  if (!event.locals.akun) {
    const tolak = wajibAkun(event.route?.id ?? null, event.url);
    if (tolak) return tolak;
  }
  const response = await resolve(event);
  // WS worker Pendamping di origin lain (demo final lokal: ws://localhost:4330) harus diizinkan connect-src;
  // tanpa ini peramban memblokirnya. Kosong di produksi (wsUrl lewat domain web sendiri = 'self'). Dihitung
  // sekali per proses; galat konfigurasi = CSP aplikasi apa adanya (fail-open), tidak pernah 500.
  const csp = response.headers.get('content-security-policy');
  if (csp) {
    const asal = asalWsUntukCsp(publicOrigin);
    if (asal.length > 0) response.headers.set('content-security-policy', tambahConnectSrc(csp, asal));
  }
  // Satu baris per respons API gagal (pola rute + status + kode saja), untuk diagnosis operator.
  if (response.status >= 400) await catatGalatApi(event.request.method, event.route?.id ?? null, response);
  return response;
};
