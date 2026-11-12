import {
  ANGGOTA_KELUARGA_MAKS,
  AnggotaKeluargaInputSchema,
  type DataKeluargaResponse,
} from '@urusin/contracts';
import {
  akunErrorResponse,
  anggotaKeluarga,
  pemilikVault,
  readAkunBody,
  tolakBacaVault,
} from '#lib/server/akun.js';
import { apiError, apiJson } from '#lib/server/http.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

/**
 * Anggota keluarga pemilik brankas (ENDPOINT_KELUARGA), terenkripsi bersama Data Diri. Aturan baca sama dengan
 * /api/vault/data-diri: hanya dari halaman kita sendiri, no-store, perangkat baru butuh bukti kredensial
 * <= 15 menit. Nilai tidak pernah dicatat dan tidak pernah masuk prompt model.
 */
export const GET: RequestHandler = async (event) => {
  const tolak = tolakBacaVault(event.request);
  if (tolak) return tolak;
  try {
    const rt = await getRuntime();
    const p = pemilikVault(rt, event, { buat: false });
    const { akun, akunSesi } = event.locals;
    if (p && akun && akunSesi && p.id === akun.id) rt.akun.izinkanUnduh({ ...akunSesi, akun });
    const k = p ? rt.akun.vault.getKeluarga(p.id) : null;
    return apiJson({
      anggota: p ? anggotaKeluarga(rt, p.id) : [],
      diubahPada: k?.updatedAt ?? null,
    } satisfies DataKeluargaResponse);
  } catch (e) {
    return akunErrorResponse(e);
  }
};

/** Tambah anggota. Tulis pertama tamu membuat vault tamu. */
export const POST: RequestHandler = async (event) => {
  const body = await readAkunBody(event.request, AnggotaKeluargaInputSchema);
  if (!body.ok) return body.response;
  try {
    const rt = await getRuntime();
    const p = pemilikVault(rt, event, { buat: true })!;
    if ((rt.akun.vault.getKeluarga(p.id)?.anggota.length ?? 0) >= ANGGOTA_KELUARGA_MAKS)
      return apiError(
        422,
        'KELUARGA_PENUH',
        `Paling banyak ${ANGGOTA_KELUARGA_MAKS} anggota keluarga. Hapus yang tidak dipakai dulu.`,
      );
    const r = rt.akun.vault.tambahAnggota(p.id, body.data);
    return apiJson({ anggota: r.anggota, diubahPada: r.updatedAt }, 201);
  } catch (e) {
    return akunErrorResponse(e);
  }
};
