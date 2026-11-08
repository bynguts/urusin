import { describe, expect, it } from 'vitest';
import { TURNSTILE_SITEVERIFY, TURNSTILE_TOKEN_FIXTURE, turnstileFromEnv } from './turnstile';

describe('turnstileFromEnv', () => {
  it('placeholder .env.example = nonaktif', () => {
    const env = {
      TURNSTILE_SITE_KEY: 'ganti-dengan-site-key',
      TURNSTILE_SECRET_KEY: 'ganti-dengan-secret-key',
    };
    expect(turnstileFromEnv(env).mode).toBe('nonaktif');
  });

  it('nonaktif tanpa konfigurasi: tidak pernah lolos', async () => {
    const t = turnstileFromEnv({});
    const lolos = await t.verifikasi(TURNSTILE_TOKEN_FIXTURE, '1.2.3.4');
    expect([t.mode, t.siteKey, lolos]).toEqual(['nonaktif', '', false]);
  });

  it('fixture hanya menerima token uji dan ditolak di produksi', async () => {
    const t = turnstileFromEnv({ URUSIN_TURNSTILE_FIXTURE: '1' });
    expect(t.mode).toBe('fixture');
    expect(await t.verifikasi(TURNSTILE_TOKEN_FIXTURE, 'ip')).toBe(true);
    expect(await t.verifikasi('lain', 'ip')).toBe(false);
    expect(() => turnstileFromEnv({ URUSIN_TURNSTILE_FIXTURE: '1', NODE_ENV: 'production' })).toThrow(
      /produksi/,
    );
  });

  it('cloudflare: siteverify lewat fetch egress; gagal jaringan/respons = ditolak', async () => {
    const panggilan: { url: string; body: string }[] = [];
    let jawab: () => Promise<Response> = async () => Response.json({ success: true });
    const fetchUji = async (url: string, init: RequestInit) => {
      panggilan.push({ url, body: String(init.body) });
      return jawab();
    };
    const t = turnstileFromEnv(
      { TURNSTILE_SECRET_KEY: 'rahasia', TURNSTILE_SITE_KEY: 'situs' },
      fetchUji as never,
    );
    expect([t.mode, t.siteKey]).toEqual(['cloudflare', 'situs']);
    expect(await t.verifikasi('tok', '1.2.3.4')).toBe(true);
    expect(panggilan[0]!.url).toBe(TURNSTILE_SITEVERIFY);
    expect(Object.fromEntries(new URLSearchParams(panggilan[0]!.body))).toEqual({
      secret: 'rahasia',
      response: 'tok',
      remoteip: '1.2.3.4',
    });
    expect(await t.verifikasi(undefined, 'ip')).toBe(false);
    expect(await t.verifikasi('x'.repeat(5000), 'ip')).toBe(false);
    jawab = async () => Response.json({ success: false });
    expect(await t.verifikasi('tok', 'ip')).toBe(false);
    jawab = async () => new Response('x', { status: 500 });
    expect(await t.verifikasi('tok', 'ip')).toBe(false);
    jawab = async () => {
      throw new Error('jaringan');
    };
    expect(await t.verifikasi('tok', 'ip')).toBe(false);
    expect(panggilan).toHaveLength(4);
  });
});
