import { json } from '@sveltejs/kit';
import { appVersion, gitSha } from '#lib/server/build-info.js';
import type { RequestHandler } from './$types';

/** Dipakai uptime monitor dan smoke test deploy (assert gitSha == SHA yang di-deploy). */
export const GET: RequestHandler = () =>
  json(
    {
      ok: true,
      // `status` dipertahankan untuk konsumen lama (bundle-budget, monitor).
      status: 'ok',
      gitSha: gitSha(),
      version: appVersion(),
      // Diisi modul RAG (M20) kelak; sampai ada, tidak diinisialisasi.
      rag: { status: 'uninitialized' },
    },
    { headers: { 'cache-control': 'no-store' } },
  );
