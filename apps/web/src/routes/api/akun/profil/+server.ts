import { LengkapiProfilRequestSchema, type DataDiriResponse } from '@urusin/contracts';
import {
  akunErrorResponse,
  lengkapiProfil,
  pemilikVault,
  readAkunBody,
  wajibMasuk,
} from '#lib/server/akun.js';
import { apiJson } from '#lib/server/http.js';
import { getRuntime } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

/**
 * Lengkapi profil: gabungkan nama lengkap (dan HP opsional) ke Data Diri terenkripsi pemilik vault (akun
 * atau demo: ikut akun di semua perangkat; tamu: vault satu perangkat).
 */
export const POST: RequestHandler = async (event) => {
  const m = wajibMasuk(event.locals);
  if (!m.ok) return m.response;
  const body = await readAkunBody(event.request, LengkapiProfilRequestSchema);
  if (!body.ok) return body.response;
  try {
    const rt = await getRuntime();
    const p = pemilikVault(rt, event, { buat: true })!;
    return apiJson(lengkapiProfil(rt, p.id, body.data) satisfies DataDiriResponse);
  } catch (e) {
    return akunErrorResponse(e);
  }
};
