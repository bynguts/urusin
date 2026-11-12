import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { akunConfigFromEnv, assertAkunEnv } from './config.js';
import {
  DevMailer,
  EMAIL_FROM_DEFAULT,
  mailerFromEnv,
  MailerError,
  ResendMailer,
  RESEND_ENDPOINT,
  type HttpFetch,
} from './mailer.js';
import { emailAturUlang, emailGoogleDitautkan } from './templates.js';

const KEY = Buffer.alloc(32, 1).toString('base64');
const tolak: HttpFetch = () => Promise.reject(new Error('tidak dipakai'));

describe('ResendMailer', () => {
  it('POST ke api.resend.com dengan Bearer, from, to, html, text; tanpa membocorkan respons galat', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    let status = 200;
    const fetch: HttpFetch = async (url, init = {}) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: 'x', echo: 'warga@example.com' }), { status });
    };
    const m = new ResendMailer({ apiKey: 're_uji', from: 'Urusin <noreply@example.com>', fetch });
    const msg = emailAturUlang('warga@example.com', 'https://urusin.example.com/atur-ulang-sandi?token=abc');
    await m.send(msg);
    expect(calls[0]!.url).toBe(RESEND_ENDPOINT);
    expect(RESEND_ENDPOINT).toBe('https://api.resend.com/emails');
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(h.authorization).toBe('Bearer re_uji');
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toMatchObject({
      from: 'Urusin <noreply@example.com>',
      to: ['warga@example.com'],
      subject: msg.subject,
    });
    expect(body.html).toContain('atur-ulang-sandi?token=abc');
    expect(body.text).toContain('atur-ulang-sandi?token=abc');
    status = 422;
    const e = await m.send(msg).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(MailerError);
    expect((e as Error).message).not.toContain('warga@example.com');
  });
});

describe('DevMailer dan pemilihan mailer dari env', () => {
  it('ditahan (produksi tanpa Resend): tidak mencatat tautan dan tidak menulis outbox', async () => {
    const log: string[] = [];
    const m = new DevMailer((l) => log.push(l), undefined, true);
    await m.send(emailAturUlang('warga@example.com', 'https://x.example.com/atur-ulang-sandi?token=rahasia'));
    expect(log).toEqual(['[email-ditahan] atur-ulang ke w***@example.com: Resend belum dikonfigurasi']);
    expect(log.join('')).not.toContain('rahasia');
  });

  it('dev: mencatat tautan dengan penerima tersamar, outbox JSONL opsional', async () => {
    const log: string[] = [];
    const outbox = join(mkdtempSync(join(tmpdir(), 'outbox-')), 'mail.jsonl');
    const m = new DevMailer((l) => log.push(l), outbox);
    await m.send(emailAturUlang('warga@example.com', 'https://x.example.com/atur-ulang-sandi?token=t'));
    expect(log).toEqual([
      '[email-dev] atur-ulang ke w***@example.com: https://x.example.com/atur-ulang-sandi?token=t',
    ]);
    expect(JSON.parse(readFileSync(outbox, 'utf8').trim())).toMatchObject({
      to: 'warga@example.com',
      jenis: 'atur-ulang',
    });
  });

  it('URUSIN_EMAIL_MODE: kosong = resend bila ada kunci, selain itu log; log sah di produksi (ditahan)', () => {
    const log = () => undefined;
    const prod = mailerFromEnv({ NODE_ENV: 'production' }, tolak, log);
    expect([prod.kind, prod.ditahan]).toEqual(['log', true]);
    const prodLog = mailerFromEnv({ NODE_ENV: 'production', URUSIN_EMAIL_MODE: 'log' }, tolak, log);
    expect([prodLog.kind, prodLog.ditahan]).toEqual(['log', true]);
    // placeholder .env.example tidak menyalakan Resend
    const contoh = { NODE_ENV: 'production', RESEND_API_KEY: 'ganti-dengan-kunci-resend' };
    expect(mailerFromEnv(contoh, tolak, log).kind).toBe('log');
    expect(() => mailerFromEnv({ ...contoh, URUSIN_EMAIL_MODE: 'resend' }, tolak, log)).toThrow(
      /RESEND_API_KEY/,
    );
    const ci = { NODE_ENV: 'production', URUSIN_EMAIL_MODE: 'log', CI: 'true' };
    const ciM = mailerFromEnv(ci, tolak, log);
    expect([ciM.kind, ciM.ditahan]).toEqual(['log', false]);
    expect([mailerFromEnv({}, tolak, log).kind, mailerFromEnv({}, tolak, log).ditahan]).toEqual([
      'log',
      false,
    ]);
    expect(() => mailerFromEnv({ URUSIN_EMAIL_MODE: 'smtp' }, tolak, log)).toThrow(/tidak dikenal/);
    expect(mailerFromEnv({ NODE_ENV: 'production', RESEND_API_KEY: 're_x' }, tolak, log).kind).toBe('resend');
    const dev = { URUSIN_EMAIL_MODE: 'resend', RESEND_API_KEY: 're_x' };
    expect(mailerFromEnv(dev, tolak, log).kind).toBe('resend');
  });

  it('pengirim default no-reply@urusinai.web.id; URUSIN_EMAIL_FROM menimpa; 429 = kuota habis', async () => {
    const bodies: string[] = [];
    const f = async (_u: string, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return new Response('{}', { status: 200 });
    };
    const kirim = (env: Record<string, string>) =>
      mailerFromEnv({ URUSIN_EMAIL_MODE: 'resend', RESEND_API_KEY: 're_x', ...env }, f, () => undefined).send(
        emailAturUlang('a@example.com', 'https://x.example.com/a'),
      );
    await kirim({});
    await kirim({ URUSIN_EMAIL_FROM: 'Urusin <halo@example.com>' });
    expect(JSON.parse(bodies[0]!).from).toBe(EMAIL_FROM_DEFAULT);
    expect(EMAIL_FROM_DEFAULT).toContain('no-reply@urusinai.web.id');
    expect(JSON.parse(bodies[1]!).from).toBe('Urusin <halo@example.com>');
    expect(new MailerError(429).message).toMatch(/kuota/);
  });

  it('templat: HTML ter-escape, teks polos, bahasa Indonesia', () => {
    const m = emailGoogleDitautkan('a@example.com', 'https://x.example.com/pengaturan?a=1&b=<2>');
    expect(m.jenis).toBe('google-ditautkan');
    expect(m.html).toContain('a=1&amp;b=&lt;2&gt;');
    expect(m.html).toContain('lang="id"');
    expect(m.text).toContain('https://x.example.com/pengaturan?a=1&b=<2>');
    expect(m.text).toContain('Bila itu bukan Anda');
    expect(m.html).not.toContain('<script');
    expect(emailAturUlang('a@example.com', 'https://x.example.com/r').jenis).toBe('atur-ulang');
  });
});

describe('konfigurasi akun dari env', () => {
  it('TTL sesi, Google berpasangan, KEK dari URUSIN_PII_KEY', () => {
    const c = akunConfigFromEnv({
      AUTH_SESSION_IDLE_TTL_SEC: '3600',
      AUTH_SESSION_ABSOLUTE_TTL_SEC: '86400',
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 'rahasia',
      URUSIN_PII_KEY: KEY,
    });
    expect(c.ttl).toEqual({ sesiIdleSec: 3600, sesiAbsolutSec: 86400 });
    expect(c.google).toEqual({ clientId: 'id', clientSecret: 'rahasia' });
    expect(c.kekSementara).toBe(false);
    expect(akunConfigFromEnv({ URUSIN_PII_KEY: KEY }).kek.equals(c.kek)).toBe(true);
    const dev = akunConfigFromEnv({});
    expect([dev.google, dev.kekSementara, dev.kek.length, dev.kekLama, dev.oidcFixture]).toEqual([
      undefined,
      true,
      32,
      undefined,
      false,
    ]);
    const k = akunConfigFromEnv({
      URUSIN_PII_KEY: KEY,
      URUSIN_PII_KEY_PREV: Buffer.alloc(32, 2).toString('base64'),
      URUSIN_TAMU_PER_IP_HARI: '5',
      URUSIN_DEMO_PER_IP_HARI: '2',
      URUSIN_DEMO_AKTIF_MAKS: '50',
      URUSIN_VAULT_MAX_MB: '100',
      URUSIN_VAULT_DISK_THRESHOLD: '90',
      URUSIN_OIDC_FIXTURE: '1',
    });
    expect(k.kekLama?.length).toBe(32);
    expect(k.kuota).toEqual({ tamuPerIpHari: 5, demoPerIpHari: 2, demoAktifMaks: 50 });
    expect(k.batasVault).toEqual({ totalMaks: 100 * 1024 * 1024, diskPersenMaks: 90 });
    expect(k.oidcFixture).toBe(true);
  });

  it('nilai tidak valid menolak boot', () => {
    expect(() => akunConfigFromEnv({ AUTH_SESSION_IDLE_TTL_SEC: 'abc' })).toThrow(/bilangan bulat/);
    expect(() => akunConfigFromEnv({ AUTH_SESSION_IDLE_TTL_SEC: '10' })).toThrow(/≥ 60/);
    expect(() =>
      akunConfigFromEnv({ AUTH_SESSION_IDLE_TTL_SEC: '7200', AUTH_SESSION_ABSOLUTE_TTL_SEC: '3600' }),
    ).toThrow(/melebihi/);
    expect(() => akunConfigFromEnv({ GOOGLE_CLIENT_ID: 'id' })).toThrow(/berdua/);
    // placeholder .env.example = Google mati (tombol tersembunyi), bukan galat
    const contoh = {
      GOOGLE_CLIENT_ID: 'ganti-dengan-client-id.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'ganti-dengan-client-secret',
    };
    expect(akunConfigFromEnv(contoh).google).toBeUndefined();
    expect(() => akunConfigFromEnv({ NODE_ENV: 'production' })).toThrow(/URUSIN_PII_KEY/);
    expect(() => akunConfigFromEnv({ URUSIN_PII_KEY_PREV: KEY })).toThrow(/kunci baru/);
    expect(() => akunConfigFromEnv({ URUSIN_VAULT_DISK_THRESHOLD: '101' })).toThrow(/0..100/);
    const fixtureProd = { NODE_ENV: 'production', URUSIN_PII_KEY: KEY, URUSIN_OIDC_FIXTURE: '1' };
    expect(() => akunConfigFromEnv(fixtureProd)).toThrow(/produksi/);
    // tanpa kredensial Resend/Google produksi tetap boot (email ditahan)
    expect(() => assertAkunEnv({ NODE_ENV: 'production', URUSIN_PII_KEY: KEY })).not.toThrow();
    const resendTanpaKunci = { NODE_ENV: 'production', URUSIN_PII_KEY: KEY, URUSIN_EMAIL_MODE: 'resend' };
    expect(() => assertAkunEnv(resendTanpaKunci)).toThrow(/RESEND_API_KEY/);
    const prod = { NODE_ENV: 'production', URUSIN_PII_KEY: KEY, RESEND_API_KEY: 're_x' };
    expect(() => assertAkunEnv(prod)).not.toThrow();
  });
});
