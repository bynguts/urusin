import { error } from '@sveltejs/kit';
import { getRuntime, publicOrigin } from '#lib/server/runtime.js';
import { PESAN_AWAL_COOKIE } from '#lib/server/mulai-urusan.js';
import { catatTerakhir, SID_COOKIE } from '#lib/server/sesi.js';
import { urusanMilik } from '#lib/server/urusan-akses.js';
import type { PageServerLoad } from './$types';

const ID_RE = /^u_[0-9a-f]{32}$/;

/**
 * Ringkasan awal urusan (jenis, wilayah, state) supaya header dan panel tampil sebelum stream tersambung. Hanya
 * pemilik (akun yang masuk, atau cookie sesi; hooks mengisi `locals.sid` hanya untuk /api/) → selain itu 404.
 */
export const load: PageServerLoad = async ({ params, setHeaders, cookies, locals }) => {
  if (!ID_RE.test(params.id)) error(404, 'Urusan tidak ditemukan');
  const rt = await getRuntime();
  const u = urusanMilik(rt, params.id, { akun: locals.akun, sid: cookies.get(SID_COOKIE) });
  if (!u) error(404, 'Urusan tidak ditemukan');
  // Halaman urusan bersifat pribadi: tidak boleh disimpan cache bersama.
  setHeaders({ 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer' });
  catatTerakhir(cookies, u.id, publicOrigin());
  const pesanAwal = cookies.get(PESAN_AWAL_COOKIE) ?? null;
  if (pesanAwal !== null) cookies.delete(PESAN_AWAL_COOKIE, { path: `/urusan/${u.id}` });
  return {
    pesanAwal,
    urusan: {
      id: u.id,
      jenis: u.jenis,
      kodeKabKota: u.kodeKabKota,
      state: u.state,
      dibuatPada: u.createdAt,
      nomorPermohonan: u.nomorPermohonan,
    },
  };
};
