import { json } from '@sveltejs/kit';
import type { KeadaanKapabilitas } from '#lib/contracts.js';
import { runtimeWithin, type Runtime } from '#lib/server/runtime.js';
import type { RequestHandler } from './$types';

/** Batas tunggu runtime; selama dirakit jawab 503 agar klien mempertahankan default "normal". */
const WAIT_MS = 2_000;
const headers = { 'cache-control': 'no-store' };

/** Ringkasan kemampuan untuk UI (CapabilitiesStore). */
export type Kemampuan = {
  /** `llm` = penyedia nyata; `demo` = agen berskrip tanpa kunci LLM. */
  llm: Runtime['mode'] | null;
  kapabilitas: Omit<KeadaanKapabilitas, 'dimuat'>;
  fitur: { pencarianHybrid: boolean; rerank: boolean };
};

/** Mode AI global: kuota harian (70% = hemat, habis = tanpa AI) dan dukungan tool calling dari probe. */
function modeAi(rt: Runtime): KeadaanKapabilitas['ai'] {
  if (!rt.deps.caps.tools) return 'tanpa_ai';
  const { dailyIdrCap, hematAtFraction } = rt.quota.config;
  if (dailyIdrCap <= 0) return 'normal';
  const spent = rt.store.dailyCostIdr();
  if (spent >= dailyIdrCap) return 'tanpa_ai';
  return spent >= dailyIdrCap * hematAtFraction ? 'hemat' : 'normal';
}

/**
 * PUBLIK (dibaca UI lewat Caddy): hanya subset tidak sensitif. Tanpa gitSha, versi, nama model, jumlah chunk,
 * angka biaya, atau turn berjalan; itu milik /api/health yang 404 untuk publik.
 */
export const GET: RequestHandler = async () => {
  const rt = await runtimeWithin(WAIT_MS);
  if (rt === 'memuat')
    return json({ memuat: true }, { status: 503, headers: { ...headers, 'retry-after': '2' } });
  if (rt === 'error') {
    const body: Kemampuan = {
      llm: null,
      kapabilitas: { ai: 'tanpa_ai', vision: false, rag: 'tidak_siap' },
      fitur: { pencarianHybrid: false, rerank: false },
    };
    return json(body, { headers });
  }
  const cari = rt.rag.status === 'ready' ? rt.rag.pencarian : undefined;
  const body: Kemampuan = {
    llm: rt.mode,
    kapabilitas: {
      ai: modeAi(rt),
      vision: rt.deps.caps.vision,
      rag: rt.rag.status === 'ready' ? 'siap' : 'tidak_siap',
    },
    fitur: { pencarianHybrid: cari?.vektor ?? false, rerank: cari?.rerank ?? false },
  };
  return json(body, { headers });
};
