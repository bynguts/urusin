import pkg from '../../../package.json' with { type: 'json' };

/** Repo publik; tautan commit di stempel versi menunjuk ke sini. */
const REPO_URL = 'https://github.com/bynguts/urusin';

/**
 * Info build untuk stempel versi dan /api/health. GIT_SHA dibakar ke image saat `docker build` (build-arg dari
 * CI, bawaan 'dev'; lihat apps/web/Dockerfile dan release.yml) dan dibaca saat runtime.
 */
export function gitSha(): string {
  return process.env.GIT_SHA || 'dev';
}

export function shortSha(): string {
  const sha = gitSha();
  return sha === 'dev' ? 'dev' : sha.slice(0, 7);
}

export function appVersion(): string {
  return pkg.version;
}

/**
 * Stempel versi publik (M11): `v<sha7>` + tautan commit GitHub. Aman dibuka karena repo publik; tautan hanya
 * dibuat dari SHA 40 heksadesimal sehingga nilai env lain tidak pernah masuk ke href.
 */
export function versiPublik(): { sha7: string; commit: string | null } {
  const sha = gitSha();
  return { sha7: shortSha(), commit: /^[0-9a-f]{40}$/.test(sha) ? `${REPO_URL}/commit/${sha}` : null };
}
