import { DemoProvider, EXA_SEARCH_URL } from '@urusin/harness';
import { afterEach, describe, expect, it } from 'vitest';
import { cariWebDariEnv } from './cari-web';
import { createRuntime, type Runtime } from './runtime';

let rt: Runtime | undefined;
afterEach(() => {
  rt = undefined;
});

const config = { dbPath: ':memory:', heartbeatMs: 15_000, disconnectGraceMs: 0 };

describe('cari web (Exa) dari env', () => {
  it('tanpa kunci atau placeholder: mati', () => {
    expect(cariWebDariEnv({})).toBeUndefined();
    expect(cariWebDariEnv({ EXA_API_KEY: '  ' })).toBeUndefined();
    expect(cariWebDariEnv({ EXA_API_KEY: 'ganti-dengan-kunci-exa' })).toBeUndefined();
  });

  it('dengan kunci: memanggil api.exa.ai lewat fetch egress yang disuntikkan', async () => {
    const urls: string[] = [];
    const cari = cariWebDariEnv({ EXA_API_KEY: 'kunci-uji' }, async (url) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    });
    expect(await cari!({ query: 'syarat akta' }, new AbortController().signal)).toEqual([]);
    expect(urls).toEqual([EXA_SEARCH_URL]);
  });

  it('runtime: web__cari terdaftar hanya bila EXA_API_KEY terisi', () => {
    rt = createRuntime({ provider: new DemoProvider(), config, env: {} });
    expect(rt.registry.get('web__cari')).toBeUndefined();
    rt = createRuntime({ provider: new DemoProvider(), config, env: { EXA_API_KEY: 'kunci-uji' } });
    expect(rt.registry.get('web__cari')?.name).toBe('web__cari');
    expect(rt.deps.cariWeb).toBeDefined();
  });
});
