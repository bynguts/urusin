import { z } from 'zod';
import type { BuatUrusanResponse } from '#lib/contracts.js';
import { apiJson, errorResponse, readBody } from '#lib/server/http.js';
import { getRuntime, startTurnInBackground } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

const Body = z.object({
  kodeKabKota: z
    .string()
    .regex(/^\d{4}$/)
    .optional(),
  pesan: z.string().min(1).max(2000).optional(),
});

/** Buat urusan baru; bila `pesan` diberikan, turn pertama langsung berjalan (ikuti lewat stream). */
export const POST: RequestHandler = async ({ request }) => {
  const body = await readBody(request, Body);
  if (!body.ok) return body.response;
  try {
    const rt = await getRuntime();
    const u = rt.store.createUrusan({ kodeKabKota: body.data.kodeKabKota });
    const turn = body.data.pesan
      ? startTurnInBackground(rt, { urusanId: u.id, userText: body.data.pesan })
      : undefined;
    const current = rt.store.getUrusanOrThrow(u.id);
    return apiJson(
      {
        id: u.id,
        state: current.state,
        version: current.version,
        chainHead: rt.store.chainHead(u.id),
        ...(turn ? { turnId: turn.turnId } : {}),
      } satisfies BuatUrusanResponse & { turnId?: string },
      201,
    );
  } catch (e) {
    return errorResponse(e);
  }
};
