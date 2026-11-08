import { json } from '@sveltejs/kit';
import { violationCounts } from '#lib/server/csp-report.js';
import { runningTurns } from '#lib/server/running-turns.js';
import { getRuntime, type RagInfo } from '#lib/server/runtime.js';
import { appVersion, gitSha } from '#lib/server/build-info.js';
import type { RequestHandler } from './$types';

/** Batas tunggu runtime per request health; runtime mode LLM dirakit lazy (probe kapabilitas). */
const RAG_WAIT_MS = 2_000;

type RagHealth = RagInfo | { status: 'memuat' } | { status: 'error' };

/**
 * Status korpus dari runtime. Health tidak pernah menunggu lebih dari RAG_WAIT_MS: bila runtime masih dirakit
 * (mis. probe LLM lambat), jawab `memuat` dan biarkan perakitan berlanjut di latar belakang. Gagal rakit = `error`.
 */
async function ragHealth(): Promise<RagHealth> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wait = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), RAG_WAIT_MS);
  });
  try {
    const rt = await Promise.race([getRuntime(), wait]);
    return rt ? rt.rag : { status: 'memuat' };
  } catch {
    return { status: 'error' };
  } finally {
    clearTimeout(timer);
  }
}

/** Dipakai uptime monitor dan smoke test deploy (assert gitSha == SHA yang di-deploy). Publik: 404 dari Caddy. */
export const GET: RequestHandler = async () =>
  json(
    {
      ok: true,
      // `status` dipertahankan untuk konsumen lama (bundle-budget, monitor).
      status: 'ok',
      gitSha: gitSha(),
      version: appVersion(),
      // Korpus RAG dari runtime: ready (+ jumlah chunk/vektor, model embedding), demo, memuat, atau error.
      rag: await ragHealth(),
      // Turn agen yang sedang berjalan; deploy.sh menunggu 0 sebelum menghentikan warna lama.
      runningTurns: runningTurns(),
      // Hitungan pelanggaran CSP per direktif sejak proses start (tanpa isi laporan).
      csp: { violations: violationCounts() },
    },
    { headers: { 'cache-control': 'no-store' } },
  );
