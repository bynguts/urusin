import { detectPii } from '@urusin/core';
import { HarnessError } from '@urusin/harness';
import { json } from '@sveltejs/kit';
import type { ZodType } from 'zod';
import type { ApiError } from '#lib/contracts.js';

const NO_STORE = { 'cache-control': 'no-store' } as const;

export function apiError(status: number, kode: string, pesan: string): Response {
  return json({ kode, pesan } satisfies ApiError, { status, headers: NO_STORE });
}

export function apiJson(body: unknown, status = 200): Response {
  return json(body, { status, headers: NO_STORE });
}

/** Petakan error domain ke respons; error lain tidak membocorkan detail. */
export function errorResponse(e: unknown): Response {
  if (e instanceof HarnessError) return apiError(e.status, e.code, e.message);
  return apiError(500, 'INTERNAL', 'terjadi kesalahan di server');
}

/**
 * Baca body JSON tervalidasi. Gagal → 400/422 TANPA menggemakan atau mencatat isi body.
 * Body berpola NIK/KK/HP/email ditolak 422 dengan menyebut jenisnya saja (rencana §3.1).
 */
export async function readBody<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: apiError(400, 'BODY_INVALID', 'body harus JSON yang valid') };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, response: apiError(422, 'BODY_INVALID', 'isi permintaan tidak sesuai') };
  const kinds = detectPii(JSON.stringify(raw));
  if (kinds.length > 0) {
    return {
      ok: false,
      response: apiError(
        422,
        'PII_IN_PAYLOAD',
        `pesan memuat data pribadi (${kinds.join(', ')}); isi di formulir Data Diri, bukan di chat`,
      ),
    };
  }
  return { ok: true, data: parsed.data };
}
