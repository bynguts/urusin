import { describe, expect, it } from 'vitest';
import hosts from '../../../../deploy/hosts.json';
import { appOrigins, fixtureOrigins, fromMatchPattern, normalizeOrigin, toMatchPattern } from './origins';

const PRIMARY_FALLBACK_APPS = [`https://${hosts.primary.app}`, `https://${hosts.fallback.app}`];
const HOST_FIXTURES = [`https://${hosts.primary.fixtures}`, `https://${hosts.fallback.fixtures}`];

describe('origins', () => {
  it('normalizeOrigin: https bebas, http hanya loopback, tanpa userinfo', () => {
    expect(normalizeOrigin('https://urusin.example.com/')).toBe('https://urusin.example.com');
    expect(normalizeOrigin('http://localhost:3000')).toBe('http://localhost:3000');
    expect(normalizeOrigin('http://urusin.example.com')).toBeNull();
    expect(normalizeOrigin('https://u:p@urusin.example.com')).toBeNull();
    expect(normalizeOrigin('bukan url')).toBeNull();
  });

  it('appOrigins: env publik + localhost:3000, tanpa duplikat, nilai buruk diabaikan', () => {
    expect(appOrigins({})).toEqual([...PRIMARY_FALLBACK_APPS, 'http://localhost:3000']);
    expect(appOrigins({ URUSIN_PUBLIC_ORIGIN: 'https://urusin.example.com' })).toEqual([
      'https://urusin.example.com',
      ...PRIMARY_FALLBACK_APPS,
      'http://localhost:3000',
    ]);
    expect(appOrigins({ URUSIN_PUBLIC_ORIGIN: 'http://evil.example' })).toEqual([
      ...PRIMARY_FALLBACK_APPS,
      'http://localhost:3000',
    ]);
  });

  it('fixtureOrigins: default lokal 4320 atau daftar dari env', () => {
    expect(fixtureOrigins({})).toEqual(['http://localhost:4320', 'http://127.0.0.1:4320', ...HOST_FIXTURES]);
    expect(
      fixtureOrigins({ URUSIN_FIXTURES_ORIGINS: 'https://fx.example.com, http://localhost:4000' }),
    ).toEqual(['https://fx.example.com', 'http://localhost:4000', ...HOST_FIXTURES]);
  });

  it('pola match bolak-balik', () => {
    expect(toMatchPattern('http://localhost:3000')).toBe('http://localhost:3000/*');
    expect(fromMatchPattern('http://localhost:3000/*')).toBe('http://localhost:3000');
    expect(fromMatchPattern('<all_urls>')).toBeNull();
  });

  it('host produksi persis dari hosts.json: tanpa wildcard dan tanpa host lain', () => {
    expect(hosts).toEqual({
      primary: {
        app: 'urusinai.web.id',
        verify: 'verify.urusinai.web.id',
        fixtures: 'fixtures.urusinai.web.id',
      },
      fallback: {
        app: '158-178-239-106.sslip.io',
        verify: 'verify.158-178-239-106.sslip.io',
        fixtures: 'fixtures.158-178-239-106.sslip.io',
      },
    });
    for (const o of [...appOrigins({}), ...fixtureOrigins({})]) expect(o).not.toContain('*');
    expect(appOrigins({}).filter((o) => o.startsWith('https://'))).toEqual(PRIMARY_FALLBACK_APPS);
  });
});
