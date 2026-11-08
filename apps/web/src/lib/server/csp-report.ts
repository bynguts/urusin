/**
 * Penghitung pelanggaran CSP (in-memory). Sengaja tidak menyimpan isi laporan, URL, atau query
 * string: hanya hitungan per direktif. Hitungan hilang saat proses restart.
 */

/** Batas ukuran body laporan (byte). Laporan CSP nyata < 2 KB. */
export const MAX_REPORT_BYTES = 8 * 1024;

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
const MAX_TRACKED_IPS = 5_000;

const KNOWN_DIRECTIVES = new Set([
  'default-src',
  'script-src',
  'script-src-elem',
  'script-src-attr',
  'style-src',
  'style-src-elem',
  'style-src-attr',
  'img-src',
  'font-src',
  'connect-src',
  'media-src',
  'object-src',
  'worker-src',
  'manifest-src',
  'frame-src',
  'child-src',
  'frame-ancestors',
  'base-uri',
  'form-action',
  'navigate-to',
  'require-trusted-types-for',
  'trusted-types',
  'sandbox',
]);

const counts = new Map<string, number>();
const hits = new Map<string, { windowStart: number; count: number }>();

/** Ambil nama direktif; apa pun di luar daftar dikelompokkan ke `other` agar key tetap terbatas. */
function normalizeDirective(raw: unknown): string {
  if (typeof raw !== 'string') return 'other';
  const name = raw.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  return KNOWN_DIRECTIVES.has(name) ? name : 'other';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Daftar direktif yang dilanggar dari body `application/csp-report` atau `application/reports+json`. */
export function parseViolations(contentType: string, text: string): string[] | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const type = contentType.split(';')[0]?.trim().toLowerCase();
  if (type === 'application/csp-report') {
    if (!isRecord(data) || !isRecord(data['csp-report'])) return null;
    const r = data['csp-report'];
    return [normalizeDirective(r['effective-directive'] ?? r['violated-directive'])];
  }
  if (type === 'application/reports+json') {
    if (!Array.isArray(data)) return null;
    const out: string[] = [];
    for (const item of data.slice(0, 20)) {
      if (!isRecord(item) || item.type !== 'csp-violation' || !isRecord(item.body)) continue;
      out.push(normalizeDirective(item.body.effectiveDirective ?? item.body.violatedDirective));
    }
    return out.length > 0 ? out : null;
  }
  return null;
}

export function recordViolations(directives: string[]): void {
  for (const d of directives) counts.set(d, (counts.get(d) ?? 0) + 1);
}

/** Jendela tetap per IP: maks RATE_LIMIT laporan per menit. */
export function allowReport(ip: string, now = Date.now()): boolean {
  const entry = hits.get(ip);
  if (!entry || now - entry.windowStart >= RATE_WINDOW_MS) {
    if (!entry && hits.size >= MAX_TRACKED_IPS) {
      for (const [key, e] of hits) if (now - e.windowStart >= RATE_WINDOW_MS) hits.delete(key);
      // Masih penuh (serangan dari banyak IP): tolak daripada memori tumbuh tanpa batas.
      if (hits.size >= MAX_TRACKED_IPS) return false;
    }
    hits.set(ip, { windowStart: now, count: 1 });
    return true;
  }
  entry.count += 1;
  return entry.count <= RATE_LIMIT;
}

/** Hitungan per direktif untuk /api/health (`csp.violations`). */
export function violationCounts(): Record<string, number> {
  return Object.fromEntries(counts);
}

/** Hanya untuk tes. */
export function resetCspReportState(): void {
  counts.clear();
  hits.clear();
}
