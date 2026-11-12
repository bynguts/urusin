import { AnggotaKeluargaInputSchema } from '@urusin/contracts';
import { akunErrorResponse, pemilikVault, readAkunBody } from '#lib/server/akun.js';
import { apiError, apiJson } from '#lib/server/http.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

const tidakAda = () => apiError(404, 'NOT_FOUND', 'Anggota keluarga tidak ditemukan.');

/** Ganti seluruh isi satu anggota (field yang tidak dikirim = dihapus). Anggota pemilik lain = 404. */
export const PUT: RequestHandler = async (event) => {
  const body = await readAkunBody(event.request, AnggotaKeluargaInputSchema);
  if (!body.ok) return body.response;
  try {
    const rt = await getRuntime();
    const p = pemilikVault(rt, event, { buat: false });
    const r = p ? rt.akun.vault.ubahAnggota(p.id, event.params.id, body.data) : null;
    if (!r) return tidakAda();
    return apiJson({ anggota: r.anggota, diubahPada: r.updatedAt });
  } catch (e) {
    return akunErrorResponse(e);
  }
};

export const DELETE: RequestHandler = async (event) => {
  try {
    const rt = await getRuntime();
    const p = pemilikVault(rt, event, { buat: false });
    if (!p || !rt.akun.vault.hapusAnggota(p.id, event.params.id)) return tidakAda();
    return apiJson({ terhapus: true });
  } catch (e) {
    return akunErrorResponse(e);
  }
};
