import { describe, expect, it } from 'vitest';
import hosts from '../../../../../deploy/hosts.json';
import { assertHostEnv } from './hosts.js';

describe('assertHostEnv', () => {
  it('lolos tanpa env host (dev) dan untuk origin http lokal', () => {
    expect(() => assertHostEnv({})).not.toThrow();
    expect(() => assertHostEnv({ ORIGIN: 'http://localhost:3000' })).not.toThrow();
  });

  it.each(Object.entries(hosts))('lolos untuk set %s utuh', (_name, set) => {
    expect(() =>
      assertHostEnv({
        DOMAIN: set.app,
        VERIFY_HOST: set.verify,
        FIXTURES_HOST: set.fixtures,
        ORIGIN: `https://${set.app}`,
        FIXTURES_PUBLIC_ORIGIN: `https://${set.fixtures}`,
      }),
    ).not.toThrow();
  });

  it('gagal untuk host di luar daftar', () => {
    expect(() => assertHostEnv({ DOMAIN: 'evil.sslip.io' })).toThrow(/DOMAIN=evil\.sslip\.io/);
    expect(() => assertHostEnv({ DOMAIN: `${hosts.fallback.app}.evil.com` })).toThrow();
    expect(() => assertHostEnv({ ORIGIN: 'https://evil.example' })).toThrow(/ORIGIN/);
    expect(() => assertHostEnv({ VERIFY_HOST: hosts.primary.app })).toThrow(/VERIFY_HOST/);
  });

  it('gagal bila host berasal dari set yang berbeda', () => {
    expect(() => assertHostEnv({ DOMAIN: hosts.primary.app, VERIFY_HOST: hosts.fallback.verify })).toThrow(
      /satu set/,
    );
    expect(() =>
      assertHostEnv({ ORIGIN: `https://${hosts.primary.app}`, FIXTURES_HOST: hosts.fallback.fixtures }),
    ).toThrow(/satu set/);
  });
});
