import { error } from '@sveltejs/kit';
import { jejakView } from '@urusin/harness';
import { getRuntime } from '#lib/server/runtime.js';
import type { PageServerLoad } from './$types';

const ID_RE = /^u_[0-9a-f]{32}$/;

/**
 * Jejak urusan (App 09): timeline event audit + span. `?head=` = kepala rantai yang dipegang perangkat warga;
 * rantai server yang berujung berbeda ditandai rusak.
 */
export const load: PageServerLoad = async ({ params, url, setHeaders }) => {
  if (!ID_RE.test(params.id)) error(404, 'Urusan tidak ditemukan');
  const rt = await getRuntime();
  const u = rt.store.getUrusan(params.id);
  if (!u) error(404, 'Urusan tidak ditemukan');
  setHeaders({ 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer' });
  const head = url.searchParams.get('head');
  return {
    jenis: u.jenis,
    jejak: jejakView(rt.store, params.id, head && /^[0-9a-f]{64}$/.test(head) ? head : undefined),
    diperiksaPada: new Date().toISOString(),
  };
};
