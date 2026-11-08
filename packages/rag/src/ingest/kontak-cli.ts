import { lookup } from 'node:dns/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { PoliteFetcher, type Deps } from './fetcher.js';
import type { ProbeGet } from './kontak.js';
import { runKontak } from './kontak-run.js';

/**
 * Isi `data/wilayah/kontak-dukcapil.json` dengan situs Disdukcapil yang BISA diverifikasi. Hanya baca (GET),
 * robots.txt dihormati, tidak lebih dari 1 permintaan HTTP per detik secara keseluruhan (cek DNS tidak menyentuh
 * situs). Hasil lama dipertahankan bila sudah ada (--refresh untuk mengulang).
 */
const { values } = parseArgs({
  options: {
    wilayah: { type: 'string', default: '../../data/wilayah/kabkota.json' },
    out: { type: 'string', default: '../../data/wilayah/kontak-dukcapil.json' },
    only: { type: 'string' },
    refresh: { type: 'boolean', default: false },
    limit: { type: 'string' },
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
    const res = await fetch(url, init);
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

await runKontak({
  wilayahPath: resolve(values.wilayah),
  outPath: resolve(values.out),
  only: values.only,
  refresh: values.refresh,
  limit: values.limit ? Number(values.limit) : undefined,
  deps: { resolves, get, now: () => new Date() },
  log: console.log,
});
