import { describe, expect, it } from 'vitest';
import { checkUrl, resolveNavPath } from './allowlist';

const AT = '@'; // hindari pola email pada pemindai PII
const FX = ['http://localhost:4320'];
const off = { testMode: false, fixtureOrigins: FX };
const on = { testMode: true, fixtureOrigins: FX };

describe('checkUrl', () => {
  it('domain resmi lolos (exact host, https)', () => {
    expect(checkUrl('https://telunjuksakti.wonogirikab.go.id/telunjuksakti/index.php/', off)).toEqual({
      ok: true,
    });
  });

  it.each([
    'http://telunjuksakti.wonogirikab.go.id/',
    'https://telunjuksakti.wonogirikab.go.id.evil.example/',
    'https://evil.example/telunjuksakti.wonogirikab.go.id',
    `https://user${AT}telunjuksakti.wonogirikab.go.id/`,
    'https://telunjuksakti.wonogirikab.go.id:8443/',
    'https://xn--telunjuksakti-x.wonogirikab.go.id/',
    'javascript:alert(1)',
    'about:blank',
    'file:///C:/x',
  ])('menolak %s', (url) => {
    const r = checkUrl(url, on);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('DOMAIN_NOT_ALLOWED');
  });

  it('origin fixture hanya sah dalam Mode Uji', () => {
    expect(checkUrl('http://localhost:4320/x', on)).toEqual({ ok: true });
    expect(checkUrl('http://localhost:4320/x', off).ok).toBe(false);
  });

  it('Mode Uji tidak membuka origin lain, userinfo, atau karakter kontrol', () => {
    expect(checkUrl('http://localhost:4321/', on).ok).toBe(false);
    expect(checkUrl(`http://localhost:4320${AT}evil.example/`, on).ok).toBe(false);
    expect(checkUrl('http://localhost:4320/\n', on).ok).toBe(false);
    expect(checkUrl('http://evil.localhost:4320/', on).ok).toBe(false);
  });
});

describe('resolveNavPath', () => {
  it('path absolut satu-origin', () => {
    expect(resolveNavPath('http://localhost:4320', '/a/b?x=1')).toBe('http://localhost:4320/a/b?x=1');
  });
  it.each(['a/b', '//evil.example/x', 'https://evil.example/', '/\\evil.example', ''])('menolak %j', (p) => {
    expect(resolveNavPath('http://localhost:4320', p)).toBeNull();
  });
});
