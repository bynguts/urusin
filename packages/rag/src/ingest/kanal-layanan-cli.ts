import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ingestEgressFetch, installEgressBackstop } from '@urusin/egress';
import { PoliteFetcher, type Deps } from './fetcher.js';
import { runKanalLayanan } from './kanal-layanan-run.js';
import type { ProbeGet } from './kontak.js';

// Backstop (M2): fetch global apa pun di proses CLI ini lewat konektor egress profil ingest (.go.id saja).
installEgressBackstop('ingest');

/**
 * Isi `data/wilayah/kanal-layanan.json`: kontak layanan resmi (telepon, WhatsApp, email, jam layanan) dari situs
 * Disdukcapil terverifikasi dan halaman di `sumber-kanal.json`. Hanya baca (GET), robots.txt dihormati, paling
 * banyak 1 permintaan HTTP per detik secara keseluruhan.
 */
const { values } = parseArgs({
  options: {
    kontak: { type: 'string', default: '../../data/wilayah/kontak-dukcapil.json' },
    sumber: { type: 'string', default: '../../data/wilayah/sumber-kanal.json' },
    out: { type: 'string', default: '../../data/wilayah/kanal-layanan.json' },
    only: { type: 'string' },
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

await runKanalLayanan({
  kontakPath: resolve(values.kontak),
  sumberPath: resolve(values.sumber),
  outPath: resolve(values.out),
  only: values.only,
  deps: { get, now: () => new Date() },
  log: console.log,
});
