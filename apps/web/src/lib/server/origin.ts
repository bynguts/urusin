/**
 * Anti-CSRF: satu tempat untuk aturan Origin dan DAFTAR PENGECUALIAN TERDAFTAR.
 *
 * Aturan umum: request pengubah state (POST/PUT/PATCH/DELETE) wajib membawa `Origin` yang PERSIS sama
 * dengan origin publik. Pengecualian hanya yang tercantum di `ORIGIN_EXCEPTIONS`; menambah baris di sini
 * adalah satu-satunya cara melonggarkan, dan setiap baris wajib punya tes integrasi.
 */
export const STATE_CHANGING_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export type OriginPolicy =
  /** Tanpa pemeriksaan Origin (pemanggil bukan halaman web kita, atau browser mengirim laporan tanpa Origin). */
  | 'bebas'
  /** Tanpa Origin boleh (klien non-browser); bila Origin ADA, harus persis origin publik, selain itu ditolak. */
  | 'jika-ada';

export type OriginException = {
  /** Cocok dengan path persis, atau (bila `awalan`) path yang diawali awalan ini. */
  path: string;
  awalan?: boolean;
  kebijakan: OriginPolicy;
  alasan: string;
};

export const ORIGIN_EXCEPTIONS: readonly OriginException[] = [
  {
    path: '/api/mcp',
    awalan: true,
    kebijakan: 'jika-ada',
    alasan:
      'Klien MCP bukan browser dan tidak mengirim Origin; bila Origin ada, harus origin kita (anti DNS rebinding).',
  },
  {
    path: '/api/csp-report',
    kebijakan: 'bebas',
    alasan:
      'Laporan CSP dikirim browser otomatis, sering tanpa Origin; endpoint hanya menghitung per direktif.',
  },
  {
    path: '/api/sync/status',
    kebijakan: 'bebas',
    alasan: 'Dipanggil ekstensi (origin chrome-extension://); hanya status, tidak mengubah data warga.',
  },
];

function exceptionFor(pathname: string): OriginException | undefined {
  return ORIGIN_EXCEPTIONS.find((e) =>
    e.awalan ? pathname === e.path || pathname.startsWith(`${e.path}/`) : pathname === e.path,
  );
}

export type OriginVerdict = { allowed: true } | { allowed: false; reason: string };

/** Putusan Origin untuk satu request. Murni (tanpa efek samping) agar mudah diuji. */
export function checkOrigin(
  method: string,
  pathname: string,
  originHeader: string | null,
  publicOrigin: string,
): OriginVerdict {
  if (!STATE_CHANGING_METHODS.has(method)) return { allowed: true };
  const ex = exceptionFor(pathname);
  if (ex?.kebijakan === 'bebas') return { allowed: true };
  if (ex?.kebijakan === 'jika-ada') {
    return originHeader === null || originHeader === publicOrigin
      ? { allowed: true }
      : { allowed: false, reason: 'origin asing ditolak' };
  }
  return originHeader === publicOrigin ? { allowed: true } : { allowed: false, reason: 'origin ditolak' };
}
