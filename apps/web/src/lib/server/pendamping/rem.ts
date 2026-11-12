import { kunciIp } from '@urusin/akun';
import { apiError } from '#lib/server/http.js';
import { panggilPemilik, pendampingConfig, skema } from '#lib/server/pendamping.js';
import type { Runtime } from '#lib/server/runtime.js';
import { lamaTunggu } from '#lib/server/sesi.js';

/** Status sesi worker yang sudah berakhir: tidak lagi memegang peramban di server. */
const BERAKHIR: ReadonlySet<string> = new Set(['selesai', 'gagal', 'dipandu', 'kedaluwarsa', 'dibatalkan']);

export const PESAN_SESI_ASLI_AKTIF =
  'Browser Pendamping Anda masih terbuka untuk urusan lain. Selesaikan atau tutup dulu di urusan itu, lalu coba lagi.';

/**
 * Rem Browser Pendamping portal ASLI (review keamanan M1): satu sesi aktif per akun, dan paling banyak N sesi
 * mulai per jam per akun dan per IP. Mode Uji dan juri tidak lewat sini. Mengulang POST untuk eksekusi yang sama
 * pada urusan yang sama (muat ulang halaman) tidak dihitung lagi. Mengembalikan respons galat, atau undefined bila
 * boleh lanjut; pemanggil memanggil `catatSesiAsli` setelah sesi berhasil dibuat.
 */
export async function remPortalAsli(
  rt: Runtime,
  p: { akunId: string; urusanId: string; executionId: string; ip: string },
): Promise<Response | undefined> {
  const lama = rt.sesiAsliAkun.get(p.akunId);
  if (lama && lama.urusanId === p.urusanId && lama.executionId === p.executionId) return undefined;
  if (lama && lama.urusanId !== p.urusanId) {
    const r = await panggilPemilik(pendampingConfig(), '/internal/sesi/status', skema.sesi, {
      urusanId: lama.urusanId,
      sidHash: lama.sidHash,
    }).catch(() => null);
    if (r?.ok && !BERAKHIR.has(r.data.status)) return apiError(409, 'SESI_ASLI_AKTIF', PESAN_SESI_ASLI_AKTIF);
    rt.sesiAsliAkun.delete(p.akunId);
  }
  const hasil = [
    rt.limits.pendamping.akun.consume(`akun:${p.akunId}`),
    rt.limits.pendamping.ip.consume(`ip:${kunciIp(p.ip)}`),
  ];
  const kena = hasil.find((h) => !h.ok);
  if (!kena) return undefined;
  const res = apiError(
    429,
    'RATE_LIMITED',
    `Browser Pendamping sudah dibuka beberapa kali dalam satu jam terakhir. Demi keamanan akun dan situs resmi, coba lagi dalam ${lamaTunggu(kena.retryAfterSec)}.`,
  );
  res.headers.set('retry-after', String(kena.retryAfterSec));
  return res;
}

export function catatSesiAsli(
  rt: Runtime,
  p: { akunId: string; urusanId: string; executionId: string; sidHash: string },
): void {
  rt.sesiAsliAkun.set(p.akunId, { urusanId: p.urusanId, executionId: p.executionId, sidHash: p.sidHash });
}
