/**
 * Satu baris log terstruktur untuk respons API gagal (status >= 400), agar operator bisa mendiagnosis dari server
 * tanpa menebak. Yang dicatat HANYA metode, pola rute (`/api/urusan/[id]/pendamping`, bukan id aslinya), status,
 * dan `kode` galat. Tidak ada body permintaan, id urusan, cookie, IP, atau `pesanWarga`.
 */
export type GalatApiLog = { metode: string; rute: string; status: number; kode: string | null };

const KODE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;

export async function ringkasGalatApi(
  metode: string,
  routeId: string | null,
  response: Response,
): Promise<GalatApiLog | null> {
  if (response.status < 400 || !routeId?.startsWith('/api/')) return null;
  let kode: string | null = null;
  const tipe = response.headers.get('content-type') ?? '';
  if (tipe.includes('application/json')) {
    try {
      const isi = (await response.clone().json()) as { kode?: unknown };
      if (typeof isi.kode === 'string' && KODE_RE.test(isi.kode)) kode = isi.kode;
    } catch {
      // body bukan JSON yang sah: cukup status
    }
  }
  return { metode, rute: routeId, status: response.status, kode };
}

export async function catatGalatApi(
  metode: string,
  routeId: string | null,
  response: Response,
  tulis: (baris: string) => void = (b) => console.warn(b),
): Promise<void> {
  const r = await ringkasGalatApi(metode, routeId, response);
  if (r) tulis(`[api-galat] ${JSON.stringify(r)}`);
}
