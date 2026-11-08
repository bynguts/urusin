/** Statistik panggilan ke penyedia: dipakai eval untuk latensi dan biaya token per kueri. */
export type ProviderStats = { calls: number; tokens: number; latenciesMs: number[]; errors: number };
export const newStats = (): ProviderStats => ({ calls: 0, tokens: 0, latenciesMs: [], errors: 0 });

export type FetchFn = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal | undefined },
) => Promise<{ status: number; json(): Promise<unknown> }>;

export type HttpOpts = {
  baseUrl: string;
  apiKey: string;
  fetch?: FetchFn | undefined;
  timeoutMs?: number | undefined;
  maxRetries?: number | undefined;
  stats?: ProviderStats | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
};

const defaultFetch: FetchFn = (url, init) => fetch(url, init);

/** POST JSON dengan timeout, retry 429/5xx (backoff), dan pencatatan statistik. Kunci tidak pernah dicatat. */
export async function postJson(opts: HttpOpts, path: string, body: unknown): Promise<unknown> {
  const doFetch = opts.fetch ?? defaultFetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const retries = opts.maxRetries ?? 2;
  const url = `${opts.baseUrl.replace(/\/+$/, '')}${path}`;
  let lastStatus = 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const t0 = performance.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000);
    try {
      const res = await doFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      lastStatus = res.status;
      if (res.status === 429 || res.status >= 500) {
        if (attempt < retries) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        break;
      }
      if (res.status < 200 || res.status >= 300) break;
      const json = await res.json();
      if (opts.stats) {
        opts.stats.calls++;
        opts.stats.latenciesMs.push(performance.now() - t0);
      }
      return json;
    } catch (e) {
      lastStatus = 0;
      if (attempt >= retries) {
        if (opts.stats) opts.stats.errors++;
        throw new Error(`panggilan penyedia gagal: ${(e as Error).name}`);
      }
      await sleep(500 * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  if (opts.stats) opts.stats.errors++;
  throw new Error(`panggilan penyedia gagal: HTTP ${lastStatus}`);
}

export function percentile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] as number;
}
