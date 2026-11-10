import { IzinkanIsiRequestSchema } from '@urusin/contracts';
import { akunErrorResponse, readAkunBody } from '#lib/server/akun.js';
import { apiError, apiJson } from '#lib/server/http.js';
import { hashSid, pendampingConfig } from '#lib/server/pendamping.js';
import { izinkanIsiUrusan } from '#lib/server/pendamping/isi.js';
import { isiSesiDariVault } from '#lib/server/pendamping/izinkan.js';
import { getRuntime } from '#lib/server/runtime.js';
import { urusanMilik } from '#lib/server/urusan-akses.js';
import type { RequestHandler } from './$types';

/**
 * "Izinkan isi" (A-M1): peramban hanya mengirim `{writeList, targetOrigin, rencanaHash?}` (dari `butuh_data` sesi;
 * `rencanaHash` untuk lembar per halaman Navigator generik).
 * Server memeriksa pemilik urusan, menerbitkan token persetujuan (hanya portal registry `kirim-asli` atau situs
 * latihan), lalu bila Browser Pendamping terpasang langsung mengisi sesi: controller mengambil nilai lewat
 * `ambilIsianUntukIsi` dengan origin sesi yang hidup dan mengirimnya ke worker lewat kanal internal.
 * Respons tidak memuat nilai vault. Bukan pemilik → 404 (tidak membocorkan keberadaan urusan).
 */
export const POST: RequestHandler = async ({ request, params, locals }) => {
  const body = await readAkunBody(request, IzinkanIsiRequestSchema);
  if (!body.ok) return body.response;
  try {
    const rt = await getRuntime();
    const peminta = { akun: locals.akun, sid: locals.sid };
    if (!urusanMilik(rt, params.id, peminta)) return apiError(404, 'NOT_FOUND', 'Urusan tidak ditemukan.');
    const { kurang } = izinkanIsiUrusan(rt, {
      urusanId: params.id,
      peminta,
      writeList: body.data.writeList,
      targetOrigin: body.data.targetOrigin,
      rencanaHash: body.data.rencanaHash,
    });
    // Navigator generik: jejak persetujuan {rencanaHash, n} dicatat worker saat nilai diterima (tanpa nilai).
    const cfg = pendampingConfig();
    // Tanpa Browser Pendamping: persetujuan tetap tersimpan (sekali pakai, 5 menit) untuk diambil nanti.
    if (!cfg || !locals.sid) return apiJson({ diizinkan: true, kurang });
    const isi = await isiSesiDariVault(rt, cfg, { urusanId: params.id, sidHash: hashSid(locals.sid) });
    if (!isi.ok) return isi.response;
    return apiJson({ diizinkan: true, kurang: isi.kurang });
  } catch (e) {
    return akunErrorResponse(e);
  }
};
