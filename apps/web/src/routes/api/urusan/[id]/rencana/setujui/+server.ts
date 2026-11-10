import { TurnInProgressError, isTerminal, setujuiRencana } from '@urusin/harness';
import { z } from 'zod';
import { apiError, apiJson, errorResponse, readBody } from '#lib/server/http.js';
import { getRuntime } from '#lib/server/runtime.js';
import { urusanMilik } from '#lib/server/urusan-akses.js';
import type { RequestHandler } from './$types';

const Body = z.object({ expectedVersion: z.number().int().nonnegative().optional() });

/**
 * Tombol "Setujui rencana" (aksi terstruktur, bukan teks bebas yang ditafsirkan model). Hanya pemilik urusan
 * (`urusanMilik`), sama dengan /turn dan /konfirmasi. Bila langkah rencana bisa dikerjakan Browser Pendamping di portal kota, server
 * menawarkan permintaan eksekusi + kartu "Setujui dan buka situs" lewat stream; membuka peramban tetap butuh
 * persetujuan kartu itu dan endpoint pendamping (pemilik saja). Selain itu urusan tercatat disetujui.
 */
export const POST: RequestHandler = async ({ request, params, locals }) => {
  const body = await readBody(request, Body);
  if (!body.ok) return body.response;
  try {
    const rt = await getRuntime();
    const u = urusanMilik(rt, params.id, locals);
    if (!u) return apiError(404, 'NOT_FOUND', 'Urusan tidak ditemukan.');
    if (isTerminal(u.state)) return apiError(409, 'TERMINAL', 'Urusan ini sudah selesai.');
    if (rt.running.has(u.id) || rt.store.hasRunningTurn(u.id)) throw new TurnInProgressError();
    const r = setujuiRencana(rt.store, u.id, (e) => void rt.publish(u.id, e), body.data.expectedVersion);
    return apiJson({ state: r.urusan.state, version: r.urusan.version, pendamping: r.executionId !== null });
  } catch (e) {
    return errorResponse(e);
  }
};
