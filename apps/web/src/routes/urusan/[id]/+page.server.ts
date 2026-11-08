import { error } from '@sveltejs/kit';
import { getRuntime, publicOrigin } from '#lib/server/runtime.js';
import { catatTerakhir } from '#lib/server/sesi.js';
import type { PageServerLoad } from './$types';

const ID_RE = /^u_[0-9a-f]{32}$/;

/** Ringkasan awal urusan (jenis, wilayah, state) supaya header dan panel tampil sebelum stream tersambung. */
export const load: PageServerLoad = async ({ params, setHeaders, cookies }) => {
  if (!ID_RE.test(params.id)) error(404, 'Urusan tidak ditemukan');
  const rt = await getRuntime();
  const u = rt.store.getUrusan(params.id);
  if (!u) error(404, 'Urusan tidak ditemukan');
  // Id urusan adalah token kapabilitas: halaman tidak boleh disimpan cache bersama.
  setHeaders({ 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer' });
  catatTerakhir(cookies, u.id, publicOrigin());
  return {
    urusan: { id: u.id, jenis: u.jenis, kodeKabKota: u.kodeKabKota, state: u.state, dibuatPada: u.createdAt },
  };
};
