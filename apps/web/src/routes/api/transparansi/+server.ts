import { transparansiView } from '@urusin/harness';
import { apiJson, errorResponse } from '#lib/server/http.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

/** Angka publik untuk /transparansi: p50/p95 latensi, biaya per hari, porsi mode degraded. Tanpa PII. */
export const GET: RequestHandler = async ({ url }) => {
  try {
    const rt = await getRuntime();
    const days = Math.min(90, Math.max(1, Number(url.searchParams.get('hari') ?? 14) || 14));
    return apiJson(transparansiView(rt.store.db, { days }));
  } catch (e) {
    return errorResponse(e);
  }
};
