import { detectPii } from '@urusin/core';
import { HarnessError } from '@urusin/harness';
import { json } from '@sveltejs/kit';
import type { ZodType } from 'zod';
import type { GalatApi } from '#lib/contracts.js';

const NO_STORE = { 'cache-control': 'no-store' } as const;

/**
 * Pesan warga untuk teks berisi NIK/KK/HP/email (API JSON dan form tanpa JS memakai kalimat yang sama). Ikut
 * menyebut nama ibu kandung: warga yang menempel NIK biasanya menempel nama ibu juga (p07).
 */
export const PESAN_PII =
  'Pesan berisi nomor pribadi. Demi keamanan, jangan ketik NIK, nomor KK/HP, atau nama ibu kandung di chat: hapus datanya, lalu isi di Data Diri. Kami mengisikannya langsung dari perangkat Anda.';

/** Semua galat JSON memakai bentuk seragam `{kode, pesanWarga}`. */
export function apiError(status: number, kode: string, pesanWarga: string): Response {
  return json({ kode, pesanWarga } satisfies GalatApi, { status, headers: NO_STORE });
}

export function apiJson(body: unknown, status = 200): Response {
  return json(body, { status, headers: NO_STORE });
}

/** Petakan error domain ke respons; error lain tidak membocorkan detail. */
export function errorResponse(e: unknown): Response {
  if (e instanceof HarnessError) return apiError(e.status, e.code, e.message);
  return apiError(500, 'INTERNAL', 'Ada gangguan di sistem kami. Coba lagi sebentar lagi.');
}

/**
 * Baca body JSON tervalidasi. Gagal → 400/422 TANPA menggemakan atau mencatat isi body.
 * Body berpola NIK/KK/HP/email ditolak 422 dengan menyebut jenisnya saja (rencana §3.1).
 */
export async function readBody<T>(
  request: Request,
  schema: ZodType<T>,
  /** Kode kab/kota yang sudah diketahui (mis. dari urusan), agar NIK yang dipecah antar bidang tertangkap. */
  konteks: { kodeKabKota?: string | null } = {},
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: apiError(400, 'BODY_INVALID', 'Permintaan tidak terbaca. Coba lagi.') };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    return {
      ok: false,
      response: apiError(422, 'BODY_INVALID', 'Isi permintaan tidak sesuai. Periksa lagi.'),
    };
  const kode = konteks.kodeKabKota ?? stringLeaves(raw).kode;
  const kinds = [...new Set(stringLeaves(raw).teks.flatMap((t) => detectPii(t, { kodeKabKota: kode })))];
  if (kinds.length > 0) {
    return {
      ok: false,
      response: apiError(422, 'PII_IN_PAYLOAD', PESAN_PII),
    };
  }
  return { ok: true, data: parsed.data };
}

/**
 * Id buram buatan server (`x_<uuid>`, `u_<hex32>`, `t_<uuid>`, ...): heksadesimal acak bisa kebetulan
 * berpola nomor HP/NIK (potongan UUID yang diawali 08 lalu deret angka), sehingga urusan macet
 * permanen dengan 422 PII_IN_PAYLOAD. Hanya bidang berakhiran `Id`/`id` yang nilainya PERSIS berbentuk
 * id buram yang dilewati; teks bebas dan bidang lain tetap dipindai.
 */
const ID_BURAM = /^[a-z]_(?:[0-9a-f]{16,64}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const KUNCI_ID = /(?:^id|Id)$/;

/** Semua string di dalam JSON (pada daun, bukan hasil serialisasi: escape JSON tidak menyembunyikan apa pun). */
function stringLeaves(raw: unknown): { teks: string[]; kode: string | undefined } {
  const teks: string[] = [];
  const kunjungi = (v: unknown, kunci?: string) => {
    if (typeof v === 'string') {
      if (!(kunci !== undefined && KUNCI_ID.test(kunci) && ID_BURAM.test(v))) teks.push(v);
    } else if (Array.isArray(v)) v.forEach((x) => kunjungi(x));
    else if (typeof v === 'object' && v !== null) for (const [k, x] of Object.entries(v)) kunjungi(x, k);
  };
  kunjungi(raw);
  const k = (raw as { kodeKabKota?: unknown } | null)?.kodeKabKota;
  return { teks, kode: typeof k === 'string' ? k : undefined };
}
