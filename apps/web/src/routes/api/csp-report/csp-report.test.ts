import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_REPORT_BYTES,
  allowReport,
  parseViolations,
  resetCspReportState,
  violationCounts,
} from '#lib/server/csp-report.js';
import { POST } from './+server';

function call(body: string, type: string, ip = '203.0.113.1') {
  const request = new Request('http://localhost/api/csp-report', {
    method: 'POST',
    headers: { 'content-type': type },
    body,
  });
  return POST({ request, getClientAddress: () => ip } as never);
}

const legacy = (directive: string) =>
  JSON.stringify({
    'csp-report': { 'effective-directive': directive, 'document-uri': 'https://x.test/?nik=123' },
  });

describe('POST /api/csp-report', () => {
  beforeEach(() => resetCspReportState());
  afterEach(() => vi.restoreAllMocks());

  it('menerima application/csp-report dan menghitung per direktif', async () => {
    expect((await call(legacy('script-src-elem'), 'application/csp-report')).status).toBe(204);
    expect((await call(legacy('script-src-elem'), 'application/csp-report')).status).toBe(204);
    expect(violationCounts()).toEqual({ 'script-src-elem': 2 });
  });

  it('menerima application/reports+json (beberapa laporan)', async () => {
    const body = JSON.stringify([
      { type: 'csp-violation', body: { effectiveDirective: 'img-src' } },
      { type: 'deprecation', body: {} },
      { type: 'csp-violation', body: { violatedDirective: "connect-src 'self'" } },
    ]);
    expect((await call(body, 'application/reports+json; charset=utf-8')).status).toBe(204);
    expect(violationCounts()).toEqual({ 'img-src': 1, 'connect-src': 1 });
  });

  it('mengelompokkan direktif tak dikenal ke "other" (key terbatas)', async () => {
    await call(legacy('x-<script>'), 'application/csp-report');
    expect(violationCounts()).toEqual({ other: 1 });
  });

  it('menolak content-type lain (415) dan JSON rusak (400)', async () => {
    expect((await call('{}', 'application/json')).status).toBe(415);
    expect((await call('bukan json', 'application/csp-report')).status).toBe(400);
    expect((await call('{"a":1}', 'application/csp-report')).status).toBe(400);
    expect(violationCounts()).toEqual({});
  });

  it('menolak body terlalu besar (413)', async () => {
    const big = legacy('img-src') + ' '.repeat(MAX_REPORT_BYTES);
    expect((await call(big, 'application/csp-report')).status).toBe(413);
    expect(violationCounts()).toEqual({});
  });

  it('membatasi laju per IP (429) tanpa memengaruhi IP lain', async () => {
    for (let i = 0; i < 20; i++)
      expect((await call(legacy('img-src'), 'application/csp-report')).status).toBe(204);
    expect((await call(legacy('img-src'), 'application/csp-report')).status).toBe(429);
    expect((await call(legacy('img-src'), 'application/csp-report', '203.0.113.2')).status).toBe(204);
    expect(violationCounts()).toEqual({ 'img-src': 21 });
  });

  it('tidak mencatat body atau URL ke log', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m));
    await call(legacy('img-src'), 'application/csp-report');
    await call('rusak', 'application/csp-report');
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});

describe('allowReport', () => {
  beforeEach(() => resetCspReportState());

  it('jendela laju direset setelah 60 detik', () => {
    for (let i = 0; i < 20; i++) expect(allowReport('a', 1000)).toBe(true);
    expect(allowReport('a', 1001)).toBe(false);
    expect(allowReport('a', 1000 + 60_000)).toBe(true);
  });
});

describe('parseViolations', () => {
  it('null untuk tipe tak dikenal', () => {
    expect(parseViolations('text/plain', '{}')).toBeNull();
  });
});
