import { afterEach, describe, expect, it, vi } from 'vitest';

describe('GET /api/health', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('mengembalikan status ok dan gitSha "dev" bila GIT_SHA kosong', async () => {
    vi.stubEnv('GIT_SHA', '');
    const { GET } = await import('./+server');
    const res = await GET({} as never);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ status: 'ok', gitSha: 'dev' });
  });

  it('mengembalikan GIT_SHA dari environment', async () => {
    vi.stubEnv('GIT_SHA', 'abcdef1234567890');
    const { GET } = await import('./+server');
    expect(await (await GET({} as never)).json()).toEqual({ status: 'ok', gitSha: 'abcdef1234567890' });
  });
});
