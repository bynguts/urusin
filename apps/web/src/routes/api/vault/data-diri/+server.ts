import { DataDiriSchema, type DataDiriResponse } from '@urusin/contracts';
import { akunErrorResponse, pemilikVault, readAkunBody, tolakBacaVault } from '#lib/server/akun.js';
import { apiJson } from '#lib/server/http.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

/**
 * Data Diri pemilik (akun terverifikasi/demo: ikut akun; selain itu vault satu perangkat), terenkripsi at rest.
 * Nilai hanya untuk pemiliknya sendiri (cek Sec-Fetch-Site + Origin, no-store), tidak pernah dicatat dan
 * tidak pernah masuk prompt model (model hanya melihat placeholder). Akun di sesi yang belum pernah membuka
 * brankas ("perangkat baru") butuh bukti kredensial <= 15 menit → 401 PERLU_MASUK_ULANG.
 */
export const GET: RequestHandler = async (event) => {
  const tolak = tolakBacaVault(event.request);
  if (tolak) return tolak;
  try {
    const rt = await getRuntime();
    const p = pemilikVault(rt, event, { buat: false });
    const { akun, akunSesi } = event.locals;
    if (p && akun && akunSesi && p.id === akun.id) rt.akun.izinkanUnduh({ ...akunSesi, akun });
    const d = p ? rt.akun.vault.getDataDiri(p.id) : null;
    return apiJson({
      dataDiri: DataDiriSchema.parse(d?.data ?? {}),
      diubahPada: d?.updatedAt ?? null,
    } satisfies DataDiriResponse);
  } catch (e) {
    return akunErrorResponse(e);
  }
};

/** Ganti seluruh Data Diri (field yang tidak dikirim = dihapus). Tulis pertama tamu membuat vault tamu. */
export const PUT: RequestHandler = async (event) => {
  const body = await readAkunBody(event.request, DataDiriSchema);
  if (!body.ok) return body.response;
  try {
    const rt = await getRuntime();
    const p = pemilikVault(rt, event, { buat: true })!;
    const diubahPada = rt.akun.vault.setDataDiri(p.id, body.data);
    return apiJson({ dataDiri: body.data, diubahPada } satisfies DataDiriResponse);
  } catch (e) {
    return akunErrorResponse(e);
  }
};
