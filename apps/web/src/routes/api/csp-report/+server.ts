import { MAX_REPORT_BYTES, allowReport, parseViolations, recordViolations } from '#lib/server/csp-report.js';
import type { RequestHandler } from './$types';

const ACCEPTED = ['application/csp-report', 'application/reports+json'];

/** Baca body dengan batas byte nyata (tidak mempercayai Content-Length saja). */
async function readLimited(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_REPORT_BYTES) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_REPORT_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Penerima laporan pelanggaran CSP. Tidak mencatat body/URL (bisa memuat data pengguna di query
 * string); hanya menaikkan hitungan per direktif yang tampil di /api/health.
 */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  const contentType = (request.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (!ACCEPTED.includes(contentType)) return new Response(null, { status: 415 });

  let ip: string;
  try {
    ip = getClientAddress();
  } catch {
    ip = 'unknown';
  }
  if (!allowReport(ip)) return new Response(null, { status: 429, headers: { 'retry-after': '60' } });

  const text = await readLimited(request);
  if (text === null) return new Response(null, { status: 413 });

  const directives = parseViolations(contentType, text);
  if (!directives) return new Response(null, { status: 400 });

  recordViolations(directives);
  return new Response(null, { status: 204 });
};
