import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ErrorCode,
  OFFICIAL_DOMAINS,
  filePlaceholder,
  findPlaceholders,
  isOfficialUrl,
  isPlaceholder,
  matchOfficialOrigin,
  matchOfficialUrl,
  noPlaceholder,
  parsePlaceholder,
  placeholder,
} from './index.js';

const guarded = z.string().superRefine(noPlaceholder());
const accepts = (s: string) => guarded.safeParse(s).success;

// Alfabet tanpa digit, '@', '{', '}' agar detektor PII (NIK/HP/email) tidak ikut menolak.
const safeText = fc.stringMatching(/^[a-zA-Z .,:;!?_/()-]*$/, { maxLength: 80 });
const NAME = fc.stringMatching(/^[A-Z][A-Z0-9_]{0,11}$/);
const IDENT = fc.stringMatching(/^[A-Za-z][A-Za-z0-9_]{0,11}$/);

describe('property: noPlaceholder', () => {
  it('menolak string apa pun yang memuat "{{" atau "}}"', () => {
    fc.assert(
      fc.property(safeText, fc.constantFrom('{{', '}}'), safeText, (a, brace, b) => {
        expect(accepts(a + brace + b)).toBe(false);
      }),
    );
  });

  it('menerima string tanpa kurung kurawal dan tanpa pola PII', () => {
    fc.assert(
      fc.property(safeText, (s) => {
        expect(accepts(s)).toBe(true);
      }),
    );
  });

  it('menolak placeholder valid yang diselipkan di dalam teks', () => {
    fc.assert(
      fc.property(safeText, NAME, NAME, safeText, (a, ns, key, b) => {
        expect(accepts(`${a}{{${ns}.${key}}}${b}`)).toBe(false);
      }),
    );
  });
});

describe('property: placeholder round-trip', () => {
  it('placeholder() lalu parsePlaceholder() mengembalikan namespace dan path yang sama', () => {
    fc.assert(
      fc.property(NAME, fc.array(NAME, { minLength: 1, maxLength: 4 }), (ns, path) => {
        const token = placeholder(ns, ...path);
        expect(isPlaceholder(token)).toBe(true);
        expect(parsePlaceholder(token)).toEqual({ kind: 'vault', namespace: ns, path, raw: token });
      }),
    );
  });

  it('filePlaceholder() lalu parsePlaceholder() mengembalikan nama berkas yang sama', () => {
    fc.assert(
      fc.property(IDENT, (name) => {
        const token = filePlaceholder(name);
        expect(parsePlaceholder(token)).toEqual({ kind: 'file', name, raw: token });
      }),
    );
  });

  it('findPlaceholders menemukan tepat semua placeholder yang disisipkan, berurutan', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(NAME, NAME), { minLength: 1, maxLength: 5 }), safeText, (pairs, sep) => {
        const tokens = pairs.map(([a, b]) => placeholder(a, b));
        const found = findPlaceholders(tokens.join(sep + ' '));
        expect(found.map((p) => p.raw)).toEqual(tokens);
      }),
    );
  });

  it('parsePlaceholder tidak pernah melempar dan hanya menerima token yang isPlaceholder', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (s) => {
        expect(parsePlaceholder(s) !== null).toBe(isPlaceholder(s));
      }),
    );
  });
});

describe('property: pencocok allowlist domain', () => {
  const hosts = OFFICIAL_DOMAINS.map((d) => d.host);
  const host = fc.constantFrom(...hosts);
  const label = fc.stringMatching(/^[a-z][a-z0-9]{0,10}$/);

  it('host resmi dengan https diterima (kontrol positif)', () => {
    fc.assert(
      fc.property(host, (h) => {
        expect(isOfficialUrl(`https://${h}/path?q=1`)).toBe(true);
      }),
    );
  });

  it('subdomain tambahan di depan host resmi ditolak', () => {
    fc.assert(
      fc.property(label, host, (l, h) => {
        expect(isOfficialUrl(`https://${l}.${h}/`)).toBe(false);
      }),
    );
  });

  it('trik sufiks (host resmi sebagai subdomain domain lain, atau awalan menempel) ditolak', () => {
    fc.assert(
      fc.property(host, label, fc.constantFrom('com', 'net', 'id', 'xyz', 'go.id.evil.com'), (h, l, tld) => {
        expect(isOfficialUrl(`https://${h}.${l}.${tld}/`)).toBe(false);
        expect(isOfficialUrl(`https://${l}${h}/`)).toBe(false);
      }),
    );
  });

  it('userinfo "@" yang menyamarkan host ditolak, host resmi di kiri maupun kanan', () => {
    fc.assert(
      fc.property(host, label, (h, l) => {
        expect(isOfficialUrl(`https://${h}@${l}.example.com/`)).toBe(false);
        expect(isOfficialUrl(`https://${h}:pass@${h}/`)).toBe(false);
        expect(isOfficialUrl(`https://${l}@${h}/`)).toBe(false);
        expect(isOfficialUrl(`https://${h}%40${l}.example.com/`)).toBe(false);
        expect(isOfficialUrl(`https://${h}\\@${l}.example.com/`)).toBe(false);
      }),
    );
  });

  it('host punycode (xn--) yang tidak terdaftar ditolak dengan kode URL_PUNYCODE', () => {
    fc.assert(
      fc.property(label, host, (l, h) => {
        const r = matchOfficialUrl(`https://xn--${l}.${h}/`);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.code).toBe(ErrorCode.URL_PUNYCODE);
        expect(isOfficialUrl(`https://${h.replace(/^[^.]+/, `xn--${l}`)}/`)).toBe(false);
      }),
    );
  });

  it('http dan port non-standar ditolak; origin dengan slash akhir bukan origin persis', () => {
    fc.assert(
      fc.property(host, fc.integer({ min: 1, max: 65535 }), (h, port) => {
        fc.pre(port !== 443);
        expect(isOfficialUrl(`https://${h}:${port}/`)).toBe(false);
        expect(isOfficialUrl(`http://${h}/`)).toBe(false);
        expect(matchOfficialOrigin(`https://${h}`).ok).toBe(true);
        expect(matchOfficialOrigin(`https://${h}/`).ok).toBe(false);
      }),
    );
  });

  it('string sembarang tidak pernah melempar, dan hasil ok selalu ber-host terdaftar', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string({ maxLength: 80 }), fc.webUrl(), fc.constant('https://')), (s) => {
        const r = matchOfficialUrl(s);
        if (r.ok) expect(hosts).toContain(r.url.hostname);
      }),
    );
    // fc.webUrl lambat di runner CI bersama (5,4 detik terukur); batas eksplisit agar tidak flaky.
  }, 20_000);
});
