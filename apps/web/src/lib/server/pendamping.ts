import { createHash } from 'node:crypto';
import {
  AntreanPendampingResponseSchema,
  PendampingGalatSchema,
  SesiPendampingSchema,
  TiketPendampingResponseSchema,
  type MulaiSesiInternal,
  type PemilikSesiInternal,
  type SesiPendamping,
} from '@urusin/contracts';
import { PiiInterceptor, spotlight } from '@urusin/harness';
import { z, type ZodType } from 'zod';
import { apiError, apiJson } from '#lib/server/http.js';
import { SID_COOKIE } from '#lib/server/sesi.js';

/**
 * Broker web -> layanan Browser Pendamping. Warga hanya berbicara dengan web app (cookie `urusin_sid` +
 * Origin persis lewat hooks); web memanggil API internal pendamping dengan token bersama. Pendamping tidak
 * pernah melihat cookie mentah, hanya sha256-nya, dan sesi terikat ke urusan + hash itu.
 */

export type PendampingConfig = { url: string; token: string };

export function pendampingConfig(
  env: Record<string, string | undefined> = process.env,
): PendampingConfig | null {
  const url = env.PENDAMPING_INTERNAL_URL?.trim();
  const token = env.PENDAMPING_INTERNAL_TOKEN?.trim();
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

const SID_RE = /^[0-9a-f]{32}$/;

/**
 * Cookie sesi yang SUDAH ada di request (bukan yang baru dibuat hooks pada request ini): sesi pendamping
 * hanya untuk perangkat yang sudah memegang cookie, sehingga tiket tidak bisa diminta oleh peramban lain.
 */
export function sidDariRequest(request: Request): string | null {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === SID_COOKIE) {
      const val = v.join('=');
      return SID_RE.test(val) ? val : null;
    }
  }
  return null;
}

export const hashSid = (sid: string) => createHash('sha256').update(sid).digest('hex');

export type Hasil<T> = { ok: true; data: T; status: number } | { ok: false; response: Response };

const TIDAK_TERSEDIA = () =>
  apiError(
    503,
    'LAYANAN_TIDAK_TERSEDIA',
    'Browser Pendamping sedang tidak tersedia. Coba lagi sebentar lagi.',
  );

/** Panggil API internal pendamping; galat diteruskan sebagai `{kode, pesanWarga}` tanpa detail internal. */
export async function panggil<T>(
  cfg: PendampingConfig | null,
  path: string,
  schema: ZodType<T>,
  body?: MulaiSesiInternal | PemilikSesiInternal,
  fetcher: typeof fetch = fetch,
): Promise<Hasil<T>> {
  if (!cfg) return { ok: false, response: TIDAK_TERSEDIA() };
  let res: Response;
  try {
    res = await fetcher(`${cfg.url}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, response: TIDAK_TERSEDIA() };
  }
  const raw: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const g = PendampingGalatSchema.safeParse(raw);
    return {
      ok: false,
      response:
        g.success && res.status < 500
          ? apiError(res.status, g.data.kode, g.data.pesanWarga)
          : TIDAK_TERSEDIA(),
    };
  }
  const parsed = schema.safeParse(raw);
  return parsed.success
    ? { ok: true, data: parsed.data, status: res.status }
    : { ok: false, response: TIDAK_TERSEDIA() };
}

export const skema = {
  sesi: SesiPendampingSchema,
  tiket: TiketPendampingResponseSchema,
  antrean: AntreanPendampingResponseSchema,
  teks: z.object({ teks: z.string() }),
};

export const teruskan = <T>(h: Hasil<T>): Response => (h.ok ? apiJson(h.data, h.status) : h.response);

/** Status akhir pendamping -> hasil eksekusi urusan (null = belum berakhir). */
export function hasilAkhir(s: SesiPendamping): 'berhasil' | 'gagal' | 'dibatalkan' | 'drift' | null {
  return s.mode === 'done' && s.hasil ? s.hasil : null;
}

/**
 * Teks halaman pendamping untuk LLM: PII (NIK/KK/HP/email) diganti placeholder, lalu dibungkus spotlight
 * sebagai DATA TAK TEPERCAYA (pertahanan prompt injection). Satu-satunya jalan teks halaman ke model.
 */
export function teksHalamanUntukLlm(raw: string, nonce: string, maxChars = 1500): string {
  return spotlight('dom', new PiiInterceptor().redact(raw).text, { nonce, maxChars });
}
