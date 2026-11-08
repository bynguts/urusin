import { matchOfficialUrl } from '@urusin/core';

export type AllowlistConfig = {
  /** Mode Uji (toggle hanya dari popup). Origin fixture hanya sah bila true. */
  testMode: boolean;
  fixtureOrigins: readonly string[];
};

export type AllowResult = { ok: true } | { ok: false; code: string; message: string };

// eslint-disable-next-line no-control-regex -- tolak karakter kontrol yang dibuang diam-diam oleh parser URL
const CONTROL_OR_SPACE = /[\s\u0000-\u001f\u007f]/;

/**
 * Gerbang domain: hanya domain resmi (registry `@urusin/core`: https, exact host) atau,
 * dalam Mode Uji, origin fixture. Dipanggil sebelum SETIAP op.
 */
export function checkUrl(input: string, cfg: AllowlistConfig): AllowResult {
  const official = matchOfficialUrl(input);
  if (official.ok) return { ok: true };

  if (cfg.testMode && !CONTROL_OR_SPACE.test(input)) {
    try {
      const url = new URL(input);
      if (!url.username && !url.password && cfg.fixtureOrigins.includes(url.origin)) return { ok: true };
    } catch {
      // jatuh ke penolakan di bawah
    }
  }
  return {
    ok: false,
    code: 'DOMAIN_NOT_ALLOWED',
    message: `URL ditolak (${official.code}): bukan domain resmi`,
  };
}

/** Resolusi `path` langkah `nav` terhadap origin request. Hanya path absolut satu-origin. */
export function resolveNavPath(origin: string, path: string): string | null {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return null;
  try {
    const base = new URL(origin);
    const url = new URL(path, base);
    return url.origin === base.origin ? url.href : null;
  } catch {
    return null;
  }
}
