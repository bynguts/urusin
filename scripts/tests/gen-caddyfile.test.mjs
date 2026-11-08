import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COMMITTED, drift, loadHosts, render, validateSet } from '../gen-caddyfile.mjs';

const hosts = loadHosts();
const siteLines = (text) =>
  text
    .split('\n')
    .filter((l) => /^[^\s#(}].*\{$/.test(l))
    .map((l) => l.replace(/\s*\{$/, ''));

describe('gen-caddyfile', () => {
  it('snippet yang di-commit cocok dengan deploy/hosts.json (gagal bila menyimpang)', () => {
    assert.deepEqual(drift(), []);
  });

  for (const set of Object.keys(COMMITTED)) {
    it(`${set}: hostname literal, tanpa placeholder env, tanpa opsi global`, () => {
      const text = render(set, hosts[set]);
      const code = text.replace(/^\s*#.*$/gm, '');
      assert.doesNotMatch(code, /\{\$/);
      assert.doesNotMatch(text, /^\{/m, 'opsi global akan memengaruhi situs lain');
      assert.deepEqual(siteLines(text), [`${hosts[set].app}, ${hosts[set].verify}`]);
      assert.match(text, /reverse_proxy 127\.0\.0\.1:4310 127\.0\.0\.1:4311 \{/);
      assert.match(text, /health_uri \/api\/ready/);
      assert.match(code, /^\s+respond \/api\/health\* 404$/m, '/api/health tidak boleh publik');
      assert.ok(code.indexOf('respond /api/health') < code.indexOf('reverse_proxy'));
      assert.doesNotMatch(code, /Content-Security-Policy/i, 'CSP milik aplikasi');
    });
  }

  it('fallback memakai host sslip, primary memakai domain utama; keduanya berbeda', () => {
    assert.match(render('fallback', hosts.fallback), /\.sslip\.io, verify\./);
    assert.notEqual(render('primary', hosts.primary), render('fallback', hosts.fallback));
  });

  it('--fixtures mengaktifkan blok fixtures dengan host literal', () => {
    const text = render('primary', hosts.primary, { fixtures: true });
    assert.deepEqual(siteLines(text), [
      `${hosts.primary.app}, ${hosts.primary.verify}`,
      hosts.primary.fixtures,
    ]);
    assert.match(text, /reverse_proxy 127\.0\.0\.1:4320/);
  });

  it('host tidak valid ditolak (placeholder, skema, wildcard, port)', () => {
    for (const bad of ['{$DOMAIN}', 'https://a.example', '*.example.com', 'a.example:443', '']) {
      assert.throws(() => validateSet('x', { app: bad, verify: 'v.example.com', fixtures: 'f.example.com' }));
    }
  });

  it('drift mendeteksi berkas yang diedit manual', () => {
    const dir = mkdtempSync(join(tmpdir(), 'caddy-'));
    mkdirSync(join(dir, 'deploy'));
    writeFileSync(join(dir, COMMITTED.primary), render('primary', hosts.primary));
    writeFileSync(join(dir, COMMITTED.fallback), render('fallback', hosts.fallback).replace('4311', '4312'));
    assert.deepEqual(drift(dir), [COMMITTED.fallback]);
  });
});
