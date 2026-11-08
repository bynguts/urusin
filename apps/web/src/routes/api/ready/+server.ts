import { readFileSync } from 'node:fs';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Kesiapan blue/green (terpisah dari /api/health yang hanya liveness). Caddy memakai ini sebagai
 * `health_uri`: 200 hanya bila warna ini yang dipromosikan, yaitu berkas penanda
 * (`ACTIVE_COLOR_FILE`, default /data/.active-color di volume bersama) berisi nilai URUSIN_COLOR.
 * deploy.sh menulis berkas itu setelah smoke test ke port langsung warna idle lulus.
 * Tanpa URUSIN_COLOR (dev/lokal) selalu siap.
 */
export const GET: RequestHandler = () => {
  const color = process.env.URUSIN_COLOR;
  const headers = { 'cache-control': 'no-store' };
  if (!color) return json({ ready: true, color: null }, { headers });
  let promoted = '';
  try {
    promoted = readFileSync(process.env.ACTIVE_COLOR_FILE || '/data/.active-color', 'utf8').trim();
  } catch {
    // Belum ada penanda: belum dipromosikan.
  }
  const ready = promoted === color;
  return json({ ready, color }, { status: ready ? 200 : 503, headers });
};
