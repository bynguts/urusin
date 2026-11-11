import { apiError, apiJson, errorResponse } from '#lib/server/http.js';
import { panggilPemilik, pendampingConfig, skema } from '#lib/server/pendamping.js';
import { akses } from '../akses';
import { PESAN_BELUM_TERKIRIM, catatHasilSesi } from '../hasil';
import type { RequestHandler } from './$types';

/**
 * "Saya sudah mengirim": warga menekan Kirim sendiri di situs (AI sudah berhenti atau warga memegang kendali).
 * Hanya pemilik urusan (cek akun + cookie sesi; Origin diperiksa hook). Worker memeriksa ulang halaman saat ini
 * (tulis warga sejak aksi AI + halaman sukses) sebelum sesi `siaga` berhasil; klaim warga sendiri tidak cukup.
 */
export const POST: RequestHandler = async ({ request, params }) => {
  try {
    const a = await akses(request, params.id);
    if (!a.ok) return a.response;
    const r = await panggilPemilik(pendampingConfig(), '/internal/sesi/selesai', skema.sesi, {
      urusanId: a.u.id,
      sidHash: a.sidHash,
    });
    if (!r.ok)
      return r.response.status === 409 ? apiError(409, 'BELUM_TERKIRIM', PESAN_BELUM_TERKIRIM) : r.response;
    catatHasilSesi(a, r.data);
    return apiJson(r.data);
  } catch (e) {
    return errorResponse(e);
  }
};
