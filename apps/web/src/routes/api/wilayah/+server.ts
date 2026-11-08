import type { WilayahResponse } from '@urusin/contracts';
import { SEED_ENTRIES } from '@urusin/registry';
import { apiJson } from '#lib/server/http.js';
import { kotaView } from '#lib/server/referensi.js';
import type { RequestHandler } from './$types';

/** Daftar kab/kota yang dikenal registry beserta tier dan status validasinya apa adanya. */
export const GET: RequestHandler = () =>
  apiJson({
    kota: SEED_ENTRIES.map(kotaView).sort((a, b) => a.nama.localeCompare(b.nama)),
  } satisfies WilayahResponse);
