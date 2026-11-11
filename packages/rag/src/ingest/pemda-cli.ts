import { lookup } from 'node:dns/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ingestEgressFetch, installEgressBackstop } from '@urusin/egress';
import { PoliteFetcher, type Deps } from './fetcher.js';
import type { ProbeGet } from './kontak.js';
import { runPemda } from './pemda-run.js';

// Backstop (M2): fetch global apa pun di proses CLI ini lewat konektor egress profil ingest.
installEgressBackstop('ingest');

/**
 * Isi `data/wilayah/pemda.json`: situs resmi pemerintah daerah (.go.id) sebagai kanal cadangan untuk kab/kota yang
 * situs Disdukcapil-nya belum terverifikasi, dan situs Dinas Dukcapil/portal tiap provinsi. Hanya baca (GET),
 * robots.txt dihormati, paling banyak 1 permintaan HTTP per detik (cek DNS tidak menyentuh situs).
 */
const { values } = parseArgs({
  options: {
    wilayah: { type: 'string', default: '../../data/wilayah/kabkota.json' },
    kontak: { type: 'string', default: '../../data/wilayah/kontak-dukcapil.json' },
    out: { type: 'string', default: '../../data/wilayah/pemda.json' },
    only: { type: 'string' },
    refresh: { type: 'boolean', default: false },
    belum: { type: 'boolean', default: false },
  },
});

let lastReq = 0;
const finalUrls = new Map<string, string>();
const deps: Deps = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  fetch: async (url, init) => {
    const wait = lastReq + 1000 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastReq = Date.now();
    const res = await ingestEgressFetch(url, init);
    finalUrls.set(url, res.url || url);
    return res;
  },
};
const fetcher = new PoliteFetcher(deps, 1000);
const get: ProbeGet = async (url) => ({ ...(await fetcher.get(url)), finalUrl: finalUrls.get(url) ?? url });
const resolves = (host: string) =>
  lookup(host).then(
    () => true,
    () => false,
  );

await runPemda({
  wilayahPath: resolve(values.wilayah),
  kontakPath: resolve(values.kontak),
  outPath: resolve(values.out),
  only: values.only,
  refresh: values.refresh,
  belum: values.belum,
  deps: { resolves, get, now: () => new Date() },
  log: console.log,
});
