import pkg from '../../../package.json' with { type: 'json' };

/** Info build untuk footer dan /api/health. Dibaca saat runtime dari env GIT_SHA (diisi CI/deploy). */
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
