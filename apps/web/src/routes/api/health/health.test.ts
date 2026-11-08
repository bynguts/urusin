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
    expect(await res.json()).toEqual({
      ok: true,
      status: 'ok',
      gitSha: 'dev',
      version: '0.0.0',
      rag: { status: 'uninitialized' },
      csp: { violations: {} },
    });
  });

  it('mengembalikan GIT_SHA dari environment', async () => {
    vi.stubEnv('GIT_SHA', 'abcdef1234567890');
    const { GET } = await import('./+server');
    const body = await (await GET({} as never)).json();
    expect(body.gitSha).toBe('abcdef1234567890');
    expect(body.ok).toBe(true);
    expect(body.rag).toEqual({ status: 'uninitialized' });
  });
});
