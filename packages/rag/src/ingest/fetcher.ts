import { Robots } from './robots.js';

/** User-Agent jujur; sengaja tanpa email pribadi. */
export const USER_AGENT = 'UrusinBot/0.1 (+hackathon; contact via repo)';
export const USER_AGENT_TOKEN = 'urusinbot';
export const MIN_INTERVAL_MS = 2000;

export type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; redirect: 'follow'; signal?: AbortSignal },
) => Promise<{ status: number; headers: { get(name: string): string | null }; text(): Promise<string> }>;

export type Deps = {
  fetch: FetchLike;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
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

  private async rawGet(url: string): Promise<{ status: number; body: string; contentType: string }> {
    await this.throttle(new URL(url).host);
    const res = await this.deps.fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,text/plain;q=0.8' },
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    });
    return { status: res.status, body: await res.text(), contentType: res.headers.get('content-type') ?? '' };
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

  async get(url: string): Promise<{ status: number; body: string; contentType: string }> {
    const u = new URL(url);
    const robots = await this.robotsFor(u.origin);
    if (!robots.isAllowed(u.pathname + u.search)) throw new RobotsBlockedError();
    return this.rawGet(url);
  }
}
