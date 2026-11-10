import type { WilayahResponse } from '@urusin/contracts';
import { SEMUA_WILAYAH, routeByKode } from '@urusin/registry';
import { apiJson } from '#lib/server/http.js';
import { kotaView } from '#lib/server/referensi.js';
import type { RequestHandler } from './$types';

/** Semua 514 kab/kota beserta tier dan status validasinya apa adanya (tanpa portal tercatat: dipandu). */
export const GET: RequestHandler = () =>
  apiJson({
    kota: SEMUA_WILAYAH.map((w) => kotaView(routeByKode(w.kodeKabKota).entry)).sort((a, b) =>
      a.nama.localeCompare(b.nama),
    ),
  } satisfies WilayahResponse);
