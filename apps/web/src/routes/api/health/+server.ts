import { json } from '@sveltejs/kit';
import { gitSha } from '#lib/server/build-info.js';
import type { RequestHandler } from './$types';

/** Dipakai uptime monitor dan smoke test deploy (assert gitSha == SHA yang di-deploy). */
export const GET: RequestHandler = () =>
  json({ status: 'ok', gitSha: gitSha() }, { headers: { 'cache-control': 'no-store' } });
