import { describe, expect, it } from 'vitest';
import {
  assertTargetAllowed,
  assertUrlAllowed,
  buildAllowlist,
  EgressBlockedError,
  isBlockedAddress,
  JINA_HOSTS,
  LLM_PROXY,
} from './policy.js';

const allow = buildAllowlist({});

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
  it('127.0.0.1:20128 (proxy LLM) satu-satunya alamat lokal yang boleh', () => {
    expect(assertTargetAllowed('http:', LLM_PROXY.host, LLM_PROXY.port, allow)).toBe(true);
    expect(assertTargetAllowed('https:', '127.0.0.1', 20128, allow)).toBe(true);
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

  it('host Jina, registry resmi, dan sufiks .go.id lewat https:443', () => {
    for (const h of [...JINA_HOSTS, 'cekdptonline.kpu.go.id', 'dukcapil.contoh.go.id', 'API.JINA.AI.'])
      expect(assertTargetAllowed('https:', h, 443, allow)).toBe(false);
  });

  it('base URL dari env operator diizinkan persis (skema + host + port), tetapi tidak membuka loopback', () => {
    const a = buildAllowlist({
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
    expect(buildAllowlist({ LLM_BASE_URL: 'file:///etc/passwd' }).configured.size).toBe(0);
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
