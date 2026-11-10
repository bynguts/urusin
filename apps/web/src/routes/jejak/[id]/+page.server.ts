import { error } from '@sveltejs/kit';
import { jejakView } from '@urusin/harness';
import { getRuntime } from '#lib/server/runtime.js';
import { SID_COOKIE } from '#lib/server/sesi.js';
import { urusanMilik } from '#lib/server/urusan-akses.js';
import type { PageServerLoad } from './$types';

const ID_RE = /^u_[0-9a-f]{32}$/;

/**
 * Jejak urusan (App 09): timeline event audit + span. `?head=` = kepala rantai yang dipegang perangkat warga;
 * rantai server yang berujung berbeda ditandai rusak. Hanya pemilik urusan; selain itu 404.
 */
export const load: PageServerLoad = async ({ params, url, setHeaders, cookies, locals }) => {
  if (!ID_RE.test(params.id)) error(404, 'Urusan tidak ditemukan');
  const rt = await getRuntime();
  const u = urusanMilik(rt, params.id, { akun: locals.akun, sid: cookies.get(SID_COOKIE) });
  if (!u) error(404, 'Urusan tidak ditemukan');
  setHeaders({ 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer' });
  const head = url.searchParams.get('head');
  return {
    jenis: u.jenis,
    jejak: jejakView(rt.store, params.id, head && /^[0-9a-f]{64}$/.test(head) ? head : undefined),
    diperiksaPada: new Date().toISOString(),
  };
};
