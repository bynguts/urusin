import { Robots } from './robots.js';

/** User-Agent jujur; sengaja tanpa email pribadi. */
export const USER_AGENT = 'UrusinBot/0.1 (+hackathon; contact via repo)';
export const USER_AGENT_TOKEN = 'urusinbot';
export const MIN_INTERVAL_MS = 2000;
/** Batas waktu satu permintaan HTML/JSON. */
export const FETCH_TIMEOUT_MS = 20_000;
/**
 * Batas waktu PDF regulasi: peraturan.go.id menyajikan PDF berukuran MB dengan lambat (diukur 2026-11-10:
 * Permendagri 109/2019 5,6 MB = 56 dtk; Perpol 1/2026 4,4 MB = 33 dtk), jadi 20 dtk selalu gagal untuk keduanya.
 */
export const PDF_TIMEOUT_MS = 180_000;

/** Batas waktu menurut jenis sumber (lihat PDF_TIMEOUT_MS). */
export const batasWaktu = (s: { jenis?: string | undefined }) =>
  s.jenis === 'pdf' ? PDF_TIMEOUT_MS : FETCH_TIMEOUT_MS;

export type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; redirect: 'follow'; signal?: AbortSignal },
) => Promise<{ status: number; headers: { get(name: string): string | null }; text(): Promise<string> }>;

export type Deps = {
  fetch: FetchLike;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

export type FetchResult = {
  status: number;
  body: string;
  contentType: string;
  etag: string | null;
  lastModified: string | null;
};

export class RobotsBlockedError extends Error {
  constructor() {
    super('Diblokir robots.txt; tidak diambil.');
    this.name = 'RobotsBlockedError';
  }
}

/** Satu permintaan per host per >= 2 detik, robots.txt dicek (dan di-cache) sebelum setiap fetch. */
export class PoliteFetcher {
  private readonly lastAt = new Map<string, number>();
  private readonly robots = new Map<string, Promise<Robots>>();

  constructor(
    private readonly deps: Deps,
    private readonly minIntervalMs = MIN_INTERVAL_MS,
  ) {}

  private async throttle(host: string): Promise<void> {
    const last = this.lastAt.get(host);
    if (last !== undefined) {
      const wait = last + this.minIntervalMs - this.deps.now();
      if (wait > 0) await this.deps.sleep(wait);
    }
    this.lastAt.set(host, this.deps.now());
  }

  private async rawGet(
    url: string,
    extra: Record<string, string> = {},
    timeoutMs = FETCH_TIMEOUT_MS,
  ): Promise<FetchResult> {
    await this.throttle(new URL(url).host);
    const res = await this.deps.fetch(url, {
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,text/plain;q=0.8',
        ...extra,
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return {
      status: res.status,
      body: await res.text(),
      contentType: res.headers.get('content-type') ?? '',
      etag: res.headers.get('etag'),
      lastModified: res.headers.get('last-modified'),
    };
  }

  private robotsFor(origin: string): Promise<Robots> {
    let p = this.robots.get(origin);
    if (!p) {
      p = this.rawGet(`${origin}/robots.txt`).then(
        (r) => new Robots(r.status === 200 ? r.body : '', USER_AGENT_TOKEN),
        () => new Robots('', USER_AGENT_TOKEN),
      );
      this.robots.set(origin, p);
    }
    return p;
  }

  /**
   * `headers` = header kondisional opsional (If-None-Match / If-Modified-Since). Habis waktu diulang sekali
   * (tetap lewat jeda sopan): server regulasi kadang lambat sesaat.
   */
  async get(
    url: string,
    headers?: Record<string, string>,
    timeoutMs = FETCH_TIMEOUT_MS,
  ): Promise<FetchResult> {
    const u = new URL(url);
    const robots = await this.robotsFor(u.origin);
    if (!robots.isAllowed(u.pathname + u.search)) throw new RobotsBlockedError();
    try {
      return await this.rawGet(url, headers, timeoutMs);
    } catch (e) {
      if (!(e instanceof Error) || e.name !== 'TimeoutError') throw e;
      return this.rawGet(url, headers, timeoutMs);
    }
  }
}
