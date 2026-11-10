import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { COMMITTED, drift, loadHosts, render, validateSet } from '../gen-caddyfile.mjs';

const hosts = loadHosts();
const GEN = resolve(import.meta.dirname, '../gen-caddyfile.mjs');
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

  const BLOK_PD = [
    '\thandle /pendamping/ws/* {',
    '\t\turi strip_prefix /pendamping',
    '\t\treverse_proxy 127.0.0.1:4330',
    '\t}',
    '\timport urusin_common',
  ].join('\n');

  it('bawaan: blok Pendamping dikomentari; --pendamping mengaktifkannya tepat di situs app/verify', () => {
    for (const set of Object.keys(COMMITTED)) {
      const mati = render(set, hosts[set]).replace(/^\s*#.*$/gm, '');
      assert.doesNotMatch(mati, /handle|4330|strip_prefix/);
      const text = render(set, hosts[set], { pendamping: true });
      const code = text.replace(/^\s*#.*$/gm, '');
      assert.ok(text.includes(`${hosts[set].app}, ${hosts[set].verify} {`));
      assert.ok(text.includes(`\t#\n${BLOK_PD}\n}`), 'blok aktif tepat sebelum import urusin_common');
      // Hanya /pendamping/ws/* yang publik: /internal dan /debug pendamping tidak pernah diteruskan.
      assert.deepEqual(code.match(/^[ \t]*handle .*$/gm), ['\thandle /pendamping/ws/* {']);
      assert.doesNotMatch(code, /\/internal|\/debug|[^i]\/health/);
      assert.equal(code.match(/127\.0\.0\.1:4330/g)?.length, 1);
      assert.deepEqual(siteLines(text), [`${hosts[set].app}, ${hosts[set].verify}`]);
    }
  });

  it('B1: --set primary --fixtures --pendamping --import /opt/urusin/... = snippet target', () => {
    const text = render('primary', hosts.primary, {
      fixtures: true,
      pendamping: true,
      importPath: '/opt/urusin/Caddyfile.urusin',
    });
    assert.match(text, /^# {3}import \/opt\/urusin\/Caddyfile\.urusin$/m);
    assert.ok(text.includes(BLOK_PD));
    assert.deepEqual(siteLines(text), [
      `${hosts.primary.app}, ${hosts.primary.verify}`,
      hosts.primary.fixtures,
    ]);
    for (const bad of [
      'opt/urusin/Caddyfile.urusin',
      '/opt/urusin/Caddyfile',
      '/opt/a b/Caddyfile.urusin',
      '/x\n}',
    ])
      assert.throws(() => render('primary', hosts.primary, { importPath: bad }), bad);
  });

  it('--worker: rute HANYA /pendamping/w/<id>/ws/* ke IP Tailscale, di situs app/verify', () => {
    const text = render('primary', hosts.primary, {
      pendamping: true,
      workers: ['laptop-a=100.100.223.10:4330', 'laptop-b=100.64.0.7:4331'],
    });
    const code = text.replace(/^\s*#.*$/gm, '');
    assert.ok(
      text.includes(
        [
          '\thandle /pendamping/w/laptop-a/ws/* {',
          '\t\turi strip_prefix /pendamping/w/laptop-a',
          '\t\treverse_proxy 100.100.223.10:4330',
          '\t}',
        ].join('\n'),
      ),
    );
    assert.deepEqual(code.match(/^[ \t]*handle .*$/gm), [
      '\thandle /pendamping/ws/* {',
      '\thandle /pendamping/w/laptop-a/ws/* {',
      '\thandle /pendamping/w/laptop-b/ws/* {',
    ]);
    // Bukan handle_path seluruh /pendamping/w/<id>/*: /internal, /health, /debug edge worker tidak publik.
    assert.doesNotMatch(code, /handle_path|\/internal|\/debug|[^i]\/health/);
    assert.ok(code.indexOf('reverse_proxy 100.64.0.7:4331') < code.indexOf('import urusin_common'));
    assert.deepEqual(siteLines(text), [`${hosts.primary.app}, ${hosts.primary.verify}`]);
    // Tanpa --worker keluaran tetap sama persis (snippet terpasang tidak berubah).
    assert.equal(
      render('primary', hosts.primary, { pendamping: true, workers: [] }),
      render('primary', hosts.primary, { pendamping: true }),
    );
  });

  it('--worker ditolak: bukan IP Tailscale, id/port tidak sah, ganda, atau tanpa --pendamping', () => {
    const r =
      (workers, pendamping = true) =>
      () =>
        render('primary', hosts.primary, { pendamping, workers });
    for (const bad of [
      'laptop-a=192.168.1.5:4330',
      'laptop-a=10.0.0.1:4330',
      'laptop-a=100.63.255.255:4330',
      'laptop-a=100.128.0.1:4330',
      'laptop-a=127.0.0.1:4330',
      'laptop-a=0.0.0.0:4330',
      'laptop-a=100.300.0.1:4330',
      'laptop-a=laptop.tailnet.ts.net:4330',
      'laptop-a=100.100.223.10',
      'laptop-a=100.100.223.10:0',
      'laptop-a=100.100.223.10:70000',
      'Laptop=100.100.223.10:4330',
      '-a=100.100.223.10:4330',
      'a/b=100.100.223.10:4330',
      'a=100.100.223.10:4330\n}',
      undefined,
    ])
      assert.throws(r([bad]), String(bad));
    assert.throws(r(['a=100.64.0.1:4330', 'a=100.64.0.2:4330']), /ganda/);
    assert.throws(r(['a=100.64.0.1:4330'], false), /--pendamping/);
  });

  it('--check --set ... --file: 0 bila cocok, 1 bila menyimpang (flag beda/berkas hilang), 2 tanpa --file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'caddy-'));
    const file = join(dir, 'Caddyfile.urusin');
    const args = [
      '--set',
      'primary',
      '--fixtures',
      '--pendamping',
      '--import',
      '/opt/urusin/Caddyfile.urusin',
    ];
    const jalan = (...a) => spawnSync(process.execPath, [GEN, ...a], { encoding: 'utf8' }).status;
    assert.equal(jalan(...args, '--out', file), 0);
    assert.equal(jalan('--check', ...args, '--file', file), 0);
    writeFileSync(file, readFileSync(file, 'utf8').replace(/\n/g, '\r\n'));
    assert.equal(jalan('--check', ...args, '--file', file), 0, 'CRLF dinormalkan');
    assert.equal(jalan('--check', ...args.filter((x) => x !== '--pendamping'), '--file', file), 1);
    assert.equal(jalan('--check', '--set', 'primary', '--fixtures', '--pendamping', '--file', file), 1);
    assert.equal(jalan('--check', ...args, '--file', join(dir, 'tidak-ada')), 1);
    assert.equal(jalan('--check', ...args), 2);
    assert.equal(jalan('--check'), 0, 'cek snippet ter-commit tetap');
    // --worker ikut flag: snippet dengan worker hanya cocok bila flag --worker yang sama diberikan.
    const w = ['--worker', 'laptop-a=100.100.223.10:4330'];
    assert.equal(jalan(...args, ...w, '--out', file), 0);
    assert.equal(jalan('--check', ...args, ...w, '--file', file), 0);
    assert.equal(jalan('--check', ...args, '--file', file), 1);
    assert.equal(jalan(...args, '--worker', 'laptop-a=192.168.1.5:4330', '--out', file), 1);
  });
});
