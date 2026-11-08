import { fileURLToPath } from 'node:url';
import { KANAL_PATH } from '../kanal.js';
import { PoliteFetcher, type Deps } from './fetcher.js';
import { runKanal } from './kanal-verify.js';
import type { ProbeGet } from './kontak.js';

/**
 * Verifikasi tautan kanal resmi di data/kanal-resmi.json dengan GET sungguhan (robots.txt dihormati, >= 2 detik per
 * host): status 200, HTML, domain akhir tetap resmi setelah redirect, dan halaman memuat kata kunci `cek`.
 * Lolos -> verifiedAt = sekarang; gagal -> verifiedAt null (tautan tidak ditampilkan sebagai fakta).
 */
const finalUrls = new Map<string, string>();
const deps: Deps = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  fetch: async (url, init) => {
    const res = await fetch(url, init);
    finalUrls.set(url, res.url || url);
    return res;
  },
};
const fetcher = new PoliteFetcher(deps);
const get: ProbeGet = async (url) => ({ ...(await fetcher.get(url)), finalUrl: finalUrls.get(url) ?? url });

await runKanal({ path: fileURLToPath(KANAL_PATH), get, now: () => new Date(), log: console.log });
