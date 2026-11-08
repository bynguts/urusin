/** Parsing origin dari env saat build (manifest) dan pola origin saat runtime. */

const LOOPBACK = new Set(['localhost', '127.0.0.1']);
const DEFAULT_APP_ORIGINS = ['http://localhost:3000'];
const DEFAULT_FIXTURE_ORIGINS = ['http://localhost:4320', 'http://127.0.0.1:4320'];

/** Origin valid: https bebas, http hanya loopback. Tanpa userinfo. Mengembalikan null bila tidak valid. */
export function normalizeOrigin(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  const ok = url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname));
  return ok ? url.origin : null;
}

function parseList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map(normalizeOrigin)
    .filter((o): o is string => o !== null);
}

const unique = (xs: string[]) => [...new Set(xs)];

/** Origin web app yang boleh `externally_connectable`: URUSIN_PUBLIC_ORIGIN + localhost:3000. */
export function appOrigins(env: Record<string, string | undefined>): string[] {
  return unique([...parseList(env.URUSIN_PUBLIC_ORIGIN), ...DEFAULT_APP_ORIGINS]);
}

/** Origin fixture: URUSIN_FIXTURES_ORIGINS (dipisah koma) atau default lokal port 4320. */
export function fixtureOrigins(env: Record<string, string | undefined>): string[] {
  const list = parseList(env.URUSIN_FIXTURES_ORIGINS);
  return list.length > 0 ? unique(list) : DEFAULT_FIXTURE_ORIGINS;
}

export function toMatchPattern(origin: string): string {
  return `${origin}/*`;
}

export function fromMatchPattern(pattern: string): string | null {
  return pattern.endsWith('/*') ? normalizeOrigin(pattern.slice(0, -2)) : null;
}
