import { describe, expect, it } from 'vitest';
import {
  assertTargetAllowed,
  assertUrlAllowed,
  browserUnion,
  buildAllowlist,
  checkConnect,
  checkConnectHost,
  domainPemda,
  EgressBlockedError,
  isBlockedAddress,
  isLlmProxy,
  AUTH_HOSTS,
  TURNSTILE_HOSTS,
  isPendampingInternal,
  JINA_HOSTS,
  LLM_PROXY,
} from './policy.js';

const PROXY_ENV = { LLM_BASE_URL: `http://${LLM_PROXY.host}:${LLM_PROXY.port}/v1` };
/** Runtime dengan LLM_BASE_URL = proxy loopback (seperti produksi). */
const allow = buildAllowlist('runtime', PROXY_ENV);
const ingest = buildAllowlist('ingest', PROXY_ENV);

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1',
    '127.1.2.3',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '100.127.255.254',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '[::1]',
    'fe80::1',
    'fd00::1',
    'fc00::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '::ffff:a9fe:a9fe',
    '::ffff:0:7f00:1',
    '::ffff:0:a00:1',
    '64:ff9b::7f00:1',
    '2002:7f00:1::',
    'localhost',
  ])('%s diblokir', (a) => expect(isBlockedAddress(a)).toBe(true));

  it.each(['1.1.1.1', '8.8.8.8', '158.178.239.106', '100.128.0.1', '172.32.0.1', '2606:4700::1111'])(
    '%s publik, tidak diblokir',
    (a) => expect(isBlockedAddress(a)).toBe(false),
  );
});

describe('assertTargetAllowed', () => {
  it('gateway Tailscale hanya origin LLM_BASE_URL pada port 20128 di runtime', () => {
    const env = { LLM_BASE_URL: 'http://100.101.1.2:20128/v1' };
    const a = buildAllowlist('runtime', env);
    expect(assertTargetAllowed('http:', '100.101.1.2', 20128, a)).toBe(true);
    for (const [protocol, host, port] of [
      ['https:', '100.101.1.2', 20128],
      ['http:', '100.101.1.3', 20128],
      ['http:', '100.101.1.2', 2019],
      ['http:', '100.101.1.2', 4330],
    ] as const)
      expect(() => assertTargetAllowed(protocol, host, port, a)).toThrow(EgressBlockedError);
    for (const profile of ['ingest', 'browser'] as const)
      expect(() => assertTargetAllowed('http:', '100.101.1.2', 20128, buildAllowlist(profile, env))).toThrow(
        EgressBlockedError,
      );
    for (const envLain of [
      {},
      { RERANK_BASE_URL: env.LLM_BASE_URL },
      { LLM_BASE_URL: 'http://10.0.0.1:20128/v1' },
      { LLM_BASE_URL: 'http://100.101.1.2:2019/v1' },
    ])
      expect(() =>
        assertTargetAllowed('http:', '100.101.1.2', 20128, buildAllowlist('runtime', envLain)),
      ).toThrow(EgressBlockedError);
  });

  it('127.0.0.1:20128 (proxy LLM) satu-satunya alamat lokal yang boleh', () => {
    expect(assertTargetAllowed('http:', LLM_PROXY.host, LLM_PROXY.port, allow)).toBe(true);
    expect(assertTargetAllowed('https:', '127.0.0.1', 20128, allow)).toBe(true);
  });

  it('pengecualian 20128 hanya bila LLM_BASE_URL memang origin itu (M1)', () => {
    for (const env of [
      {},
      { LLM_BASE_URL: 'https://llm.contoh.dev/v1' },
      { RERANK_BASE_URL: PROXY_ENV.LLM_BASE_URL },
    ]) {
      const a = buildAllowlist('runtime', env);
      expect(a.llmProxy).toBe(false);
      expect(() => assertTargetAllowed('http:', '127.0.0.1', 20128, a)).toThrow(/lokal\/privat/);
    }
    expect(buildAllowlist('runtime', { LLM_BASE_URL: 'http://127.0.0.1:20129/v1' }).llmProxy).toBe(false);
    expect(buildAllowlist('runtime', { LLM_BASE_URL: 'https://127.0.0.1:20128' }).llmProxy).toBe(true);
    expect(() => assertTargetAllowed('http:', '127.0.0.1', 20128, ingest)).toThrow(EgressBlockedError);
  });

  it('worker pendamping internal: hanya http IP literal 127.0.0.1/Tailscale + port persis dari env', () => {
    const env = {
      PENDAMPING_INTERNAL_URL: 'http://127.0.0.1:4330',
      PENDAMPING_WORKERS: JSON.stringify([
        { url: 'http://100.101.1.2:4330' },
        { url: 'http://10.0.0.5:4330' }, // privat non-Tailscale: diabaikan
        { url: 'https://127.0.0.1:4331' }, // https: diabaikan
        { url: 'http://pendamping:4000' }, // nama DNS: diabaikan
        { url: 'http://127.0.0.1:2019' }, // admin Caddy: tidak pernah
        { url: 'http://127.0.0.1:20128' }, // proxy LLM: jalurnya sendiri
        { url: 'http://127.0.0.1' }, // tanpa port eksplisit
        { bukan: 'url' },
      ]),
    };
    const a = buildAllowlist('runtime', env);
    expect([...(a.internal ?? [])]).toEqual(['http://127.0.0.1:4330', 'http://100.101.1.2:4330']);
    expect(assertTargetAllowed('http:', '127.0.0.1', 4330, a)).toBe(true);
    expect(assertTargetAllowed('http:', '100.101.1.2', 4330, a)).toBe(true);
    for (const [proto, host, port] of [
      ['http:', '127.0.0.1', 4331],
      ['https:', '127.0.0.1', 4330],
      ['http:', '127.0.0.1', 2019],
      ['http:', '10.0.0.5', 4330],
      ['http:', '100.101.1.3', 4330],
    ] as const)
      expect(() => assertTargetAllowed(proto, host, port, a), `${host}:${port}`).toThrow(EgressBlockedError);
    expect(isPendampingInternal(new URL('http://127.0.0.1:4330/internal/sesi'), a)).toBe(true);
    expect(isPendampingInternal(new URL('http://127.0.0.1:4331/'), a)).toBe(false);
    // Tanpa env (atau JSON rusak) dan profil ingest: tidak ada pengecualian.
    expect(buildAllowlist('runtime', { PENDAMPING_WORKERS: '[{' }).internal?.size).toBe(0);
    expect(() => assertTargetAllowed('http:', '127.0.0.1', 4330, allow)).toThrow(EgressBlockedError);
    expect(() => assertTargetAllowed('http:', '127.0.0.1', 4330, buildAllowlist('ingest', env))).toThrow(
      EgressBlockedError,
    );
  });

  it('sidecar embedding (URUSIN_EMBED_URL): aturan origin internal yang sama, hanya port persis', () => {
    const a = buildAllowlist('runtime', { URUSIN_EMBED_URL: 'http://127.0.0.1:4340' });
    expect([...(a.internal ?? [])]).toEqual(['http://127.0.0.1:4340']);
    expect(assertTargetAllowed('http:', '127.0.0.1', 4340, a)).toBe(true);
    expect(() => assertTargetAllowed('http:', '127.0.0.1', 4341, a)).toThrow(EgressBlockedError);
    for (const url of [
      'http://embedding:8080',
      'https://127.0.0.1:4340',
      'http://127.0.0.1:2019',
      'http://10.1.1.1:80',
    ])
      expect(buildAllowlist('runtime', { URUSIN_EMBED_URL: url }).internal?.size, url).toBe(0);
    expect(() =>
      assertTargetAllowed(
        'http:',
        '127.0.0.1',
        4340,
        buildAllowlist('ingest', { URUSIN_EMBED_URL: 'http://127.0.0.1:4340' }),
      ),
    ).toThrow(EgressBlockedError);
  });

  it('isLlmProxy: hanya 127.0.0.1:20128', () => {
    expect(isLlmProxy(new URL('http://127.0.0.1:20128/v1'))).toBe(true);
    expect(isLlmProxy(new URL('http://127.0.0.1:2019/'))).toBe(false);
    expect(isLlmProxy(new URL('https://api.jina.ai/'))).toBe(false);
  });

  it.each([
    ['http:', '127.0.0.1', 2019],
    ['http:', '127.0.0.1', 4320],
    ['http:', '127.0.0.1', 4310],
    ['http:', '127.0.0.1', 22],
    ['http:', '127.0.0.2', 20128],
    ['http:', '[::1]', 20128],
    ['http:', '169.254.169.254', 80],
    ['http:', '10.0.0.5', 80],
    ['https:', '100.100.100.100', 443],
    ['https:', '1.1.1.1', 443],
    ['http:', 'localhost', 20128],
    ['https:', 'evil.example.com', 443],
    ['https:', 'go.id.evil.com', 443],
    ['http:', 'api.jina.ai', 80],
    ['https:', 'api.jina.ai', 8443],
    ['ftp:', 'api.jina.ai', 21],
    ['https:', 'api.jina.ai', 0],
  ])('%s//%s:%i diblokir', (proto, host, port) => {
    expect(() => assertTargetAllowed(proto, host, port, allow)).toThrow(EgressBlockedError);
  });

  it('runtime: host Jina lewat https:443; host pemerintah tidak (L2)', () => {
    for (const h of [...JINA_HOSTS, 'API.JINA.AI.'])
      expect(assertTargetAllowed('https:', h, 443, allow)).toBe(false);
    for (const h of ['cekdptonline.kpu.go.id', 'dukcapil.contoh.go.id'])
      expect(() => assertTargetAllowed('https:', h, 443, allow)).toThrow(EgressBlockedError);
  });

  it('runtime: host akun (Google, Resend, Turnstile) lewat https:443 saja; ingest menolak (ADR 0028)', () => {
    for (const h of [...AUTH_HOSTS, ...TURNSTILE_HOSTS]) {
      expect(assertTargetAllowed('https:', h, 443, allow)).toBe(false);
      expect(() => assertTargetAllowed('http:', h, 80, allow)).toThrow(EgressBlockedError);
      expect(() => assertTargetAllowed('https:', h, 443, ingest)).toThrow(EgressBlockedError);
    }
    expect(() => assertTargetAllowed('https:', 'evil.googleapis.com', 443, allow)).toThrow(
      EgressBlockedError,
    );
  });

  it('ingest: registry resmi dan sufiks .go.id lewat https:443; Jina dan env operator tidak (L2)', () => {
    for (const h of ['cekdptonline.kpu.go.id', 'dukcapil.contoh.go.id', 'oss.go.id'])
      expect(assertTargetAllowed('https:', h, 443, ingest)).toBe(false);
    expect(() => assertTargetAllowed('http:', 'oss.go.id', 80, ingest)).toThrow(EgressBlockedError);
    expect(() => assertTargetAllowed('https:', 'api.jina.ai', 443, ingest)).toThrow(EgressBlockedError);
    const i2 = buildAllowlist('ingest', { LLM_BASE_URL: 'https://llm.contoh.dev/v1' });
    expect(() => assertTargetAllowed('https:', 'llm.contoh.dev', 443, i2)).toThrow(EgressBlockedError);
  });

  it('base URL dari env operator diizinkan persis (skema + host + port), tetapi tidak membuka loopback', () => {
    const a = buildAllowlist('runtime', {
      LLM_BASE_URL: 'https://llm.contoh.dev/v1',
      LLM_EMBED_BASE_URL: 'http://203.0.114.7:8080/v1',
      RERANK_BASE_URL: 'http://127.0.0.1:2019/v1',
      LLM_TRANSCRIBE_BASE_URL: 'bukan url',
      LLM_BASE_URL_X: 'https://lain.dev',
    });
    expect(assertTargetAllowed('https:', 'llm.contoh.dev', 443, a)).toBe(false);
    expect(assertTargetAllowed('http:', '203.0.114.7', 8080, a)).toBe(true);
    expect(() => assertTargetAllowed('http:', 'llm.contoh.dev', 80, a)).toThrow(EgressBlockedError);
    expect(() => assertTargetAllowed('http:', '127.0.0.1', 2019, a)).toThrow(/lokal\/privat/);
    expect(() => assertTargetAllowed('https:', 'lain.dev', 443, a)).toThrow(EgressBlockedError);
  });

  it('skema non-http di env diabaikan', () => {
    expect(buildAllowlist('runtime', { LLM_BASE_URL: 'file:///etc/passwd' }).configured.size).toBe(0);
    expect(buildAllowlist().hosts.has('api.jina.ai')).toBe(true);
  });
});

describe('assertUrlAllowed', () => {
  it('URL valid diizinkan, port bawaan diturunkan dari skema', () => {
    expect(assertUrlAllowed('https://api.jina.ai/v1/rerank', allow).host).toBe('api.jina.ai');
    expect(assertUrlAllowed('http://127.0.0.1:20128/v1/models', allow).port).toBe('20128');
  });
  it.each([
    'bukan url',
    'https://user:pw@api.jina.ai/', // pii-scan:allow userinfo sintetis
    'http://127.0.0.1:2019/load',
    'http://[::ffff:127.0.0.1]:20128/',
    'http://0x7f000001:2019/',
    'http://2130706433/',
  ])('%s ditolak', (u) => {
    expect(() => assertUrlAllowed(u, allow)).toThrow(EgressBlockedError);
  });
});

describe('checkConnect (profil browser)', () => {
  const sesi = new Set(['telunjuksakti.wonogirikab.go.id', 'challenges.cloudflare.com']);
  const ok =
    (host: string, ip = '103.10.20.30', port = 443) =>
    () =>
      checkConnect(host, port, ip, 'browser', { sesi });

  it('host sesi + union registry di https:443 dengan IP publik lolos', () => {
    expect(ok('telunjuksakti.wonogirikab.go.id')).not.toThrow();
    expect(ok('TELUNJUKSAKTI.wonogirikab.go.id.')).not.toThrow();
    expect(ok('challenges.cloudflare.com', '2606:4700::6810:1')).not.toThrow();
  });

  it('DNS host yang diizinkan menunjuk ke alamat terlarang ditolak', () => {
    for (const ip of [
      '127.0.0.1',
      '10.0.0.5',
      '172.17.0.1', // gateway bridge Docker
      '192.168.1.1',
      '100.64.0.1', // CGNAT / Tailscale
      '169.254.169.254', // metadata cloud
      '0.0.0.0',
      '::1',
      '::127.0.0.1', // IPv4-compatible
      '::ffff:127.0.0.1',
      '::ffff:0:a00:5', // IPv4-translated
      '64:ff9b::a9fe:a9fe',
      'fd00::1',
      'bukan-ip',
    ])
      expect(ok('telunjuksakti.wonogirikab.go.id', ip), ip).toThrow(EgressBlockedError);
  });

  it('port selain 443 (termasuk 20128/2019), IP literal, di luar sesi, di luar union: ditolak', () => {
    expect(ok('telunjuksakti.wonogirikab.go.id', '103.10.20.30', 20128)).toThrow(/https:443/);
    expect(ok('telunjuksakti.wonogirikab.go.id', '103.10.20.30', 2019)).toThrow(/https:443/);
    expect(ok('telunjuksakti.wonogirikab.go.id', '103.10.20.30', 80)).toThrow(/https:443/);
    expect(ok('103.10.20.30')).toThrow(/IP literal/);
    expect(ok('oss.go.id')).toThrow(/allowlist sesi/);
    expect(ok('contoh.go.id')).toThrow(/union registry/); // tanpa wildcard *.go.id
    // Set sesi tidak bisa memperlebar union global (pendamping yang dibobol tetap dibatasi).
    expect(() =>
      checkConnect('evil.example', 443, '1.2.3.4', 'browser', { sesi: new Set(['evil.example']) }),
    ).toThrow(/union registry/);
    expect(() =>
      checkConnect('fixtures.contoh.id', 443, '1.2.3.4', 'browser', {
        sesi: new Set(['fixtures.contoh.id']),
        union: browserUnion(['fixtures.contoh.id']),
      }),
    ).not.toThrow();
    expect(() =>
      checkConnect('oss.go.id', 443, '1.2.3.4', 'runtime' as 'browser', { sesi: new Set(['oss.go.id']) }),
    ).toThrow(/bukan untuk CONNECT/);
  });

  it('probe gel5 3310: aset pemda disetujui tepat waktu lolos tanpa union; belum disetujui, apex, pemda lain tidak', () => {
    const domain = new Set(['klaten.go.id']);
    const lingkup = {
      sesi,
      domainPemda: domain,
      asetPemda: new Set(['cdn.klaten.go.id', 'cdn.slemankab.go.id']),
    };
    // Host saudara belum disetujui (mis. tujuan redirect) dan apex pemda: ditolak.
    expect(() => checkConnectHost('x.klaten.go.id', 443, 'browser', lingkup)).toThrow(/union registry/);
    expect(() => checkConnectHost('klaten.go.id', 443, 'browser', lingkup)).toThrow(/union registry/);
    expect(() => checkConnectHost('cdn.klaten.go.id', 443, 'browser', { sesi, domainPemda: domain })).toThrow(
      /union registry/,
    );
    expect(domainPemda('sakura.dukcapil.KLATEN.go.id.')).toBe('klaten.go.id');
    expect(domainPemda('klaten.go.id')).toBe('klaten.go.id');
    expect(domainPemda('go.id')).toBeUndefined();
    expect(domainPemda('klaten.go.id.evil.example')).toBeUndefined();
    expect(checkConnectHost('cdn.klaten.go.id', 443, 'browser', lingkup)).toBe('cdn.klaten.go.id');
    expect(() => checkConnectHost('cdn.klaten.go.id', 443, 'browser', { sesi })).toThrow(/union registry/);
    expect(() => checkConnectHost('cdn.slemankab.go.id', 443, 'browser', lingkup)).toThrow(/union registry/);
    expect(() => checkConnectHost('cdn.klaten.go.id', 80, 'browser', lingkup)).toThrow(/https:443/);
    expect(() => checkConnect('cdn.klaten.go.id', 443, '10.0.0.5', 'browser', lingkup)).toThrow(/terlarang/);
  });

  it('checkConnectHost (sebelum DNS): sama dengan checkConnect tanpa alamat; mengembalikan host ternormalisasi', () => {
    expect(checkConnectHost('TELUNJUKSAKTI.wonogirikab.go.id.', 443, 'browser', { sesi })).toBe(
      'telunjuksakti.wonogirikab.go.id',
    );
    expect(() => checkConnectHost('telunjuksakti.wonogirikab.go.id', 20128, 'browser', { sesi })).toThrow(
      /https:443/,
    );
    expect(() => checkConnectHost('[::1]', 443, 'browser', { sesi })).toThrow(/IP literal/);
    expect(() => checkConnectHost('oss.go.id', 443, 'browser', { sesi })).toThrow(/allowlist sesi/);
    expect(() =>
      checkConnectHost('evil.example', 443, 'browser', { sesi: new Set(['evil.example']) }),
    ).toThrow(/union registry/);
  });

  it('allowlist profil browser: union registry tanpa sufiks, tanpa proxy LLM, tanpa origin operator', () => {
    const a = buildAllowlist('browser', { LLM_BASE_URL: 'http://127.0.0.1:20128/v1' });
    expect(a.llmProxy).toBe(false);
    expect(a.suffixes).toEqual([]);
    expect(a.hosts.has('challenges.cloudflare.com')).toBe(true);
    expect(() => assertTargetAllowed('http:', '127.0.0.1', 20128, a)).toThrow(EgressBlockedError);
  });
});
