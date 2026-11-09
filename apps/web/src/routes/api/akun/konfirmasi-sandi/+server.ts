import { KonfirmasiSandiRequestSchema } from '@urusin/contracts';
import { akunErrorResponse, readAkunBody, wajibMasuk } from '#lib/server/akun.js';
import { apiJson } from '#lib/server/http.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

/** Konfirmasi sandi untuk sesi ini (re-auth sebelum unduh berkas di perangkat baru). Ikut penguncian. */
export const POST: RequestHandler = async ({ request, locals }) => {
  const m = wajibMasuk(locals);
  if (!m.ok) return m.response;
  const body = await readAkunBody(request, KonfirmasiSandiRequestSchema);
  if (!body.ok) return body.response;
  try {
    const rt = await getRuntime();
    await rt.akun.konfirmasiSandi(m.id, locals.akunSesi!.tokenHash, body.data.sandi);
    return apiJson({ berhasil: true });
  } catch (e) {
    return akunErrorResponse(e);
  }
};
