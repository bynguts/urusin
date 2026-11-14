import { TurnRequestSchema, type TurnResponse } from '@urusin/contracts';
import { kodeUntukPii } from '@urusin/harness';
import { pastikanTamuUntukTurn, pemilikVault } from '#lib/server/akun.js';
import { apiError, apiJson, errorResponse, readBody } from '#lib/server/http.js';
import { segarkanJaringanId } from '#lib/server/pendamping.js';
import { getRuntime, startTurnInBackground } from '#lib/server/runtime.js';
import { batasi } from '#lib/server/sesi.js';
import { urusanMilik } from '#lib/server/urusan-akses.js';
import { templatDariBrankas } from '#lib/server/vault/berkas.js';
import type { RequestHandler } from './$types';

/** Kirim pesan warga. 202: turn berjalan di latar belakang, hasil mengalir di /stream. 409: turn berjalan / version basi. */
export const POST: RequestHandler = async (event) => {
  const { request, params } = event;
  let rt;
  try {
    rt = await getRuntime();
  } catch (e) {
    return errorResponse(e);
  }
  const ditolak = batasi(rt, event, 'turn');
  if (ditolak) return ditolak;
  // Bukan pemilik = sama dengan tidak ada (404), sebelum tamu dibuat atau body dibaca.
  const u = urusanMilik(rt, params.id, event.locals);
  if (!u) return apiError(404, 'NOT_FOUND', 'Urusan tidak ditemukan.');
  const tamu = pastikanTamuUntukTurn(rt, event);
  if (tamu) return tamu;
  // NIK terpecah dideteksi memakai wilayah KTP urusan, atau usulannya selama belum ditetapkan.
  // `gambar` (data URL tervalidasi skema) dan `dokumen` (id brankas) tidak dipindai sebagai teks: bukan tulisan warga.
  const body = await readBody(request, TurnRequestSchema, {
    kodeKabKota: kodeUntukPii(rt.store, u),
    lewatiBidang: ['gambar', 'dokumen'],
  });
  if (!body.ok) return body.response;
  try {
    // Rute Browser Pendamping di prompt/tool turn ini menimbang worker berjaringan Indonesia yang sehat.
    await segarkanJaringanId();
    // Pemilik brankas peminta (sama dengan /api/vault): tujuan simpan berkas buatan agen dan sumber templat.
    const pemilik = pemilikVault(rt, event, { buat: false })?.id;
    const templat =
      pemilik && body.data.dokumen?.length ? await templatDariBrankas(rt, pemilik, body.data.dokumen) : [];
    const { turnId } = startTurnInBackground(rt, {
      urusanId: params.id,
      userText: body.data.teks,
      ...(body.data.expectedVersion !== undefined ? { expectedVersion: body.data.expectedVersion } : {}),
      ...(body.data.gambar?.length ? { gambar: body.data.gambar } : {}),
      ...(templat.length ? { templat } : {}),
      ...(pemilik ? { pemilikBerkas: pemilik } : {}),
    });
    return apiJson({ turnId, diterima: true } satisfies TurnResponse, 202);
  } catch (e) {
    return errorResponse(e);
  }
};
