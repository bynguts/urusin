import { DataDiriSchema, type DataDiriResponse } from '@urusin/contracts';
import { akunErrorResponse, readAkunBody, wajibMasuk } from '#lib/server/akun.js';
import { apiJson } from '#lib/server/http.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

/**
 * Data Diri akun, terenkripsi at rest (DEK per akun). Hanya untuk warga pemiliknya: tidak pernah masuk
 * prompt model (model tetap hanya melihat placeholder `{{PEMOHON.NIK}}`). Respons no-store.
 */
export const GET: RequestHandler = async ({ locals }) => {
  const m = wajibMasuk(locals);
  if (!m.ok) return m.response;
  try {
    const rt = await getRuntime();
    const d = rt.akun.vault.getDataDiri(m.id);
    return apiJson({
      dataDiri: DataDiriSchema.parse(d?.data ?? {}),
      diubahPada: d?.updatedAt ?? null,
    } satisfies DataDiriResponse);
  } catch (e) {
    return akunErrorResponse(e);
  }
};

/** Ganti seluruh Data Diri (field yang tidak dikirim = dihapus). */
export const PUT: RequestHandler = async ({ request, locals }) => {
  const m = wajibMasuk(locals);
  if (!m.ok) return m.response;
  const body = await readAkunBody(request, DataDiriSchema);
  if (!body.ok) return body.response;
  try {
    const rt = await getRuntime();
    const diubahPada = rt.akun.vault.setDataDiri(m.id, body.data);
    return apiJson({ dataDiri: body.data, diubahPada } satisfies DataDiriResponse);
  } catch (e) {
    return akunErrorResponse(e);
  }
};
