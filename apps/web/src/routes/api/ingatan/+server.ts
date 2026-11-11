import type { HapusIngatanResponse, IngatanResponse } from '@urusin/contracts';
import { VaultError } from '@urusin/akun';
import { IngatanError } from '@urusin/harness';
import { akunErrorResponse, pemilikVault, tolakBacaVault } from '#lib/server/akun.js';
import { apiError, apiJson } from '#lib/server/http.js';
import { daftarIngatan, daftarUsulan, hapusSemuaIngatan } from '#lib/server/ingatan.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

/**
 * Ingatan warga (ADR 0031) milik pemilik vault peminta: daftar butir (label siap baca, tanpa PII). Hanya dari halaman
 * kita sendiri (Sec-Fetch-Site + Origin), sama dengan baca vault lainnya.
 */
export const GET: RequestHandler = async (event) => {
  const tolak = tolakBacaVault(event.request);
  if (tolak) return tolak;
  try {
    const rt = await getRuntime();
    const p = pemilikVault(rt, event, { buat: false });
    if (!p) return apiJson({ butir: [] } satisfies IngatanResponse);
    const usulan = daftarUsulan(rt.akun, p.id);
    return apiJson({
      butir: daftarIngatan(rt.akun, p.id),
      ...(usulan.length ? { usulan } : {}),
    } satisfies IngatanResponse);
  } catch (e) {
    if (e instanceof VaultError || e instanceof IngatanError)
      return apiError(503, 'INGATAN_TIDAK_TERBACA', 'Ingatan sedang tidak bisa dibaca. Coba lagi nanti.');
    return akunErrorResponse(e);
  }
};

/** "Hapus semua ingatan" (hak hapus UU PDP 27/2022). Idempoten: tanpa ingatan, dihapus 0. */
export const DELETE: RequestHandler = async (event) => {
  try {
    const rt = await getRuntime();
    const p = pemilikVault(rt, event, { buat: false });
    return apiJson({ dihapus: p ? hapusSemuaIngatan(rt.akun, p.id) : 0 } satisfies HapusIngatanResponse);
  } catch (e) {
    return akunErrorResponse(e);
  }
};
