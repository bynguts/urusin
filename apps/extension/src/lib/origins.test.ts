import { describe, expect, it } from 'vitest';
import { appOrigins, fixtureOrigins, fromMatchPattern, normalizeOrigin, toMatchPattern } from './origins';

describe('origins', () => {
  it('normalizeOrigin: https bebas, http hanya loopback, tanpa userinfo', () => {
    expect(normalizeOrigin('https://urusin.example.com/')).toBe('https://urusin.example.com');
    expect(normalizeOrigin('http://localhost:3000')).toBe('http://localhost:3000');
    expect(normalizeOrigin('http://urusin.example.com')).toBeNull();
    expect(normalizeOrigin('https://u:p@urusin.example.com')).toBeNull();
    expect(normalizeOrigin('bukan url')).toBeNull();
  });

  it('appOrigins: env publik + localhost:3000, tanpa duplikat, nilai buruk diabaikan', () => {
    expect(appOrigins({})).toEqual(['http://localhost:3000']);
    expect(appOrigins({ URUSIN_PUBLIC_ORIGIN: 'https://urusin.example.com' })).toEqual([
      'https://urusin.example.com',
      'http://localhost:3000',
    ]);
    expect(appOrigins({ URUSIN_PUBLIC_ORIGIN: 'http://evil.example' })).toEqual(['http://localhost:3000']);
  });

  it('fixtureOrigins: default lokal 4320 atau daftar dari env', () => {
    expect(fixtureOrigins({})).toEqual(['http://localhost:4320', 'http://127.0.0.1:4320']);
    expect(
      fixtureOrigins({ URUSIN_FIXTURES_ORIGINS: 'https://fx.example.com, http://localhost:4000' }),
    ).toEqual(['https://fx.example.com', 'http://localhost:4000']);
  });

  it('pola match bolak-balik', () => {
    expect(toMatchPattern('http://localhost:3000')).toBe('http://localhost:3000/*');
    expect(fromMatchPattern('http://localhost:3000/*')).toBe('http://localhost:3000');
    expect(fromMatchPattern('<all_urls>')).toBeNull();
  });
});
