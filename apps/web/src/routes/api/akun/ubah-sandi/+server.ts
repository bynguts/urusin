import { UbahSandiRequestSchema } from '@urusin/contracts';
import { akunErrorResponse, konteks, pasangSesi, readAkunBody, wajibMasuk } from '#lib/server/akun.js';
import { apiJson } from '#lib/server/http.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

/** Ubah sandi (akun Google-saja boleh membuat sandi tanpa sandi lama). Sesi lain dihapus, sesi ini dirotasi. */
export const POST: RequestHandler = async (event) => {
  const m = wajibMasuk(event.locals);
  if (!m.ok) return m.response;
  const body = await readAkunBody(event.request, UbahSandiRequestSchema);
  if (!body.ok) return body.response;
  try {
    const rt = await getRuntime();
    const token = await rt.akun.ubahSandi(m.id, body.data, konteks(event));
    pasangSesi(rt, event.cookies, m.id, token);
    return apiJson({ berhasil: true });
  } catch (e) {
    return akunErrorResponse(e);
  }
};
