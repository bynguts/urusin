import { json } from '@sveltejs/kit';
import { violationCounts } from '#lib/server/csp-report.js';
import { runningTurns } from '#lib/server/running-turns.js';
import { appVersion, gitSha } from '#lib/server/build-info.js';
import type { RequestHandler } from './$types';

/** Dipakai uptime monitor dan smoke test deploy (assert gitSha == SHA yang di-deploy). */
export const GET: RequestHandler = () =>
  json(
    {
      ok: true,
      // `status` dipertahankan untuk konsumen lama (bundle-budget, monitor).
      status: 'ok',
      gitSha: gitSha(),
      version: appVersion(),
      // Diisi modul RAG (M20) kelak; sampai ada, tidak diinisialisasi.
      rag: { status: 'uninitialized' },
      // Turn agen yang sedang berjalan; deploy.sh menunggu 0 sebelum menghentikan warna lama.
      runningTurns: runningTurns(),
      // Hitungan pelanggaran CSP per direktif sejak proses start (tanpa isi laporan).
      csp: { violations: violationCounts() },
    },
    { headers: { 'cache-control': 'no-store' } },
  );
